"""
SAMUDRA-3D 3D Difference Field and Anomaly API Router
"""
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, status
from backend.app.services.anomaly_engine import anomaly_engine
from backend.app.schemas.anomaly import (
    AnomalyFieldResponse,
    AnomalySummaryResponse
)

router = APIRouter(prefix="/api/anomaly", tags=["3D Difference Field and Anomaly Heatmap"])

@router.get("/field", response_model=AnomalyFieldResponse, summary="Retrieve sparse 3D residual/anomaly field")
def get_anomaly_field(
    variable: str = Query("temperature", description="Variable: 'temperature' or 'salinity'"),
    threshold: Optional[float] = Query(None, description="Alert threshold (|delta| >= threshold)"),
    depth_min: float = Query(0.0, ge=0.0, description="Minimum depth in metres"),
    depth_max: float = Query(4000.0, le=4000.0, description="Maximum depth in metres"),
    source_mode: Optional[str] = Query(None, description="Observation source mode: 'REAL_LOCAL', 'SYNTHETIC', or 'ALL'")
):
    """
    Retrieves the sparse 3D residual field aggregated from available in-situ platforms (Argo and Gliders).
    Only valid, QC-passed observations are included. No spatial extrapolation beyond source support radius.
    """
    if variable not in ("temperature", "salinity"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported variable '{variable}'. Must be 'temperature' or 'salinity'."
        )
    if depth_min > depth_max:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"depth_min ({depth_min}m) cannot be greater than depth_max ({depth_max}m)."
        )
    if source_mode is not None and source_mode not in ("REAL_LOCAL", "SYNTHETIC", "ALL"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid source_mode '{source_mode}'. Must be 'REAL_LOCAL', 'SYNTHETIC', or 'ALL'."
        )

    mode = source_mode or "ALL"
    return anomaly_engine.compute_field(
        variable=variable,
        threshold=threshold,
        depth_min=depth_min,
        depth_max=depth_max,
        source_mode=mode
    )

@router.get("/summary", response_model=AnomalySummaryResponse, summary="Retrieve cross-variable anomaly summary")
def get_anomaly_summary(
    source_mode: Optional[str] = Query(None, description="Observation source mode: 'REAL_LOCAL', 'SYNTHETIC', or 'ALL'")
):
    """
    Returns aggregate validation metrics, observation coverage, platform counts, and threshold alerts for both variables.
    """
    if source_mode is not None and source_mode not in ("REAL_LOCAL", "SYNTHETIC", "ALL"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid source_mode '{source_mode}'. Must be 'REAL_LOCAL', 'SYNTHETIC', or 'ALL'."
        )
    mode = source_mode or "ALL"
    return anomaly_engine.compute_summary(source_mode=mode)
