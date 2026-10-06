"""
SAMUDRA-3D In-situ Observation Router
National Ocean Information Services / Marine Observation Network
"""
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, status
from backend.app.schemas.insitu import (
    ArgoProfileSummary,
    ArgoProfileDetail,
    GliderTransectSummary,
    GliderTransectDetail,
    BuoySummary,
    BuoyDetail,
    InsituStatusResponse,
    SensorRegistrationRequest
)
from backend.app.services.insitu_service import insitu_service

router = APIRouter(prefix="/api/insitu", tags=["In-situ Observations"])

@router.get("/profiles", summary="Retrieve all normalized in-situ profiles (Argo & Gliders & Buoys)")
def get_profiles(
    platform_type: Optional[str] = Query(None, description="Filter by platform type: 'argo', 'glider', or 'buoy'"),
    qc_filter: bool = Query(False, description="Filter out profiles/levels failing quality checks"),
    source_mode: Optional[str] = Query(None, description="Filter by source provenance: 'SYNTHETIC', 'REAL_LOCAL', or 'ALL'")
):
    """
    Returns normalized in-situ observation profiles.
    """
    return insitu_service.get_all_profiles(
        platform_type=platform_type,
        qc_filter=qc_filter,
        source_mode=source_mode
    )

@router.get("/argo", response_model=List[ArgoProfileSummary], summary="Retrieve Argo float profile summaries")
def get_argo_floats(
    qc_filter: bool = Query(False, description="Filter out profiles with bad QC flags"),
    source_mode: Optional[str] = Query(None, description="Filter by source mode ('SYNTHETIC' or 'REAL_LOCAL')")
):
    """Returns active Argo floats with coordinate positions, metadata, and quality summaries."""
    return insitu_service.get_argo_profiles(qc_filter=qc_filter, source_mode=source_mode)

@router.get("/argo/{float_id}", response_model=ArgoProfileDetail, summary="Retrieve single Argo profile by ID")
def get_argo_float_by_id(float_id: str):
    """Returns full vertical depth, temperature, salinity, and QC flags for a specific float."""
    profile = insitu_service.get_profile_by_id(float_id)
    if not profile or profile.get("platform_type") != "argo":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Float profile '{float_id}' not found"
        )
    return profile

@router.get("/gliders", response_model=List[GliderTransectSummary], summary="Retrieve underwater glider transects")
def get_glider_transects(
    qc_filter: bool = Query(False, description="Filter out transects with bad QC flags"),
    source_mode: Optional[str] = Query(None, description="Filter by source mode ('SYNTHETIC' or 'REAL_LOCAL')")
):
    """Returns underwater glider mission transects with summary metrics."""
    return insitu_service.get_glider_transects(qc_filter=qc_filter, source_mode=source_mode)

@router.get("/gliders/{glider_id}", response_model=GliderTransectDetail, summary="Retrieve detailed glider mission with 3D waypoints")
def get_glider_by_id(glider_id: str):
    """Returns full 3D sawtooth waypoints, dive cycles, depth profiles, and metadata for a specific glider."""
    glider = insitu_service.get_glider_by_id(glider_id)
    if not glider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Glider mission '{glider_id}' not found"
        )
    return glider

@router.get("/buoys", response_model=List[BuoySummary], summary="Retrieve supported moored ocean buoy stations")
def get_buoy_stations(
    qc_filter: bool = Query(False, description="Filter out buoy stations failing quality checks"),
    source_mode: Optional[str] = Query(None, description="Filter by source provenance ('REAL_LOCAL', 'SYNTHETIC', or 'ALL')")
):
    """Returns supported INCOIS moored ocean buoy stations with latest observations and metadata."""
    return insitu_service.get_buoy_stations(qc_filter=qc_filter, source_mode=source_mode)

@router.get("/buoys/{buoy_id}", response_model=BuoyDetail, summary="Retrieve single moored buoy station details and depth series")
def get_buoy_by_id(buoy_id: str):
    """Returns full vertical thermistor depth series, meteorological measurements, and metadata for a specific buoy."""
    buoy = insitu_service.get_buoy_by_id(buoy_id)
    if not buoy or buoy.get("platform_type") != "buoy":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Moored buoy '{buoy_id}' not found"
        )
    return buoy

@router.get("/status", response_model=InsituStatusResponse, summary="Retrieve in-situ ingestion telemetry & ERDDAP status")
def get_insitu_status():
    """Returns platform counts, synthetic vs real data breakdown, and live ERDDAP connectivity status."""
    return insitu_service.get_status()

@router.post("/sensors", summary="Register a New In-situ Ocean Sensor Platform")
def register_sensor(request: SensorRegistrationRequest):
    """
    Registers a new ocean observation platform (Argo Float, Glider, Moored Ocean Buoy, Surface Drifter)
    into the SAMUDRA-3D persistent SQLite database.
    Immediately available on 3D globe and comparison tools.
    """
    try:
        new_sensor = insitu_service.register_sensor(request)
        return {
            "status": "success",
            "message": f"Sensor '{new_sensor['name']}' ({new_sensor['platform_type']}) registered successfully.",
            "sensor": new_sensor
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

@router.get("/sensors", summary="Retrieve all custom registered sensors")
def get_custom_sensors():
    """
    Returns list of all newly registered or custom deployed ocean sensor platforms.
    """
    return insitu_service.get_custom_sensors()

@router.delete("/sensors/{sensor_id}", summary="Delete or decommission custom sensor")
def delete_custom_sensor(sensor_id: str):
    """
    Decommissions/removes a registered sensor from the database and 3D visualization.
    """
    success = insitu_service.delete_sensor(sensor_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sensor '{sensor_id}' not found."
        )
    return {
        "status": "success",
        "message": f"Sensor '{sensor_id}' decommissioned successfully."
    }

