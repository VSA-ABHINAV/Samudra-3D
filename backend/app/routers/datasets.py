"""
SAMUDRA-3D Dataset Management Router
Exposes endpoints for cataloging, selecting, estimating download sizes,
generating safe CLI commands, tracking download manifests, and registering ocean datasets.
"""
from typing import List, Optional, Dict, Any
from pathlib import Path
from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, status

from backend.app.data.registry import dataset_registry, DatasetDescriptor, SourceMode
from backend.app.data.estimator import (
    SizeEstimateRequest,
    SizeEstimateResponse,
    estimate_dataset_download_size
)
from backend.app.data.download_manager import (
    download_manager,
    SubsetCommandRequest,
    SubsetCommandResponse,
    ManifestRecord,
    DownloadJobInfo
)
from backend.app.services.ocean_service import ocean_service

router = APIRouter(prefix="/api/datasets", tags=["Dataset Management"])


class SelectDatasetRequest(BaseModel):
    dataset_id: str = Field(..., description="ID of the dataset to activate (e.g. cmems_mod_glo_phy_my_0.083deg_P1D-m or incois_roms_synthetic)")


class SelectDatasetResponse(BaseModel):
    status: str
    message: str
    active_dataset: DatasetDescriptor


class CustomDatasetRegisterRequest(BaseModel):
    dataset_id: str = Field(..., description="Unique slug for the dataset")
    name: str = Field(..., description="Human-readable title")
    provider: str = Field(..., description="Institution or data provider")
    local_path: Optional[str] = Field(None, description="Absolute or relative file path on disk")
    remote_url: Optional[str] = Field(None, description="Remote access URL or WMS/OpenDAP endpoint")
    format: str = Field("NetCDF-4", description="Data format (NetCDF-4, GRIB2, Zarr, CSV)")
    spatial_resolution: str = Field("0.083 degree (~8.3 km)", description="Spatial grid resolution")
    coverage_bounds: Optional[Dict[str, float]] = Field(None, description="Bounding box {lat_min, lat_max, lon_min, lon_max}")


class DatasetsListResponse(BaseModel):
    total_datasets: int
    active_dataset_id: Optional[str]
    active_source_mode: Optional[str]
    datasets: List[DatasetDescriptor]


class StartDownloadRequest(BaseModel):
    subset_request: SubsetCommandRequest
    force_override: bool = False


@router.get("", response_model=DatasetsListResponse, summary="List all registered ocean datasets")
def list_datasets():
    """
    Returns the full registry of available ocean numerical models, real reanalysis products,
    and fallback fixtures, with provenance and active status.
    """
    active = dataset_registry.get_active_dataset()
    return DatasetsListResponse(
        total_datasets=len(dataset_registry.list_datasets()),
        active_dataset_id=active.dataset_id if active else None,
        active_source_mode=active.source_mode.value if active else None,
        datasets=dataset_registry.list_datasets()
    )


@router.post("/select", response_model=SelectDatasetResponse, summary="Switch active ocean dataset")
def select_dataset(req: SelectDatasetRequest):
    """
    Switches the platform's active numerical ocean dataset at runtime.
    Allows toggling between real Copernicus Marine GLORYS12V1 and synthetic ROMS baseline.
    """
    try:
        ocean_service.set_active_dataset(req.dataset_id)
        active = dataset_registry.get_active_dataset()
        return SelectDatasetResponse(
            status="success",
            message=f"Active dataset switched to '{active.name}' ({active.source_mode.value})",
            active_dataset=active
        )
    except KeyError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Dataset is unavailable or missing file: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to activate dataset: {str(e)}"
        )


@router.post("/estimate-size", response_model=SizeEstimateResponse, summary="Estimate download size for ocean data subset")
def estimate_size(req: SizeEstimateRequest):
    """
    Calculates raw uncompressed size and estimated compressed NetCDF4 transfer size
    based on bounding box, vertical levels, temporal span, and grid resolution.
    Checks available local disk space.
    """
    try:
        return estimate_dataset_download_size(req)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error estimating dataset size: {str(e)}"
        )


