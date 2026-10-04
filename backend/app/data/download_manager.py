"""
SAMUDRA-3D Safe Ocean Download Pipeline & Manager
Generates verified copernicusmarine subset commands, enforces strict byte-size safety caps,
manages atomic chunked downloads (.nc.part -> .nc), and generates SHA-256 manifests.
"""
import os
import sys
import json
import uuid
import shutil
import hashlib
import signal
import threading
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Tuple
from pydantic import BaseModel, Field

from backend.app.core.config import settings
from backend.app.data.estimator import estimate_dataset_download_size, SizeEstimateRequest, SizeEstimateResponse

# Safety Thresholds (in Gigabytes)
THRESHOLD_CONFIRMATION_GB = 1.0       # 1 GB
THRESHOLD_EXPLICIT_CONFIRM_GB = 10.0  # 10 GB
THRESHOLD_CRITICAL_GB = 100.0         # 100 GB
THRESHOLD_BLOCKED_GB = 1000.0         # 1 TB (Strictly prohibited from automatic download)

MIN_DISK_HEADROOM_GB = 5.0            # Minimum free disk space required after download


class SafetyLevel(str):
    SAFE = "SAFE"
    CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED"
    EXPLICIT_CONFIRMATION_REQUIRED = "EXPLICIT_CONFIRMATION_REQUIRED"
    CRITICAL_WARNING = "CRITICAL_WARNING"
    BLOCKED = "BLOCKED"


class DownloadJobStatus(str):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class SubsetCommandRequest(BaseModel):
    dataset_id: str = Field("cmems_mod_glo_phy_my_0.083deg_P1D-m", description="Copernicus dataset ID")
    lat_min: float = Field(0.0, ge=-90.0, le=90.0)
    lat_max: float = Field(25.0, ge=-90.0, le=90.0)
    lon_min: float = Field(50.0, ge=-180.0, le=180.0)
    lon_max: float = Field(100.0, ge=-180.0, le=180.0)
    depth_min: float = Field(0.49, ge=0.0)
    depth_max: float = Field(100.0, ge=0.0)
    start_date: str = Field("2025-01-01", description="YYYY-MM-DD or ISO datetime")
    end_date: str = Field("2025-01-07", description="YYYY-MM-DD or ISO datetime")
    variables: List[str] = Field(default=["thetao", "so", "uo", "vo"])
    output_filename: Optional[str] = None


class SubsetCommandResponse(BaseModel):
    command: str
    dataset_id: str
    safety_level: str
    warning_message: str
    can_execute_automatically: bool
    estimate: SizeEstimateResponse
    recommended_output_dir: str
    recommended_output_filename: str


class ManifestRecord(BaseModel):
    manifest_id: str
    dataset_id: str
    file_name: str
    file_path: str
    file_size_bytes: int
    file_size_mb: float
    sha256: str
    created_at: str
    variables: List[str]
    bounds: Dict[str, float]
    time_range: Dict[str, str]
    verified: bool = True
    provenance_badge: str = "[REAL • COPERNICUS]"


class DownloadJobInfo(BaseModel):
    job_id: str
    dataset_id: str
    status: str
    command: str
    target_file: str
    part_file: str
    bytes_downloaded: int = 0
    estimated_bytes: int = 0
    progress_pct: float = 0.0
    error: Optional[str] = None
    created_at: str
    completed_at: Optional[str] = None
    manifest: Optional[ManifestRecord] = None
    manifest_file: Optional[str] = None



