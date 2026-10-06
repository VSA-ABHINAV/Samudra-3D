"""
SAMUDRA-3D In-situ Observation Schemas
"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

class QCFlagSummary(BaseModel):
    good: int = Field(0, description="Count of good quality measurements (WMO flag 1)")
    probably_good: int = Field(0, description="Count of probably good measurements (WMO flag 2)")
    bad: int = Field(0, description="Count of bad/outlier measurements (WMO flags 3, 4)")
    missing: int = Field(0, description="Count of missing measurements (WMO flag 9)")
    total: int = Field(0, description="Total profile levels")
    pass_rate_pct: float = Field(100.0, description="Percentage of levels passing QC (flags 1 or 2)")

class ArgoProfileMetadata(BaseModel):
    wmo_id: Optional[str] = None
    data_centre: str = "INCOIS-DAC"
    cycle_number: Optional[int] = None
    direction: Optional[str] = "ascending"
    synthetic: bool = True
    source_mode: str = "SYNTHETIC"  # SYNTHETIC, REAL_LOCAL, REAL_ERDDAP
    attribution: str = "Ministry of Earth Sciences (MoES) / INCOIS Indian Ocean Argo Program"
    retrieval_time: Optional[str] = None
    pressure_unit: str = "dbar"
    pressure_to_depth_conversion: str = "depth_m = pressure_dbar * 0.992 (UNESCO standard approximation)"

class ArgoProfileSummary(BaseModel):
    id: str
    platform_type: str = "argo"
    name: str
    wmo_id: Optional[str] = None
    lat: float
    lon: float
    timestamp: str
    max_depth: float
    num_levels: int
    surface_temp: Optional[float] = None
    surface_salinity: Optional[float] = None
    qc_summary: QCFlagSummary
    source_mode: str = "SYNTHETIC"

class ArgoProfileDetail(BaseModel):
    id: str
    platform_type: str = "argo"
    name: str
    wmo_id: Optional[str] = None
    lat: float
    lon: float
    timestamp: str
    max_depth: float
    num_levels: int
    surface_temp: Optional[float] = None
    surface_salinity: Optional[float] = None
    depths: List[float]
    temperature: List[float]
    salinity: List[float]
    qc_flags: List[int]
    qc_summary: QCFlagSummary
    metadata: Dict[str, Any]
    source_mode: str = "SYNTHETIC"

class GliderWaypoint(BaseModel):
    waypoint_index: int
    timestamp: str
    lat: float
    lon: float
    depth: Optional[float] = None
    pressure_dbar: Optional[float] = None
    temperature: Optional[float] = None
    salinity: Optional[float] = None
    qc_flag: int = 1
    phase: str = "dive"  # surface, dive, bottom, climb
    dive_number: int = 1

class GliderTransectSummary(BaseModel):
    id: str
    platform_type: str = "glider"
    name: str
    wmo_id: Optional[str] = None
    model: Optional[str] = None
    mission: Optional[str] = None
    lat: float
    lon: float
    timestamp: str
    total_dives: int
    max_depth: float
    total_waypoints: int
    surface_temp: Optional[float] = None
    surface_salinity: Optional[float] = None
    qc_summary: QCFlagSummary
    source_mode: str = "SYNTHETIC"

class GliderTransectDetail(BaseModel):
    id: str
    platform_type: str = "glider"
    name: str
    wmo_id: Optional[str] = None
    model: Optional[str] = None
    mission: Optional[str] = None
    lat: float
    lon: float
    timestamp: str
    total_dives: int
    max_depth: float
    total_waypoints: int
    surface_temp: Optional[float] = None
    surface_salinity: Optional[float] = None
    depths: List[float]
    temperature: List[float]
    salinity: List[float]
    qc_flags: List[int]
    qc_summary: QCFlagSummary
    waypoints: List[GliderWaypoint]
    metadata: Dict[str, Any]
    source_mode: str = "SYNTHETIC"

class BuoySummary(BaseModel):
    id: str
    platform_type: str = "buoy"
    name: str
    wmo_id: Optional[str] = None
    lat: float
    lon: float
    timestamp: str
    max_depth: float
    num_levels: int
    surface_temp: Optional[float] = None
    surface_salinity: Optional[float] = None
    air_temperature: Optional[float] = None
    surface_pressure_hpa: Optional[float] = None
    wind_speed_ms: Optional[float] = None
    wind_direction_deg: Optional[float] = None
    significant_wave_height_m: Optional[float] = None
    qc_summary: QCFlagSummary
    source_mode: str = "REAL_LOCAL"
    provenance_badge: str = "[REAL • INCOIS]"
    provider: str = "INCOIS"

class BuoyDetail(BaseModel):
    id: str
    platform_type: str = "buoy"
    name: str
    wmo_id: Optional[str] = None
    lat: float
    lon: float
    timestamp: str
    max_depth: float
    num_levels: int
    surface_temp: Optional[float] = None
    surface_salinity: Optional[float] = None
    air_temperature: Optional[float] = None
    surface_pressure_hpa: Optional[float] = None
    wind_speed_ms: Optional[float] = None
    wind_direction_deg: Optional[float] = None
    significant_wave_height_m: Optional[float] = None
    depths: List[float]
    temperature: List[float]
    salinity: List[float]
    qc_flags: List[int]
    qc_summary: QCFlagSummary
    metadata: Dict[str, Any]
    source_mode: str = "REAL_LOCAL"
    provenance_badge: str = "[REAL • INCOIS]"
    provider: str = "INCOIS"

class InsituStatusResponse(BaseModel):
    status: str = "operational"
    total_profiles: int
    argo_count: int
    glider_count: int
    buoy_count: int = 0
    synthetic_count: int
    real_sample_count: int
    erddap_live_feed: str
    data_centre: str = "INCOIS-DAC"
    timestamp: str

class SensorRegistrationRequest(BaseModel):
    platform_type: str = Field("moored_buoy", description="Platform type: argo, glider, moored_buoy, or drifter")
    name: str = Field(..., description="Human-readable sensor label, e.g. INCOIS OMNI Buoy BD09")
    wmo_id: Optional[str] = Field(None, description="WMO numeric code or platform code")
    lat: float = Field(..., description="Latitude within Indian Ocean (-30 to 30)")
    lon: float = Field(..., description="Longitude within Indian Ocean (30 to 120)")
    agency: Optional[str] = Field("MoES / INCOIS", description="Deploying or operating agency")
    surface_temp: Optional[float] = Field(28.4, description="Surface water temperature in °C")
    surface_salinity: Optional[float] = Field(34.8, description="Surface practical salinity in PSU")
    max_depth: Optional[float] = Field(2000.0, description="Maximum measurement depth in meters")
    depths: Optional[List[float]] = Field(None, description="Custom depth profile levels")
    temperature: Optional[List[float]] = Field(None, description="Custom temperature profile readings")
    salinity: Optional[List[float]] = Field(None, description="Custom salinity profile readings")
    created_by: Optional[str] = Field("Officer", description="User or officer who registered the sensor")

class CustomSensorSummary(BaseModel):
    id: str
    platform_type: str
    name: str
    wmo_id: Optional[str] = None
    lat: float
    lon: float
    surface_temp: Optional[float] = None
    surface_salinity: Optional[float] = None
    max_depth: float
    agency: Optional[str] = None
    created_at: str
    created_by: Optional[str] = None
    is_active: bool = True

