"""
Unit Tests for SAMUDRA-3D Safe Ocean Download Pipeline & Manifest System
Verifies command generation, safety thresholds, disk headroom validation, SHA-256 manifests,
live filesystem progress sampling, cancellation, and terminal state immutability.
"""
import unittest
import unittest.mock
import tempfile
import os
import sys
import time
import threading
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.data.download_manager import (
    download_manager,
    SubsetCommandRequest,
    SafetyLevel,
    DownloadJobStatus,
    compute_file_sha256
)

client = TestClient(app)


class MockProcess:
    def __init__(self, returncode=0):
        self.returncode = returncode
        self.terminated = False
        self.killed = False
        self.pid = 12345

    def poll(self):
        if self.terminated or self.killed:
            return self.returncode
        return None

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True

    def wait(self, timeout=None):
        return self.returncode

    def communicate(self):
        return "", ""


class TestDownloadManager(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        """Ensures at least one manifest fixture exists for CI and fresh clones."""
        if len(download_manager.list_manifests()) == 0:
            from backend.app.core.config import settings
            if settings.SYNTHETIC_NETCDF_PATH.exists():
                download_manager.create_manifest(
                    settings.SYNTHETIC_NETCDF_PATH,
                    dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m"
                )

    def test_01_safe_command_generation(self):
        """Tests that a standard regional subset generates a valid CLI command and SAFE status."""
        req = SubsetCommandRequest(
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            lat_min=10.0,
            lat_max=20.0,
            lon_min=65.0,
            lon_max=75.0,
            depth_min=0.49,
            depth_max=50.0,
            start_date="2025-01-01",
            end_date="2025-01-03",
            variables=["thetao", "so"]
        )
        res = download_manager.generate_command(req)
        self.assertIn("copernicusmarine subset", res.command)
        self.assertIn("--dataset-id cmems_mod_glo_phy_my_0.083deg_P1D-m", res.command)
        self.assertIn("-v thetao -v so", res.command)
        self.assertEqual(res.safety_level, SafetyLevel.SAFE)
        self.assertTrue(res.can_execute_automatically)

    def test_02_safety_cap_blocks_massive_requests(self):
        """Tests that excessive volume (> 1 TB) is flagged as BLOCKED to prevent unbounded global downloads."""
        req = SubsetCommandRequest(
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            lat_min=-80.0,
            lat_max=80.0,
            lon_min=-180.0,
            lon_max=180.0,
            depth_min=0.0,
            depth_max=5000.0,
            start_date="2020-01-01",
            end_date="2025-01-01",  # ~1826 days
            variables=["thetao", "so", "uo", "vo"]
        )
        res = download_manager.generate_command(req)
        self.assertIn(res.safety_level, [SafetyLevel.BLOCKED, SafetyLevel.CRITICAL_WARNING])
        self.assertFalse(res.can_execute_automatically)
        self.assertIn("SAFETY VIOLATION", res.warning_message.upper())

    def test_03_manifest_cataloging_and_sha256(self):
        """Tests that existing NetCDF files are properly indexed with valid SHA-256 hashes."""
        manifests = download_manager.list_manifests()
        self.assertGreater(len(manifests), 0, "Expected at least 1 manifested file in SAMUDRA_DATA/raw")
        first = manifests[0]
        self.assertEqual(len(first.sha256), 64, "SHA-256 hash must be exactly 64 hexadecimal characters")
        self.assertGreater(first.file_size_bytes, 0)
        self.assertIn("[REAL • COPERNICUS]", first.provenance_badge)

    def test_04_api_generate_command_endpoint(self):
        """Tests POST /api/datasets/generate-command."""
        payload = {
            "dataset_id": "cmems_mod_glo_phy_my_0.083deg_P1D-m",
            "lat_min": 5.0,
            "lat_max": 15.0,
            "lon_min": 80.0,
            "lon_max": 90.0,
            "depth_min": 0.49,
            "depth_max": 100.0,
            "start_date": "2025-01-01",
            "end_date": "2025-01-05",
            "variables": ["thetao", "uo", "vo"]
        }
        resp = client.post("/api/datasets/generate-command", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("copernicusmarine subset", data["command"])
        self.assertIn("safety_level", data)
        self.assertIn("estimate", data)

    def test_05_api_manifests_endpoint(self):
        """Tests GET /api/datasets/manifests."""
        resp = client.get("/api/datasets/manifests")
        self.assertEqual(resp.status_code, 200)
        manifests = resp.json()
        self.assertIsInstance(manifests, list)
        self.assertGreater(len(manifests), 0)
        self.assertIn("sha256", manifests[0])
        self.assertIn("file_name", manifests[0])

    def test_06_measured_byte_progress_and_clamping(self):
        """Tests that get_job_status dynamically samples filesystem byte progress and clamps progress < 100% while running."""
        job_id = "test_prog_01"
        with tempfile.NamedTemporaryFile(suffix=".part", delete=False) as f:
            f.write(b"0" * (500 * 1024))  # 500 KB written
            part_path = f.name

        try:
            with download_manager._lock:
                download_manager._jobs[job_id] = {
                    "job_id": job_id,
                    "dataset_id": "test_dataset",
                    "status": DownloadJobStatus.RUNNING,
                    "command": "mock",
                    "target_file": part_path.replace(".part", ""),
                    "part_file": part_path,
                    "bytes_downloaded": 0,
                    "estimated_bytes": 1000 * 1024,  # 1000 KB estimated
                    "progress_pct": 0.0,
                    "error": None,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "completed_at": None,
                    "manifest": None,
                    "_process": None,
                    "_cancelled": False
                }

            status = download_manager.get_job_status(job_id)
            self.assertIsNotNone(status)
            self.assertEqual(status.bytes_downloaded, 500 * 1024)
            self.assertEqual(status.progress_pct, 50.0)

            # Write more bytes than estimated to test clamp below 100% while running
            with open(part_path, "wb") as f:
                f.write(b"0" * (1200 * 1024))

            status = download_manager.get_job_status(job_id)
            self.assertEqual(status.bytes_downloaded, 1200 * 1024)
            self.assertEqual(status.progress_pct, 99.0, "In-progress downloads must clamp below 100%")
        finally:
            if os.path.exists(part_path):
                os.remove(part_path)

    def test_07_job_cancellation_and_part_cleanup(self):
        """Tests that cancel_job terminates active processes, removes .part files, and sets CANCELLED status."""
        job_id = "test_cancel_01"
        mock_proc = MockProcess()

        with tempfile.NamedTemporaryFile(suffix=".part", delete=False) as f:
            f.write(b"partial_download_data")
            part_path = f.name

        try:
            with download_manager._lock:
                download_manager._jobs[job_id] = {
                    "job_id": job_id,
                    "dataset_id": "test_dataset",
                    "status": DownloadJobStatus.RUNNING,
                    "command": "mock",
                    "target_file": part_path.replace(".part", ""),
                    "part_file": part_path,
                    "bytes_downloaded": 100,
                    "estimated_bytes": 1000,
                    "progress_pct": 10.0,
                    "error": None,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "completed_at": None,
                    "manifest": None,
                    "_process": mock_proc,
                    "_cancelled": False
                }

            self.assertTrue(os.path.exists(part_path))
            res = download_manager.cancel_job(job_id)
            self.assertTrue(res)
            self.assertTrue(mock_proc.terminated or mock_proc.killed, "Process must be terminated or killed")
            self.assertFalse(os.path.exists(part_path), ".part file must be unlinked upon cancellation")

            status = download_manager.get_job_status(job_id)
            self.assertEqual(status.status, DownloadJobStatus.CANCELLED)
            self.assertIsNotNone(status.completed_at)
        finally:
            if os.path.exists(part_path):
                os.remove(part_path)

    def test_08_terminal_state_immutability(self):
        """Tests that already completed, failed, or cancelled jobs cannot be re-cancelled."""
        job_id = "test_terminal_01"
        with download_manager._lock:
            download_manager._jobs[job_id] = {
                "job_id": job_id,
                "dataset_id": "test_dataset",
                "status": DownloadJobStatus.COMPLETED,
                "command": "mock",
                "target_file": "mock_target.nc",
                "part_file": "mock_target.nc.part",
                "bytes_downloaded": 5000,
                "estimated_bytes": 5000,
                "progress_pct": 100.0,
                "error": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "manifest": None,
                "_process": None,
                "_cancelled": False
            }

        # Attempting to cancel already completed job returns False
        self.assertFalse(download_manager.cancel_job(job_id))
        status = download_manager.get_job_status(job_id)
        self.assertEqual(status.status, DownloadJobStatus.COMPLETED, "Completed job status must remain immutable")

    def test_09_unknown_job_404(self):
        """Tests that querying or cancelling non-existent jobs returns 404."""
        resp_status = client.get("/api/datasets/download/status/nonexistent_job_123")
        self.assertEqual(resp_status.status_code, 404)

        resp_cancel = client.post("/api/datasets/download/cancel/nonexistent_job_123")
        self.assertEqual(resp_cancel.status_code, 404)

    def test_10_collision_prevention_on_active_output(self):
        """Tests that starting a second download with the same output filename while one is active raises an error."""
        active_job_id = "test_active_coll"
        target_name = "test_collision_sample.nc"
        target_path = str(download_manager.raw_dir / target_name)
        part_path = str(download_manager.raw_dir / f"{target_name}.part")

        with download_manager._lock:
            download_manager._jobs[active_job_id] = {
                "job_id": active_job_id,
                "dataset_id": "test_dataset",
                "status": DownloadJobStatus.RUNNING,
                "command": "mock",
                "target_file": target_path,
                "part_file": part_path,
                "bytes_downloaded": 100,
                "estimated_bytes": 1000,
                "progress_pct": 10.0,
                "error": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": None,
                "manifest": None,
                "_process": None,
                "_cancelled": False
            }

        req = SubsetCommandRequest(
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            lat_min=10.0,
            lat_max=20.0,
            lon_min=65.0,
            lon_max=75.0,
            depth_min=0.49,
            depth_max=50.0,
            start_date="2025-01-01",
            end_date="2025-01-03",
            variables=["thetao"],
            output_filename=target_name
        )

        with self.assertRaises(ValueError) as ctx:
            download_manager.start_download_job(req)
        self.assertIn("already active", str(ctx.exception))

        # Cleanup mock job
        with download_manager._lock:
            download_manager._jobs.pop(active_job_id, None)

    def test_11_api_download_status_and_cancel_lifecycle(self):
        """Tests full API lifecycle for status polling and cancellation."""
        job_id = "test_api_cycle_01"
        with download_manager._lock:
            download_manager._jobs[job_id] = {
                "job_id": job_id,
                "dataset_id": "cmems_mod_glo_phy_my_0.083deg_P1D-m",
                "status": DownloadJobStatus.RUNNING,
                "command": "mock command",
                "target_file": "mock_target.nc",
                "part_file": "mock_target.nc.part",
                "bytes_downloaded": 250000,
                "estimated_bytes": 1000000,
                "progress_pct": 25.0,
                "error": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": None,
                "manifest": None,
                "_process": None,
                "_cancelled": False
            }

        # 1. Check status
        resp = client.get(f"/api/datasets/download/status/{job_id}")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "RUNNING")
        self.assertEqual(data["job_id"], job_id)

        # 2. Cancel
        resp_cancel = client.post(f"/api/datasets/download/cancel/{job_id}")
        self.assertEqual(resp_cancel.status_code, 200)
        self.assertEqual(resp_cancel.json()["status"], "cancelled")

        # 3. Status is now CANCELLED
        resp_after = client.get(f"/api/datasets/download/status/{job_id}")
        self.assertEqual(resp_after.status_code, 200)
        self.assertEqual(resp_after.json()["status"], "CANCELLED")

    def test_12_process_tree_termination_stops_wrapper_and_child(self):
        """Tests that cancel_job terminates the entire process tree (both parent wrapper and child process)."""
        import subprocess
        import sys
        import time

        # Wrapper script that launches a child sleep process, outputs the child PID, and waits
        wrapper_code = (
            "import subprocess, sys, time; "
            "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(20)']); "
            "print(f'CHILD_PID:{child.pid}', flush=True); "
            "child.wait()"
        )

        popen_kwargs = {
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "text": True
        }
        if sys.platform == "win32":
            popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            popen_kwargs["start_new_session"] = True

        wrapper_proc = subprocess.Popen([sys.executable, "-c", wrapper_code], **popen_kwargs)

        # Read the child PID from the wrapper process stdout
        child_pid = None
        start_time = time.time()
        while time.time() - start_time < 5.0:
            line = wrapper_proc.stdout.readline()
            if "CHILD_PID:" in line:
                child_pid = int(line.strip().split("CHILD_PID:")[1])
                break

        self.assertIsNotNone(child_pid, "Failed to capture spawned child PID")

        job_id = "test_tree_term_wrapper_child"
        try:
            with download_manager._lock:
                download_manager._jobs[job_id] = {
                    "job_id": job_id,
                    "dataset_id": "test_dataset",
                    "status": DownloadJobStatus.RUNNING,
                    "command": "mock",
                    "target_file": "mock_target.nc",
                    "part_file": "mock_staging.nc",
                    "staging_file": "mock_staging.nc",
                    "bytes_downloaded": 0,
                    "estimated_bytes": 1000,
                    "progress_pct": 0.0,
                    "error": None,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "completed_at": None,
                    "manifest": None,
                    "_process": wrapper_proc,
                    "_cancelled": False
                }

            # Cancel job
            res = download_manager.cancel_job(job_id)
            self.assertTrue(res, "cancel_job must return True on successful process tree termination")

            # Verify parent wrapper process is dead
            self.assertIsNotNone(wrapper_proc.poll(), "Parent wrapper process must be terminated")

            # Verify child process is also dead
            time.sleep(0.5)
            if sys.platform == "win32":
                chk = subprocess.run(["tasklist", "/FI", f"PID eq {child_pid}"], capture_output=True, text=True)
                self.assertNotIn(str(child_pid), chk.stdout, f"Child PID {child_pid} must be terminated by taskkill /T")
            else:
                try:
                    os.kill(child_pid, 0)
                    child_alive = True
                except OSError:
                    child_alive = False
                self.assertFalse(child_alive, f"Child PID {child_pid} must be terminated")
        finally:
            if wrapper_proc.poll() is None:
                wrapper_proc.kill()
            try:
                wrapper_proc.stdout.close()
                wrapper_proc.stderr.close()
            except Exception:
                pass
            with download_manager._lock:
                download_manager._jobs.pop(job_id, None)

    def test_13_launch_registration_race_cancellation(self):
        """Tests that cancellation during worker launch/Popen cleanly terminates the process upon registration."""
        popen_called = threading.Event()
        allow_popen_return = threading.Event()
        real_popen = subprocess.Popen
        real_procs = []

        def mock_popen(*args, **kwargs):
            cmd = args[0] if args else kwargs.get("args")
            if isinstance(cmd, list) and len(cmd) > 0 and "taskkill" in str(cmd[0]).lower():
                return real_popen(*args, **kwargs)
            popen_called.set()
            allow_popen_return.wait(timeout=5.0)
            proc = real_popen(f'"{sys.executable}" -c "import time; time.sleep(10)"', **kwargs)
            real_procs.append(proc)
            return proc

        req = SubsetCommandRequest(
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            start_date="2025-01-01",
            end_date="2025-01-02",
            output_filename="test_launch_race_exec.nc"
        )

        job_id = None
        try:
            with unittest.mock.patch("subprocess.Popen", side_effect=mock_popen):
                job_info = download_manager.start_download_job(req, force_override=True)
                job_id = job_info.job_id
                target_path = Path(job_info.target_file)
                staging_path = Path(job_info.part_file)

                # Wait until _run_job enters Popen
                self.assertTrue(popen_called.wait(timeout=3.0), "Worker must invoke subprocess.Popen")

                # Cancel the job while Popen is in-flight on the worker thread
                def do_cancel():
                    return download_manager.cancel_job(job_id)

                cancel_thread = threading.Thread(target=do_cancel)
                cancel_thread.start()

                # Now allow mock_popen to return the spawned process
                allow_popen_return.set()
                cancel_thread.join(timeout=5.0)

                # Wait briefly for worker thread to finish its post-launch cancellation handling
                for _ in range(50):
                    st = download_manager.get_job_status(job_id)
                    if st and st.status == DownloadJobStatus.CANCELLED:
                        break
                    time.sleep(0.05)

                status = download_manager.get_job_status(job_id)
                self.assertEqual(status.status, DownloadJobStatus.CANCELLED)
                for proc in real_procs:
                    self.assertIsNotNone(proc.poll(), "Spawned process must be terminated")
                self.assertFalse(staging_path.exists(), "Staging file must be cleaned up")
        finally:
            allow_popen_return.set()
            for proc in real_procs:
                if proc.poll() is None:
                    try:
                        proc.kill()
                        proc.wait(timeout=1.0)
                    except Exception:
                        pass
            if job_id:
                with download_manager._lock:
                    download_manager._jobs.pop(job_id, None)

    def test_13b_launch_registration_race_termination_failure(self):
        """Tests that if process tree termination throws in worker upon post-launch cancel, worker transitions job to FAILED."""
        popen_called = threading.Event()
        allow_popen_return = threading.Event()
        real_popen = subprocess.Popen
        real_procs = []

        def mock_popen(*args, **kwargs):
            cmd = args[0] if args else kwargs.get("args")
            if isinstance(cmd, list) and len(cmd) > 0 and "taskkill" in str(cmd[0]).lower():
                return real_popen(*args, **kwargs)
            popen_called.set()
            allow_popen_return.wait(timeout=5.0)
            proc = real_popen(f'"{sys.executable}" -c "import time; time.sleep(10)"', **kwargs)
            real_procs.append(proc)
            return proc

        req = SubsetCommandRequest(
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            start_date="2025-01-01",
            end_date="2025-01-02",
            output_filename="test_launch_race_fail.nc"
        )

        job_id = None
        try:
            with unittest.mock.patch("subprocess.Popen", side_effect=mock_popen), \
                 unittest.mock.patch.object(download_manager, "_terminate_process_tree", side_effect=RuntimeError("Simulated taskkill access denied")):
                job_info = download_manager.start_download_job(req, force_override=True)
                job_id = job_info.job_id

                self.assertTrue(popen_called.wait(timeout=3.0))

                # Mark cancelled directly while in launch
                with download_manager._lock:
                    download_manager._jobs[job_id]["_cancelled"] = True

                allow_popen_return.set()

                # Wait for worker thread to complete
                for _ in range(50):
                    st = download_manager.get_job_status(job_id)
                    if st and st.status in (DownloadJobStatus.FAILED, DownloadJobStatus.CANCELLED):
                        break
                    time.sleep(0.05)

                status = download_manager.get_job_status(job_id)
                self.assertEqual(status.status, DownloadJobStatus.FAILED, "Worker must mark FAILED when termination throws")
                self.assertIn("Cancellation failed to terminate process tree", status.error)
        finally:
            allow_popen_return.set()
            for proc in real_procs:
                if proc.poll() is None:
                    try:
                        proc.kill()
                        proc.wait(timeout=1.0)
                    except Exception:
                        pass
            if job_id:
                with download_manager._lock:
                    download_manager._jobs.pop(job_id, None)

    def test_14_cancellation_termination_failure_surfaced(self):
        """Tests that if process termination fails, an error is raised and HTTP 500 is returned by API."""
        job_id = "test_term_fail_01"
        class UnkillableProcess:
            pid = 999999
            def poll(self):
                return None
            def terminate(self):
                pass
            def kill(self):
                pass
            def wait(self, timeout=None):
                raise subprocess.TimeoutExpired(cmd="mock", timeout=1.0)

        with download_manager._lock:
            download_manager._jobs[job_id] = {
                "job_id": job_id,
                "dataset_id": "test_dataset",
                "status": DownloadJobStatus.RUNNING,
                "command": "mock",
                "target_file": "mock_target.nc",
                "part_file": "mock_staging.nc",
                "staging_file": "mock_staging.nc",
                "bytes_downloaded": 0,
                "estimated_bytes": 1000,
                "progress_pct": 0.0,
                "error": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": None,
                "manifest": None,
                "_process": UnkillableProcess(),
                "_cancelled": False
            }

        try:
            # API endpoint should return HTTP 500 on termination failure
            resp = client.post(f"/api/datasets/download/cancel/{job_id}")
            self.assertEqual(resp.status_code, 500)
            self.assertIn("Failed to cancel", resp.json()["detail"])
        finally:
            with download_manager._lock:
                download_manager._jobs.pop(job_id, None)

    def test_15_manifest_creation_failure_preserves_prior_target(self):
        """Tests that if manifest writing fails during worker commit, pre-existing target file is restored and job is marked FAILED."""
        clean_name = "test_preserve_on_manifest_fail.nc"
        target_path = download_manager.raw_dir / clean_name
        original_content = b"sacred_target_content_preserved_before_manifest_fail"

        with open(target_path, "wb") as f:
            f.write(original_content)

        orig_hash = compute_file_sha256(target_path)

        req = SubsetCommandRequest(
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            start_date="2025-01-01",
            end_date="2025-01-02",
            output_filename=clean_name
        )
        resp = download_manager.generate_command(req)
        job_id = "test_manifest_write_fail_job"
        staging_name = f".stage_{job_id}_{clean_name}"
        staging_path = download_manager.raw_dir / staging_name

        with download_manager._lock:
            download_manager._jobs[job_id] = {
                "job_id": job_id,
                "dataset_id": req.dataset_id,
                "status": DownloadJobStatus.QUEUED,
                "command": resp.command,
                "target_file": str(target_path),
                "part_file": str(staging_path),
                "staging_file": str(staging_path),
                "_exec_command": subprocess.list2cmdline([
                    sys.executable, "-c",
                    f"import pathlib; pathlib.Path(r'{staging_path}').write_bytes(b'new_download_content_that_failed_manifesting')"
                ]),
                "bytes_downloaded": 0,
                "estimated_bytes": 1000,
                "progress_pct": 0.0,
                "error": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": None,
                "manifest": None,
                "_process": None,
                "_launching": False,
                "_launch_event": threading.Event(),
                "_cancelled": False
            }

        # Patch open so that writing to manifests_dir raises an error
        orig_open = open
        def faulty_open(file, *args, **kwargs):
            if isinstance(file, (str, Path)) and str(download_manager.manifests_dir) in str(file) and any(m in str(args) or m in str(kwargs) for m in ('w', 'wb', 'a')):
                raise IOError("Simulated disk write failure on manifest file")
            return orig_open(file, *args, **kwargs)

        try:
            with unittest.mock.patch("builtins.open", side_effect=faulty_open):
                # Run the actual worker
                download_manager._run_job(job_id, req, resp)

            # Assert target file was preserved/restored and still holds original content/hash
            self.assertTrue(target_path.exists())
            with open(target_path, "rb") as f:
                self.assertEqual(f.read(), original_content)
            self.assertEqual(compute_file_sha256(target_path), orig_hash)
            self.assertFalse(staging_path.exists(), "Staging file must be cleaned up on failure")

            status = download_manager.get_job_status(job_id)
            self.assertEqual(status.status, DownloadJobStatus.FAILED)
            self.assertIn("Atomic publication failed", status.error)
        finally:
            if target_path.exists():
                target_path.unlink()
            if staging_path.exists():
                staging_path.unlink()
            with download_manager._lock:
                download_manager._jobs.pop(job_id, None)

    def test_16a_cancellation_racing_before_publish_lock(self):
        """Tests that if cancellation is requested right before the atomic commit block in _run_job, target is untouched and staging cleaned up."""
        clean_name = "test_cancel_before_pub_lock.nc"
        target_path = download_manager.raw_dir / clean_name
        original_content = b"original_target_content_before_race"

        with open(target_path, "wb") as f:
            f.write(original_content)

        orig_hash = compute_file_sha256(target_path)
        job_id = "test_pub_race_before_lock"
        staging_name = f".stage_{job_id}_{clean_name}"
        staging_path = download_manager.raw_dir / staging_name

        req = SubsetCommandRequest(
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            start_date="2025-01-01",
            end_date="2025-01-02",
            output_filename=clean_name
        )
        resp = download_manager.generate_command(req)

        with download_manager._lock:
            download_manager._jobs[job_id] = {
                "job_id": job_id,
                "dataset_id": req.dataset_id,
                "status": DownloadJobStatus.QUEUED,
                "command": resp.command,
                "target_file": str(target_path),
                "part_file": str(staging_path),
                "staging_file": str(staging_path),
                "_exec_command": subprocess.list2cmdline([
                    sys.executable, "-c",
                    f"import pathlib; pathlib.Path(r'{staging_path}').write_bytes(b'new_in_flight_download_data')"
                ]),
                "bytes_downloaded": 0,
                "estimated_bytes": 1000,
                "progress_pct": 0.0,
                "error": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": None,
                "manifest": None,
                "_process": None,
                "_launching": False,
                "_launch_event": threading.Event(),
                "_cancelled": False
            }

        # Hook compute_file_sha256 so that right as manifest is prepared, we invoke cancel_job
        orig_sha = compute_file_sha256
        def hook_sha(path):
            if str(staging_path) in str(path):
                download_manager.cancel_job(job_id)
            return orig_sha(path)

        try:
            with unittest.mock.patch("backend.app.data.download_manager.compute_file_sha256", side_effect=hook_sha):
                download_manager._run_job(job_id, req, resp)

            self.assertTrue(target_path.exists())
            with open(target_path, "rb") as f:
                self.assertEqual(f.read(), original_content)
            self.assertEqual(compute_file_sha256(target_path), orig_hash)
            self.assertFalse(staging_path.exists(), "Staging file must be cleaned up")

            status = download_manager.get_job_status(job_id)
            self.assertEqual(status.status, DownloadJobStatus.CANCELLED)
        finally:
            if target_path.exists():
                target_path.unlink()
            if staging_path.exists():
                staging_path.unlink()
            with download_manager._lock:
                download_manager._jobs.pop(job_id, None)

    def test_16b_cancellation_racing_after_publish_lock(self):
        """Tests that if cancellation is requested after the atomic commit lock completes, the job remains COMPLETED and cancel_job returns False."""
        clean_name = "test_cancel_after_pub_lock.nc"
        target_path = download_manager.raw_dir / clean_name
        job_id = "test_pub_race_after_lock"
        staging_name = f".stage_{job_id}_{clean_name}"
        staging_path = download_manager.raw_dir / staging_name

        req = SubsetCommandRequest(
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            start_date="2025-01-01",
            end_date="2025-01-02",
            output_filename=clean_name
        )
        resp = download_manager.generate_command(req)

        with download_manager._lock:
            download_manager._jobs[job_id] = {
                "job_id": job_id,
                "dataset_id": req.dataset_id,
                "status": DownloadJobStatus.QUEUED,
                "command": resp.command,
                "target_file": str(target_path),
                "part_file": str(staging_path),
                "staging_file": str(staging_path),
                "_exec_command": subprocess.list2cmdline([
                    sys.executable, "-c",
                    f"import pathlib; pathlib.Path(r'{staging_path}').write_bytes(b'committed_ocean_data_payload')"
                ]),
                "bytes_downloaded": 0,
                "estimated_bytes": 1000,
                "progress_pct": 0.0,
                "error": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": None,
                "manifest": None,
                "_process": None,
                "_launching": False,
                "_launch_event": threading.Event(),
                "_cancelled": False
            }

        try:
            download_manager._run_job(job_id, req, resp)

            status = download_manager.get_job_status(job_id)
            self.assertEqual(status.status, DownloadJobStatus.COMPLETED)
            self.assertTrue(target_path.exists())

            # Attempt cancellation after completion has occurred
            res = download_manager.cancel_job(job_id)
            self.assertFalse(res, "cancel_job must return False when job is already COMPLETED")

            status2 = download_manager.get_job_status(job_id)
            self.assertEqual(status2.status, DownloadJobStatus.COMPLETED, "Completed status must remain immutable")
        finally:
            if target_path.exists():
                target_path.unlink()
            if staging_path.exists():
                staging_path.unlink()
            for p in download_manager.manifests_dir.glob(f"manifest_{Path(clean_name).stem}*.json"):
                try:
                    p.unlink()
                except Exception:
                    pass
            with download_manager._lock:
                download_manager._jobs.pop(job_id, None)

    def test_17_atomic_staging_publication_on_success(self):
        """Tests that staging file is atomically published to final target upon successful worker run."""
        clean_name = "test_publish_output.nc"
        target_path = download_manager.raw_dir / clean_name
        job_id = "test_atomic_pub_worker_01"
        staging_name = f".stage_{job_id}_{clean_name}"
        staging_path = download_manager.raw_dir / staging_name

        req = SubsetCommandRequest(
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            start_date="2025-01-01",
            end_date="2025-01-02",
            output_filename=clean_name
        )
        resp = download_manager.generate_command(req)

        with download_manager._lock:
            download_manager._jobs[job_id] = {
                "job_id": job_id,
                "dataset_id": req.dataset_id,
                "status": DownloadJobStatus.QUEUED,
                "command": resp.command,
                "target_file": str(target_path),
                "part_file": str(staging_path),
                "staging_file": str(staging_path),
                "_exec_command": subprocess.list2cmdline([
                    sys.executable, "-c",
                    f"import pathlib; pathlib.Path(r'{staging_path}').write_bytes(b'verified_atomic_ocean_netcdf_payload_content')"
                ]),
                "bytes_downloaded": 0,
                "estimated_bytes": 1000,
                "progress_pct": 0.0,
                "error": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": None,
                "manifest": None,
                "_process": None,
                "_launching": False,
                "_launch_event": threading.Event(),
                "_cancelled": False
            }

        try:
            download_manager._run_job(job_id, req, resp)

            self.assertTrue(target_path.exists(), "Target file must exist after publication")
            self.assertFalse(staging_path.exists(), "Staging file must have been renamed/published")
            status = download_manager.get_job_status(job_id)
            self.assertEqual(status.status, DownloadJobStatus.COMPLETED)
            self.assertEqual(status.progress_pct, 100.0)
            self.assertIsNotNone(status.manifest)
            self.assertEqual(status.manifest.file_name, clean_name)
        finally:
            if target_path.exists():
                target_path.unlink()
            if staging_path.exists():
                staging_path.unlink()
            for p in download_manager.manifests_dir.glob(f"manifest_{Path(clean_name).stem}*.json"):
                try:
                    p.unlink()
                except Exception:
                    pass
            with download_manager._lock:
                download_manager._jobs.pop(job_id, None)

    def test_18_preserve_preexisting_target_on_cancellation_or_failure(self):
        """Tests that a pre-existing target file remains intact and unmodified if a subsequent download is cancelled or fails."""
        clean_name = "test_preserve_existing.nc"
        target_path = download_manager.raw_dir / clean_name
        original_content = b"original_sacred_valid_target_data_12345"

        with open(target_path, "wb") as f:
            f.write(original_content)

        orig_hash = compute_file_sha256(target_path)
        job_id = "test_preserve_01"
        staging_name = f".stage_{job_id}_{clean_name}"
        staging_path = download_manager.raw_dir / staging_name

        with open(staging_path, "wb") as f:
            f.write(b"partial_corrupt_in_flight_bytes")

        try:
            with download_manager._lock:
                download_manager._jobs[job_id] = {
                    "job_id": job_id,
                    "dataset_id": "test_dataset",
                    "status": DownloadJobStatus.RUNNING,
                    "command": "mock",
                    "target_file": str(target_path),
                    "part_file": str(staging_path),
                    "staging_file": str(staging_path),
                    "bytes_downloaded": 100,
                    "estimated_bytes": 1000,
                    "progress_pct": 10.0,
                    "error": None,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "completed_at": None,
                    "manifest": None,
                    "_process": None,
                    "_cancelled": False
                }

            # Cancel job
            download_manager.cancel_job(job_id)

            # Assert staging file is deleted
            self.assertFalse(staging_path.exists(), "Staging file must be cleaned up on cancellation")

            # Assert pre-existing target file is still completely intact
            self.assertTrue(target_path.exists(), "Pre-existing target file must be preserved")
            with open(target_path, "rb") as f:
                self.assertEqual(f.read(), original_content)
            self.assertEqual(compute_file_sha256(target_path), orig_hash)
        finally:
            if target_path.exists():
                target_path.unlink()
            if staging_path.exists():
                staging_path.unlink()
            with download_manager._lock:
                download_manager._jobs.pop(job_id, None)

    def test_19_progress_sampling_never_counts_preexisting_target(self):
        """Tests that get_job_status samples progress strictly from the staging file, never from a pre-existing target file."""
        clean_name = "test_no_spoof.nc"
        target_path = download_manager.raw_dir / clean_name
        # Pre-existing target file of 800 KB
        with open(target_path, "wb") as f:
            f.write(b"0" * (800 * 1024))

        job_id = "test_no_spoof_01"
        staging_name = f".stage_{job_id}_{clean_name}"
        staging_path = download_manager.raw_dir / staging_name

        try:
            # Staging file is empty (or not yet created)
            with download_manager._lock:
                download_manager._jobs[job_id] = {
                    "job_id": job_id,
                    "dataset_id": "test_dataset",
                    "status": DownloadJobStatus.RUNNING,
                    "command": "mock",
                    "target_file": str(target_path),
                    "part_file": str(staging_path),
                    "staging_file": str(staging_path),
                    "bytes_downloaded": 0,
                    "estimated_bytes": 1000 * 1024,
                    "progress_pct": 0.0,
                    "error": None,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "completed_at": None,
                    "manifest": None,
                    "_process": None,
                    "_cancelled": False
                }

            status = download_manager.get_job_status(job_id)
            self.assertEqual(status.bytes_downloaded, 0, "Must not count bytes from pre-existing target file")
            self.assertEqual(status.progress_pct, 0.0)

            # Write 200 KB to staging file
            with open(staging_path, "wb") as f:
                f.write(b"0" * (200 * 1024))

            status = download_manager.get_job_status(job_id)
            self.assertEqual(status.bytes_downloaded, 200 * 1024, "Must sample bytes strictly from staging file")
            self.assertEqual(status.progress_pct, 20.0)
        finally:
            if target_path.exists():
                target_path.unlink()
            if staging_path.exists():
                staging_path.unlink()
            with download_manager._lock:
                download_manager._jobs.pop(job_id, None)


if __name__ == "__main__":
    unittest.main()