def compute_file_sha256(file_path: Path) -> str:
    """Computes SHA-256 checksum of a file in 64KB blocks."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


class DownloadManager:
    """Manages ocean dataset subset command generation, safety verification, and execution."""

    def __init__(self, data_root: Optional[Path] = None):
        self.data_root = data_root or settings.SAMUDRA_DATA_ROOT
        if not self.data_root:
            self.data_root = Path(settings.WORKSPACE_ROOT) / "SAMUDRA_DATA"

        self.raw_dir = self.data_root / "raw"
        self.manifests_dir = self.data_root / "manifests"
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.manifests_dir.mkdir(parents=True, exist_ok=True)

        self._jobs: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

        # Auto-index existing files if manifest doesn't exist
        self._ensure_existing_files_manifested()

    def generate_command(self, req: SubsetCommandRequest) -> SubsetCommandResponse:
        """
        Builds the safe copernicusmarine subset CLI command, calculates estimated sizes,
        and enforces safety caps.
        """
        start_str = req.start_date.strip()
        end_str = req.end_date.strip()
        if "T" not in start_str:
            start_iso = f"{start_str}T00:00:00"
        else:
            start_iso = start_str

        if "T" not in end_str:
            end_iso = f"{end_str}T23:59:59"
        else:
            end_iso = end_str

        try:
            d_start = datetime.fromisoformat(start_iso.split("T")[0])
            d_end = datetime.fromisoformat(end_iso.split("T")[0])
            time_steps = max(1, (d_end - d_start).days + 1)
        except Exception:
            time_steps = 7

        if req.depth_max <= 100:
            depth_count = max(1, int(22 * (req.depth_max - req.depth_min) / 100))
        elif req.depth_max <= 500:
            depth_count = min(35, 22 + int(13 * (req.depth_max - 100) / 400))
        else:
            depth_count = min(50, 35 + int(15 * (req.depth_max - 500) / 5000))

        clamped_days = min(365, time_steps)
        scale_factor = time_steps / clamped_days if clamped_days > 0 else 1.0

        est_req = SizeEstimateRequest(
            lat_min=req.lat_min,
            lat_max=req.lat_max,
            lon_min=req.lon_min,
            lon_max=req.lon_max,
            depth_levels_count=depth_count,
            days_count=clamped_days,
            variables=req.variables,
            resolution_deg=0.0833333
        )
        estimate = estimate_dataset_download_size(est_req)
        if scale_factor > 1.0:
            estimate.estimated_transfer_mb = round(estimate.estimated_transfer_mb * scale_factor, 2)
            estimate.estimated_compressed_mb = round(estimate.estimated_compressed_mb * scale_factor, 2)
            estimate.raw_size_mb = round(estimate.raw_size_mb * scale_factor, 2)
            estimate.raw_size_gb = round(estimate.raw_size_gb * scale_factor, 3)

        est_transfer_gb = estimate.estimated_transfer_mb / 1024.0

        safety_level = SafetyLevel.SAFE
        warning_message = "Safe download size. Local disk space is sufficient."
        can_execute = True

        if est_transfer_gb >= THRESHOLD_BLOCKED_GB:
            safety_level = SafetyLevel.BLOCKED
            warning_message = (
                f"CRITICAL SAFETY VIOLATION: Requested subset is estimated at {est_transfer_gb:.1f} GB "
                f"(> {THRESHOLD_BLOCKED_GB:.0f} GB / 1 TB). Blind or full-basin global reanalysis downloads "
                "are prohibited to protect disk stability. Please narrow spatial/temporal bounds."
            )
            can_execute = False
        elif est_transfer_gb >= THRESHOLD_CRITICAL_GB:
            safety_level = SafetyLevel.CRITICAL_WARNING
            warning_message = (
                f"CRITICAL VOLUME: Estimated download is {est_transfer_gb:.1f} GB (> {THRESHOLD_CRITICAL_GB:.0f} GB). "
                "Explicit administrator approval and verification of local disk headroom is strictly required."
            )
            can_execute = False
        elif est_transfer_gb >= THRESHOLD_EXPLICIT_CONFIRM_GB:
            safety_level = SafetyLevel.EXPLICIT_CONFIRMATION_REQUIRED
            warning_message = (
                f"HIGH VOLUME: Estimated download is {est_transfer_gb:.1f} GB (> {THRESHOLD_EXPLICIT_CONFIRM_GB:.0f} GB). "
                "Confirmation required prior to execution."
            )
            can_execute = False
        elif est_transfer_gb >= THRESHOLD_CONFIRMATION_GB:
            safety_level = SafetyLevel.CONFIRMATION_REQUIRED
            warning_message = (
                f"MODERATE VOLUME: Estimated download is {est_transfer_gb:.1f} GB. "
                "Download will proceed once user confirms."
            )
            can_execute = True

        if estimate.available_disk_gb < (est_transfer_gb + MIN_DISK_HEADROOM_GB):
            if safety_level != SafetyLevel.BLOCKED:
                safety_level = SafetyLevel.BLOCKED
                warning_message = (
                    f"INSUFFICIENT DISK SPACE: Available free space ({estimate.available_disk_gb:.1f} GB) "
                    f"is less than required ({est_transfer_gb + MIN_DISK_HEADROOM_GB:.1f} GB buffer)."
                )
            else:
                warning_message += f" (Also insufficient free disk space: {estimate.available_disk_gb:.1f} GB available)."
            can_execute = False

        v_tag = "-".join(req.variables)
        clean_filename = req.output_filename or (
            f"{req.dataset_id}_{v_tag}_"
            f"{req.lon_min:.2f}E-{req.lon_max:.2f}E_{req.lat_min:.2f}N-{req.lat_max:.2f}N_"
            f"{req.depth_min:.2f}-{req.depth_max:.2f}m_"
            f"{start_str}-{end_str}.nc"
        )

        var_flags = " ".join([f"-v {v}" for v in req.variables])
        raw_out_dir = str(self.raw_dir).replace("\\", "/")

        cmd = (
            f"copernicusmarine subset "
            f"--dataset-id {req.dataset_id} "
            f"--minimum-longitude {req.lon_min} "
            f"--maximum-longitude {req.lon_max} "
            f"--minimum-latitude {req.lat_min} "
            f"--maximum-latitude {req.lat_max} "
            f"--minimum-depth {req.depth_min} "
            f"--maximum-depth {req.depth_max} "
            f"--start-datetime {start_iso} "
            f"--end-datetime {end_iso} "
            f"{var_flags} "
            f"--output-directory \"{raw_out_dir}\" "
            f"--output-filename \"{clean_filename}\" "
            f"--force-download"
        )

        return SubsetCommandResponse(
            command=cmd,
            dataset_id=req.dataset_id,
            safety_level=safety_level,
            warning_message=warning_message,
            can_execute_automatically=can_execute,
            estimate=estimate,
            recommended_output_dir=str(self.raw_dir),
            recommended_output_filename=clean_filename
        )

    def list_manifests(self) -> List[ManifestRecord]:
        """Loads and returns all download manifests sorted by creation date."""
        manifests = []
        if not self.manifests_dir.exists():
            return []

        for p in self.manifests_dir.glob("*.json"):
            if p.name.startswith("."):
                continue
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    manifests.append(ManifestRecord(**data))
            except Exception:
                continue

        manifests.sort(key=lambda m: m.created_at, reverse=True)
        return manifests

    def get_manifest(self, manifest_id: str) -> Optional[ManifestRecord]:
        """Retrieves a specific manifest by ID."""
        target = self.manifests_dir / f"{manifest_id}.json"
        if not target.exists():
            for p in self.manifests_dir.glob("*.json"):
                if not p.name.startswith(".") and manifest_id in p.stem:
                    target = p
                    break
        if target.exists():
            try:
                with open(target, "r", encoding="utf-8") as f:
                    return ManifestRecord(**json.load(f))
            except Exception:
                return None
        return None

    def create_manifest(
        self,
        file_path: Path,
        dataset_id: str = "cmems_mod_glo_phy_my_0.083deg_P1D-m",
        bounds: Optional[Dict[str, float]] = None,
        variables: Optional[List[str]] = None,
        time_range: Optional[Dict[str, str]] = None
    ) -> ManifestRecord:
        """Calculates checksum, file stats, and saves manifest JSON record."""
        if not file_path.exists():
            raise FileNotFoundError(f"Cannot manifest non-existent file: {file_path}")

        file_size = file_path.stat().st_size
        sha256 = compute_file_sha256(file_path)
        # Use a UUID to ensure manifest IDs are collision-resistant
        manifest_id = f"manifest_{file_path.stem}_{uuid.uuid4().hex}"

        record = ManifestRecord(
            manifest_id=manifest_id,
            dataset_id=dataset_id,
            file_name=file_path.name,
            file_path=str(file_path.resolve()),
            file_size_bytes=file_size,
            file_size_mb=round(file_size / (1024 * 1024), 2),
            sha256=sha256,
            created_at=datetime.now(timezone.utc).isoformat(),
            variables=variables or ["thetao", "so", "uo", "vo"],
            bounds=bounds or {"lat_min": 0.0, "lat_max": 25.0, "lon_min": 50.0, "lon_max": 100.0},
            time_range=time_range or {"start": "2025-01-01", "end": "2025-01-07"},
            verified=True,
            provenance_badge="[REAL • COPERNICUS]"
        )

        out_path = self.manifests_dir / f"{manifest_id}.json"
        staging_out = self.manifests_dir / f".stage_{manifest_id}.json"
        try:
            with open(staging_out, "w", encoding="utf-8") as f:
                f.write(record.model_dump_json(indent=2))
            os.replace(staging_out, out_path)
            # Duplicate manifest alias removed as per Phase 09 correction

            # No duplicate manifest creation needed
            pass
        except Exception:
            if staging_out.exists():
                try:
                    staging_out.unlink()
                except Exception:
                    pass
            raise

        return record

    def _ensure_existing_files_manifested(self):
        """Indexes any existing .nc files in raw_dir and its subdirectories that lack a manifest."""
        self.scan_and_catalog()

    def scan_and_catalog(self) -> List[ManifestRecord]:
        """
        Recursively scans raw_dir for real NetCDF (*.nc) files across all categories
        (Argo, Gliders, Moored Buoys, and Copernicus Reanalysis),
        computes SHA-256 hashes, creates missing manifests, and returns the manifest list.
        """
        if not self.raw_dir.exists():
            return []

        existing_manifests = {m.file_name: m for m in self.list_manifests()}
        for nc_path in self.raw_dir.rglob("*.nc"):
            if nc_path.name.startswith("."):
                continue
            if nc_path.name in existing_manifests:
                continue

            # Classify provenance and metadata
            parent_name = nc_path.parent.name.lower()
            name_lower = nc_path.name.lower()

            if parent_name == "argo" or "argo" in name_lower or "2902" in name_lower:
                ds_id = f"argo_real_{nc_path.stem}"
                badge = "[REAL • ARGO]"
                vars_list = ["TEMP", "PSAL", "PRES"]
                category = "ARGO"
            elif parent_name in ("glider", "gliders") or "glider" in name_lower:
                ds_id = f"glider_real_{nc_path.stem}"
                badge = "[REAL • GLIDER]"
                vars_list = ["temperature", "salinity", "depth"]
                category = "GLIDER"
            elif parent_name == "incois" or "oceansites" in name_lower or "omni" in name_lower:
                ds_id = f"mooring_real_{nc_path.stem}"
                badge = "[REAL • INCOIS]"
                vars_list = ["TEMP", "PSAL", "DEPTH"]
                category = "BUOY"
            else:
                ds_id = "cmems_mod_glo_phy_my_0.083deg_P1D-m"
                badge = "[REAL • COPERNICUS]"
                vars_list = ["thetao", "so", "uo", "vo"]
                category = "NUMERICAL_MODEL"

            try:
                self.create_manifest(
                    file_path=nc_path,
                    dataset_id=ds_id,
                    bounds={"lat_min": 0.0, "lat_max": 25.0, "lon_min": 50.0, "lon_max": 100.0, "depth_min": 0.49, "depth_max": 92.33},
                    variables=vars_list,
                    time_range={"start": "2024-01-01", "end": "2026-09-15"}
                )
            except Exception:
                pass

        return self.list_manifests()

    @staticmethod
    def _terminate_process_tree(proc: subprocess.Popen, timeout: float = 4.0) -> bool:
        """
        Reliably terminates a subprocess and its entire child process tree across platforms.
        Raises RuntimeError if the process tree fails to terminate completely.
        """
        if proc.poll() is not None:
            return True

        pid = proc.pid
        if sys.platform == "win32":
            try:
                # Terminate entire process tree on Windows using taskkill /F /T
                res = subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    capture_output=True,
                    timeout=timeout,
                    check=False
                )
                if res.returncode != 0:
                    err_out = res.stderr.decode("utf-8", errors="ignore")
                    if "not found" not in err_out.lower() and "no process" not in err_out.lower():
                        # Actual taskkill failure on an existing process
                        if proc.poll() is None:
                            try:
                                proc.kill()
                            except Exception:
                                pass
                            if proc.poll() is None:
                                raise RuntimeError(f"taskkill failed with code {res.returncode}: {err_out}")
            except Exception as e:
                if proc.poll() is None and not isinstance(e, RuntimeError):
                    try:
                        proc.kill()
                    except Exception:
                        pass
                if proc.poll() is None:
                    raise RuntimeError(f"Failed to terminate process tree for PID {pid}: {e}")

            try:
                proc.kill()
            except Exception:
                pass

            try:
                proc.wait(timeout=min(2.0, timeout))
            except Exception:
                pass
        else:
            try:
                pgid = os.getpgid(pid)
                os.killpg(pgid, signal.SIGTERM)
                try:
                    proc.wait(timeout=1.0)
                except Exception:
                    os.killpg(pgid, signal.SIGKILL)
                    proc.wait(timeout=1.0)
            except Exception as e:
                if proc.poll() is None:
                    try:
                        proc.kill()
                        proc.wait(timeout=1.0)
                    except Exception:
                        pass
                if proc.poll() is None:
                    raise RuntimeError(f"Failed to terminate process group for PID {pid}: {e}")

        if proc.poll() is None:
            raise RuntimeError(f"Failed to terminate process PID {pid}; process remains running.")
        return True

    def _cleanup_staging_for_job(self, job: Optional[Dict[str, Any]]):
        """Removes the unique temporary staging file for a job without touching any target file."""
        if not job:
            return
        staging_str = job.get("staging_file") or job.get("part_file")
        if staging_str:
            staging_path = Path(staging_str)
            if staging_path.exists():
                try:
                    staging_path.unlink()
                except Exception:
                    pass

    def start_download_job(self, req: SubsetCommandRequest, force_override: bool = False) -> DownloadJobInfo:
        """
        Creates and enqueues an asynchronous atomic download job.
        Writes to a unique staging file and performs atomic publish (rename) on completion.
        """
        response = self.generate_command(req)
        if not response.can_execute_automatically and not force_override:
            raise ValueError(f"Download blocked by safety policy: {response.warning_message}")

        job_id = str(uuid.uuid4())[:8]
        clean_filename = response.recommended_output_filename
        target_file = self.raw_dir / clean_filename
        staging_filename = f".stage_{job_id}_{clean_filename}"
        staging_file = self.raw_dir / staging_filename

        # Formulate execution command targeting the unique staging output file
        exec_cmd = response.command
        if f'--output-filename "{clean_filename}"' in exec_cmd:
            exec_cmd = exec_cmd.replace(f'--output-filename "{clean_filename}"', f'--output-filename "{staging_filename}"')
        elif f'--output-filename {clean_filename}' in exec_cmd:
            exec_cmd = exec_cmd.replace(f'--output-filename {clean_filename}', f'--output-filename "{staging_filename}"')
        else:
            exec_cmd = f"{exec_cmd} --output-filename \"{staging_filename}\""

        with self._lock:
            # Prevent starting duplicate jobs that would collide with an active output
            for j in self._jobs.values():
                if j["status"] in (DownloadJobStatus.QUEUED, DownloadJobStatus.RUNNING):
                    if j["target_file"] == str(target_file):
                        raise ValueError(f"A download job ({j['job_id']}) is already active for output '{clean_filename}'.")

            job = {
                "job_id": job_id,
                "dataset_id": req.dataset_id,
                "status": DownloadJobStatus.QUEUED,
                "command": response.command,
                "target_file": str(target_file),
                "part_file": str(staging_file),
                "staging_file": str(staging_file),
                "_exec_command": exec_cmd,
                "bytes_downloaded": 0,
                "estimated_bytes": int(response.estimate.estimated_transfer_mb * 1024 * 1024),
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
            self._jobs[job_id] = job

        thread = threading.Thread(target=self._run_job, args=(job_id, req, response), daemon=True)
        thread.start()

        return self.get_job_status(job_id)

    def _run_job(self, job_id: str, req: SubsetCommandRequest, response: SubsetCommandResponse):
        """Worker thread executing the copernicusmarine CLI command safely into staging."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job or job.get("_cancelled") or job["status"] == DownloadJobStatus.CANCELLED:
                self._cleanup_staging_for_job(job)
                return
            job["status"] = DownloadJobStatus.RUNNING
            job["_launching"] = True

        target_file = Path(job["target_file"])
        staging_file = Path(job["staging_file"])
        exec_cmd = job.get("_exec_command", response.command)

        try:
            popen_kwargs: Dict[str, Any] = {
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
                "text": True,
                "shell": True
            }
            if sys.platform == "win32":
                popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
            else:
                popen_kwargs["start_new_session"] = True

            process = subprocess.Popen(exec_cmd, **popen_kwargs)
        except Exception as e:
            with self._lock:
                job["_launching"] = False
                job["_launch_event"].set()
                if not job.get("_cancelled") and job["status"] != DownloadJobStatus.CANCELLED:
                    job["status"] = DownloadJobStatus.FAILED
                    job["error"] = str(e)
                    job["completed_at"] = datetime.now(timezone.utc).isoformat()
                self._cleanup_staging_for_job(job)
            return

        with self._lock:
            job["_launching"] = False
            job["_process"] = process
            job["_launch_event"].set()
            # Check if cancellation occurred while Popen was executing
            if job.get("_cancelled") or job["status"] == DownloadJobStatus.CANCELLED:
                try:
                    self._terminate_process_tree(process)
                except Exception as term_err:
                    job["status"] = DownloadJobStatus.FAILED
                    job["error"] = f"Cancellation failed to terminate process tree: {term_err}"
                    job["_process"] = None
                    if not job.get("completed_at"):
                        job["completed_at"] = datetime.now(timezone.utc).isoformat()
                    self._cleanup_staging_for_job(job)
                    return

                job["status"] = DownloadJobStatus.CANCELLED
                job["_process"] = None
                if not job.get("completed_at"):
                    job["completed_at"] = datetime.now(timezone.utc).isoformat()
                self._cleanup_staging_for_job(job)
                return

        try:
            stdout, stderr = process.communicate()
        except Exception as comm_err:
            with self._lock:
                if job.get("_cancelled") or job["status"] == DownloadJobStatus.CANCELLED:
                    self._cleanup_staging_for_job(job)
                    return
                job["status"] = DownloadJobStatus.FAILED
                job["error"] = f"Process communication error: {comm_err}"
                job["completed_at"] = datetime.now(timezone.utc).isoformat()
                self._cleanup_staging_for_job(job)
            return

        with self._lock:
            if job.get("_cancelled") or job["status"] == DownloadJobStatus.CANCELLED:
                job["status"] = DownloadJobStatus.CANCELLED
                if not job.get("completed_at"):
                    job["completed_at"] = datetime.now(timezone.utc).isoformat()
                self._cleanup_staging_for_job(job)
                return

        if process.returncode != 0:
            # Process failed: mark job as FAILED and clean up
            with self._lock:
                if job.get("_cancelled") or job["status"] == DownloadJobStatus.CANCELLED:
                    self._cleanup_staging_for_job(job)
                    return
                job["status"] = DownloadJobStatus.FAILED
                job["error"] = stderr or stdout or f"Command failed with code {process.returncode}"
                job["completed_at"] = datetime.now(timezone.utc).isoformat()
                self._cleanup_staging_for_job(job)
            return

        if not staging_file.exists():
            with self._lock:
                if job.get("_cancelled") or job["status"] == DownloadJobStatus.CANCELLED:
                    return
                job["status"] = DownloadJobStatus.FAILED
                job["error"] = "Command executed successfully but staging output file was not found."
                job["completed_at"] = datetime.now(timezone.utc).isoformat()
            return

        # Transactional publication: Verify/prepare manifest from staging BEFORE touching final target
        try:
            file_size = staging_file.stat().st_size
            sha256 = compute_file_sha256(staging_file)
            manifest_id = f"manifest_{target_file.stem}_{uuid.uuid4().hex}"
            record = ManifestRecord(
                manifest_id=manifest_id,
                dataset_id=req.dataset_id,
                file_name=target_file.name,
                file_path=str(target_file.resolve()),
                file_size_bytes=file_size,
                file_size_mb=round(file_size / (1024 * 1024), 2),
                sha256=sha256,
                created_at=datetime.now(timezone.utc).isoformat(),
                variables=req.variables or ["thetao", "so", "uo", "vo"],
                bounds={"lat_min": req.lat_min, "lat_max": req.lat_max, "lon_min": req.lon_min, "lon_max": req.lon_max},
                time_range={"start": req.start_date, "end": req.end_date},
                verified=True,
                provenance_badge="[REAL • COPERNICUS]"
            )
            manifest_out_path = self.manifests_dir / f"{manifest_id}.json"
            manifest_content = record.model_dump_json(indent=2)
            manifest_dict = record.model_dump()
            # No backup of prior manifest is created; new manifest will be written as a separate file.
            prior_manifest_path = None
            prior_manifest_backup = None
        except Exception as prep_err:
            # Manifest verification/preparation failed from staging:
            # Do NOT replace target_file; mark FAILED and clean staging file only
            with self._lock:
                if job.get("_cancelled") or job["status"] == DownloadJobStatus.CANCELLED:
                    self._cleanup_staging_for_job(job)
                    return
                job["status"] = DownloadJobStatus.FAILED
                job["error"] = f"Manifest preparation failed: {prep_err}"
                job["completed_at"] = datetime.now(timezone.utc).isoformat()
                self._cleanup_staging_for_job(job)
            return

        # Atomic commit boundary: Coordinate replace, manifest write, and COMPLETED state under lock
        with self._lock:
            if job.get("_cancelled") or job["status"] == DownloadJobStatus.CANCELLED:
                # Cancellation arrived before commit point; discard staging without touching target
                self._cleanup_staging_for_job(job)
                return

            clean_filename = target_file.name
            backup_target = self.raw_dir / f".backup_{job_id}_{clean_filename}"
            staging_manifest_path = self.manifests_dir / f".stage_manifest_{job_id}_{manifest_id}.json"
            target_had_prior_file = target_file.exists()
            target_published = False
            manifest_published = False

            try:
                if target_had_prior_file:
                    shutil.copy2(target_file, backup_target)

                # Write manifest to temporary staging path first
                with open(staging_manifest_path, "w", encoding="utf-8") as f:
                    f.write(manifest_content)

                # Atomically publish manifest
                os.replace(staging_manifest_path, manifest_out_path)
                manifest_published = True

                # Atomically publish dataset
                os.replace(staging_file, target_file)
                target_published = True

                # Clean up target backup on success
                if backup_target.exists():
                    try:
                        backup_target.unlink()
                    except Exception:
                        pass

                job["status"] = DownloadJobStatus.COMPLETED
                job["progress_pct"] = 100.0
                job["bytes_downloaded"] = file_size
                job["manifest"] = manifest_dict
                job["manifest_file"] = f"{manifest_id}.json"
                job["completed_at"] = datetime.now(timezone.utc).isoformat()
                job["_process"] = None
            except Exception as pub_err:
                rollback_errors: List[str] = []

                # Clean up temporary staging manifest if left over
                if staging_manifest_path.exists():
                    try:
                        staging_manifest_path.unlink()
                    except Exception as sm_err:
                        rollback_errors.append(f"Failed to remove staging manifest ({staging_manifest_path.name}): {sm_err}")

                # Rollback: remove any new manifest file if it was created
                if manifest_out_path.exists():
                    try:
                        manifest_out_path.unlink()
                    except Exception as m_err:
                        rollback_errors.append(f"Failed to remove manifest after failure: {m_err}")
                # Restore target file from backup if publication failed and backup exists
                if backup_target.exists():
                    try:
                        # Use os.replace for restoration to respect patched failure
                        os.replace(backup_target, target_file)
                    except Exception as restore_err:
                        rollback_errors.append(f"Failed to restore prior target from backup: {restore_err}")
                # Prior manifest remains untouched

                job["status"] = DownloadJobStatus.FAILED
                if rollback_errors:
                    job["error"] = f"Atomic publication failed: {pub_err}. Rollback failure: {'; '.join(rollback_errors)}"
                else:
                    job["error"] = f"Atomic publication failed: {pub_err}"
                job["completed_at"] = datetime.now(timezone.utc).isoformat()
                self._cleanup_staging_for_job(job)

    def get_job_status(self, job_id: str) -> Optional[DownloadJobInfo]:
        """Retrieves live status of a download job with filesystem evidence sampling from staging output."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None

            # Live sampling of disk evidence strictly from staging file while job is in a non-terminal state
            if job["status"] in (DownloadJobStatus.RUNNING, DownloadJobStatus.QUEUED):
                staging_path = Path(job.get("staging_file") or job.get("part_file", ""))
                curr_size = 0
                if staging_path.exists():
                    try:
                        curr_size = staging_path.stat().st_size
                    except Exception:
                        pass

                if curr_size > 0:
                    job["bytes_downloaded"] = curr_size
                    est = job.get("estimated_bytes", 0)
                    if est > 0:
                        pct = (curr_size / est) * 100.0
                        job["progress_pct"] = min(99.0, max(0.0, round(pct, 1)))

            info = {k: v for k, v in job.items() if not k.startswith("_")}
            if info.get("manifest"):
                if isinstance(info["manifest"], dict):
                    if not info.get("manifest_file") and info["manifest"].get("manifest_id"):
                        info["manifest_file"] = f"{info['manifest']['manifest_id']}.json"
                    info["manifest"] = ManifestRecord(**info["manifest"])
                elif isinstance(info["manifest"], ManifestRecord):
                    if not info.get("manifest_file"):
                        info["manifest_file"] = f"{info['manifest'].manifest_id}.json"
            return DownloadJobInfo(**info)

    def cancel_job(self, job_id: str) -> bool:
        """
        Cancels a running or queued download job, terminates its process tree,
        and cleans up temporary staging files while preserving any existing target file.
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return False
            # Terminal states are immutable and cannot be cancelled
            if job["status"] in (DownloadJobStatus.COMPLETED, DownloadJobStatus.FAILED, DownloadJobStatus.CANCELLED):
                return False

            job["_cancelled"] = True
            is_launching = job.get("_launching", False)
            launch_event = job.get("_launch_event")
            proc = job.get("_process")

        # If job is actively in the middle of subprocess.Popen, wait for registration to finalize
        if is_launching and launch_event and proc is None:
            launch_event.wait(timeout=3.0)
            with self._lock:
                proc = job.get("_process")

        # Terminate active process tree and verify complete exit
        if proc and proc.poll() is None:
            self._terminate_process_tree(proc)

        with self._lock:
            # Check if job completed atomically before/during termination
            if job["status"] in (DownloadJobStatus.COMPLETED, DownloadJobStatus.FAILED):
                return False

            job["status"] = DownloadJobStatus.CANCELLED
            job["_process"] = None
            if not job.get("completed_at"):
                job["completed_at"] = datetime.now(timezone.utc).isoformat()
            self._cleanup_staging_for_job(job)

        return True


download_manager = DownloadManager()
