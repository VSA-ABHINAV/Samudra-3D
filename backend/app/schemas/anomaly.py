"""
SAMUDRA-3D 3D Difference Field & Anomaly Heatmap Schemas
"""
from typing import Optional, List
from pydantic import BaseModel, Field


class AnomalyPoint(BaseModel):
    """A single validated residual point from an in-situ vs model collocation."""
    platform_id: str = Field(..., description="Source in-situ platform identifier")
    platform_type: str = Field(..., description="Platform type: argo or glider")
    lat: float = Field(..., description="Observation latitude (deg N)")
    lon: float = Field(..., description="Observation longitude (deg E)")
    depth: float = Field(..., description="Observation depth (m, positive-down)")
    variable: str = Field(..., description="Variable: temperature or salinity")
    delta: float = Field(..., description="Residual: MODEL - OBSERVED (negative = under-prediction)")
    observed_value: float = Field(..., description="In-situ observed value")
    model_value: float = Field(..., description="Co-located model value")
    qc_flag: int = Field(1, description="WMO QC flag (1=good, 2=probably good)")
    is_alert: bool = Field(False, description="True when |delta| >= configured threshold")


class CoverageBin(BaseModel):
    """A 0.5-degree x 0.5-degree coverage cell showing observation density."""
    lat_center: float = Field(..., description="Latitude centre of the bin (deg N)")
    lon_center: float = Field(..., description="Longitude centre of the bin (deg E)")
    count: int = Field(0, description="Number of valid anomaly points in this bin")
    mean_delta: Optional[float] = Field(None, description="Mean residual within bin (MODEL - OBSERVED)")
    has_data: bool = Field(False, description="True when at least one valid pair falls in this bin")


class AnomalyFieldResponse(BaseModel):
    """Sparse residual field aggregated from all available collocated platforms."""
    variable: str = Field(..., description="Variable: temperature or salinity")
    unit: str = Field(..., description="Physical unit: degC or PSU")
    threshold: float = Field(..., description="Alert threshold applied")
    depth_min: float = Field(0.0, description="Minimum depth filter applied (m)")
    depth_max: float = Field(4000.0, description="Maximum depth filter applied (m)")
    dataset_id: str = Field(..., description="Active dataset identifier")
    source_mode: str = Field("ALL", description="Observation source mode: REAL_LOCAL, SYNTHETIC, or ALL")
    points: List[AnomalyPoint] = Field(default_factory=list)
    coverage_bins: List[CoverageBin] = Field(default_factory=list)
    alert_count: int = Field(0, description="Number of points where |delta| >= threshold")
    total_valid_pairs: int = Field(0, description="Total valid matched pairs across all platforms")
    platform_count: int = Field(0, description="Number of platforms contributing residuals")
    bias: Optional[float] = Field(None, description="Mean delta across all valid pairs")
    mae: Optional[float] = Field(None, description="Mean absolute error across all valid pairs")
    rmse: Optional[float] = Field(None, description="Root mean square error across all valid pairs")
    support_radius_km: float = Field(55.0, description="Documented support radius per observation point")
    binning_policy: str = Field(
        "0.5-degree lat/lon bins; each point counted once at its observation (lat, lon); "
        "no spatial interpolation or extrapolation beyond source collocation.",
        description="Documented coverage binning policy"
    )
    no_data_warning: str = Field(
        "Sparse observations: residuals shown only at directly measured locations. "
        "No interpolation beyond source collocation support radius. No-data regions exist.",
        description="Mandatory sparse-data disclaimer"
    )
    latency_ms: float = Field(0.0)


class AnomalySummaryResponse(BaseModel):
    """Cross-variable anomaly summary across all available in-situ platforms."""
    temperature: AnomalyFieldResponse
    salinity: AnomalyFieldResponse
    platform_count: int = Field(0)
    timestamp: str = Field("")
    engine: str = Field("SAMUDRA-3D Anomaly Engine")
    health_score_status: str = Field(
        "DEFERRED (D07): No percentage health score implemented. "
        "Use Bias/MAE/RMSE/threshold alerts for model skill assessment.",
        description="Explicit record that 88.4% health score is deferred per D07"
    )
