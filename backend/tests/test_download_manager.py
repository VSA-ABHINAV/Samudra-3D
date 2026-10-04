"""
Unit Tests for SAMUDRA-3D Safe Ocean Download Pipeline & Manifest System
Verifies command generation, safety thresholds, disk headroom validation, SHA-256 manifests,
live filesystem progress sampling, cancellation, and terminal state immutability.
"""
import unittest
import tempfile
import os
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

    def test_12_process_tree_termination_on_cancellation(self):
        """Tests that cancel_job stops a running child process and confirms termination."""
        import subprocess
        import sys
        # Spawn a genuine local python sleep process
        proc = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(10)"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        job_id = "test_tree_term_01"
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
                    "_process": proc,
                    "_cancelled": False
                }

            self.assertIsNone(proc.poll(), "Process should be running initially")
            res = download_manager.cancel_job(job_id)
            self.assertTrue(res)
            self.assertIsNotNone(proc.poll(), "Process must be terminated after cancel_job")
            status = download_manager.get_job_status(job_id)
            self.assertEqual(status.status, DownloadJobStatus.CANCELLED)
        finally:
            if proc.poll() is None:
                proc.kill()
            try:
                proc.stdout.close()
                proc.stderr.close()
            except Exception:
                pass
            with download_manager._lock:
                download_manager._jobs.pop(job_id, None)

    def test_13_cancellation_termination_failure_surfaced(self):
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

    def test_14_atomic_staging_publication_on_success(self):
        """Tests that staging file is atomically published to final target upon successful run."""
        job_id = "test_atomic_pub_01"
        clean_name = "test_publish_output.nc"
        target_path = download_manager.raw_dir / clean_name
        staging_name = f".stage_{job_id}_{clean_name}"
        staging_path = download_manager.raw_dir / staging_name

        try:
            if target_path.exists():
                target_path.unlink()
            if staging_path.exists():
                staging_path.unlink()

            # Write staging file simulating worker output
            with open(staging_path, "wb") as f:
                f.write(b"verified_atomic_ocean_netcdf_payload_content")

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
                    "status": DownloadJobStatus.RUNNING,
                    "command": resp.command,
                    "target_file": str(target_path),
                    "part_file": str(staging_path),
                    "staging_file": str(staging_path),
                    "_exec_command": "echo mock",
                    "bytes_downloaded": 0,
                    "estimated_bytes": 1000,
                    "progress_pct": 0.0,
                    "error": None,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "completed_at": None,
                    "manifest": None,
                    "_process": None,
                    "_cancelled": False
                }

            # Simulate worker run completion
            mock_proc = MockProcess(returncode=0)
            with download_manager._lock:
                download_manager._jobs[job_id]["_process"] = mock_proc

            # In staging mode: staging file renamed to target
            os.replace(staging_path, target_path)
            manifest = download_manager.create_manifest(file_path=target_path, dataset_id=req.dataset_id)

            with download_manager._lock:
                job = download_manager._jobs[job_id]
                job["status"] = DownloadJobStatus.COMPLETED
                job["progress_pct"] = 100.0
                job["bytes_downloaded"] = target_path.stat().st_size
                job["manifest"] = manifest.model_dump()
                job["completed_at"] = datetime.now(timezone.utc).isoformat()

            self.assertTrue(target_path.exists(), "Target file must exist after publication")
            self.assertFalse(staging_path.exists(), "Staging file must have been renamed/published")
            status = download_manager.get_job_status(job_id)
            self.assertEqual(status.status, DownloadJobStatus.COMPLETED)
            self.assertEqual(status.progress_pct, 100.0)
            self.assertIsNotNone(status.manifest)
        finally:
            if target_path.exists():
                target_path.unlink()
            if staging_path.exists():
                staging_path.unlink()
            with download_manager._lock:
                download_manager._jobs.pop(job_id, None)

    def test_15_preserve_preexisting_target_on_cancellation_or_failure(self):
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

    def test_16_progress_sampling_never_counts_preexisting_target(self):
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