@router.post("/generate-command", response_model=SubsetCommandResponse, summary="Generate verified safe copernicusmarine subset CLI command")
def generate_subset_command(req: SubsetCommandRequest):
    """
    Constructs the exact, safe copernicusmarine CLI command for the requested ocean subset,
    verifying dimensions, calculating byte-size transfers, and evaluating safety thresholds.
    """
    try:
        return download_manager.generate_command(req)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to generate subset command: {str(e)}"
        )


@router.get("/manifests", response_model=List[ManifestRecord], summary="List all downloaded dataset manifests and SHA-256 checksums")
def list_manifests():
    """
    Returns verified manifest records for all NetCDF files downloaded or stored in SAMUDRA_DATA/raw,
    including SHA-256 hashes, byte sizes, bounds, and provenance.
    """
    return download_manager.list_manifests()


@router.get("/manifests/{manifest_id}", response_model=ManifestRecord, summary="Retrieve a specific download manifest")
def get_manifest(manifest_id: str):
    """
    Returns single manifest record by manifest_id or filename match.
    """
    m = download_manager.get_manifest(manifest_id)
    if not m:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Manifest '{manifest_id}' not found"
        )
    return m


@router.post("/download", response_model=DownloadJobInfo, summary="Start atomic chunked download job")
def start_download(req: StartDownloadRequest):
    """
    Initiates an asynchronous atomic download job for the specified ocean subset.
    """
    try:
        return download_manager.start_download_job(req.subset_request, force_override=req.force_override)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Download initiation failed: {str(e)}"
        )


@router.get("/download/status/{job_id}", response_model=DownloadJobInfo, summary="Get download job status")
def get_download_status(job_id: str):
    """
    Polls live progress and status of a download job.
    """
    st = download_manager.get_job_status(job_id)
    if not st:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' not found"
        )
    return st


@router.post("/download/cancel/{job_id}", summary="Cancel active download job")
def cancel_download(job_id: str):
    """
    Cancels an active download job and cleans up temporary staging files.
    """
    try:
        ok = download_manager.cancel_job(job_id)
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Job '{job_id}' not found or already terminated"
            )
        return {"status": "cancelled", "job_id": job_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cancel job '{job_id}': {str(e)}"
        )


@router.post("/custom", response_model=DatasetDescriptor, summary="Register custom dataset or sensor feed")
def register_custom_dataset(req: CustomDatasetRegisterRequest):
    """
    Enables users and researchers to link their own regional NetCDF files or remote feeds.
    """
    try:
        file_path = None
        size_bytes = 0
        status_val = "READY"
        
        if req.local_path:
            p = Path(req.local_path).resolve()
            if not p.exists():
                status_val = "FILE_NOT_FOUND"
            else:
                size_bytes = p.stat().st_size
                file_path = str(p)

        desc = DatasetDescriptor(
            dataset_id=req.dataset_id,
            name=req.name,
            provider=req.provider,
            source_mode=SourceMode.REAL_LOCAL if file_path else SourceMode.REMOTE_LIVE,
            access_method="LOCAL_FILE" if file_path else "REMOTE_URL",
            local_path=file_path,
            remote_url=req.remote_url,
            format=req.format,
            spatial_resolution=req.spatial_resolution,
            spatial_resolution_km=8.33,
            temporal_resolution="Custom",
            coverage_bounds=req.coverage_bounds or {"lat_min": 0.0, "lat_max": 25.0, "lon_min": 50.0, "lon_max": 100.0},
            depth_range=[0.0, 100.0],
            time_range=[],
            status=status_val,
            size_bytes=size_bytes,
            provenance={
                "custom_registration": True,
                "provider": req.provider
            },
            is_active=False
        )
        dataset_registry._datasets[desc.dataset_id] = desc
        return desc
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to register custom dataset: {str(e)}"
        )
