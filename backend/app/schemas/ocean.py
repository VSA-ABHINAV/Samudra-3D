from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

class HealthResponse(BaseModel):
    status: str = Field(..., example="healthy")
    dataset_loaded: bool = Field(..., example=True)
    variables_available: List[str] = Field(..., example=["temperature", "salinity", "currents"])
    dataset_path: str
    timestamp: str

class VariableMetadata(BaseModel):
    name: str
    long_name: str
    units: str
    standard_name: Optional[str] = None
    valid_range: Optional[List[float]] = None

class OceanMetadataResponse(BaseModel):
    title: str
    conventions: str
    institution: str
    source: str
    synthetic: bool
    source_mode: Optional[str] = "SYNTHETIC"
    dataset_id: Optional[str] = None
    provider: Optional[str] = None
    license_or_attribution: Optional[str] = None
    provenance: Optional[Dict[str, Any]] = None
    dimensions: Dict[str, int]
    variables: Dict[str, VariableMetadata]
    time_steps_hours: List[float]
    time_timestamps: List[str]
    depth_levels_m: List[float]
    lat_bounds: List[float] = Field(..., example=[0.0, 25.0])
    lon_bounds: List[float] = Field(..., example=[65.0, 95.0])
    spatial_resolution: str

class OceanDataSliceResponse(BaseModel):
    variable: str
    units: str
    time_idx: int
    timestamp: str
    requested_depth: float
    selected_depth: float
    source_mode: Optional[str] = "SYNTHETIC"
    dataset_id: Optional[str] = None
    resolution: Optional[str] = None
    cached: Optional[bool] = False
    shape: List[int]
    lats: List[float]
    lons: List[float]
    values: List[List[Optional[float]]]
    u_values: Optional[List[List[Optional[float]]]] = None
    v_values: Optional[List[List[Optional[float]]]] = None
    min_val: Optional[float] = None
    max_val: Optional[float] = None
    missing_count: int
    valid_count: int

class NearestObservationSummary(BaseModel):
    id: str
    name: str
    platform_type: str
    lat: float
    lon: float
    distance_km: float
    timestamp: str
    depths: List[float]
    temperature: List[Optional[float]]
    salinity: List[Optional[float]]
    qc_summary: Optional[Dict[str, Any]] = None

class OceanProbeResponse(BaseModel):
    lat: float
    lon: float
    time_idx: int
    timestamp: str
    is_land: bool = False
    depths: List[float]
    temperature: List[Optional[float]]
    salinity: List[Optional[float]]
    u_current: List[Optional[float]]
    v_current: List[Optional[float]]
    current_speed: List[Optional[float]]
    sst: Optional[float] = None
    sss: Optional[float] = None
    surface_current_speed: Optional[float] = None
    mld: Optional[float] = Field(None, description="Mixed Layer Depth in meters where T <= T(0) - 0.5 degC")
    d20: Optional[float] = Field(None, description="Thermocline 20 degC Isotherm Depth in meters")
    d26: Optional[float] = Field(None, description="26 degC Isotherm Depth in meters")
    tchp: Optional[float] = Field(None, description="Tropical Cyclone Heat Potential in kJ/cm^2")
    tchp_category: Optional[str] = Field(None, description="TCHP Category: Low (<50), Moderate (50-80), High (80-110), Severe (>110)")
    nearest_observation: Optional[NearestObservationSummary] = None

class OceanTransectResponse(BaseModel):
    lat1: float
    lon1: float
    lat2: float
    lon2: float
    variable: str
    units: str
    time_idx: int
    timestamp: str
    num_points: int
    total_distance_km: float
    distances_km: List[float]
    lats: List[float]
    lons: List[float]
    depth_levels: List[float]
    matrix: List[List[Optional[float]]]
    min_val: Optional[float] = None
    max_val: Optional[float] = None
    mld_profile: Optional[List[Optional[float]]] = None
    d20_profile: Optional[List[Optional[float]]] = None
    tchp_profile: Optional[List[Optional[float]]] = None
    dataset_id: str = Field(..., description="Active dataset identifier")


# ──────────────────────────────────────────────────────────────────────────────
# Coordinate-on-Demand Architecture
# Lightweight availability, point, profile, and region query schemas.
# Every endpoint returns only the data actually requested — never the global field.
# ──────────────────────────────────────────────────────────────────────────────

class LocationAvailabilityResponse(BaseModel):
    """Lightweight metadata returned after a user selects a lat/lon on the globe.

    No scientific field values are included — only what variables, depths, and
    times exist, plus observation platform availability.  This informs the UI
    so the user can choose specific parameters before requesting data.
    """
    latitude: float
    longitude: float
    model: bool
    dataset_id: Optional[str] = None
    observations: Dict[str, bool] = Field(default_factory=lambda: {
        "argo": False, "glider": False, "ctd": False, "bgc": False
    })
    variables: List[str] = Field(default_factory=list)
    depths: List[float] = Field(default_factory=list)
    times: List[str] = Field(default_factory=list)


class PointValueResponse(BaseModel):
    """Single model value at (lat, lon, depth, time)."""
    lat: float
    lon: float
    depth: float
    time: str
    variable: str
    value: Optional[float] = None
    unit: str
    nearest_depth: Optional[float] = None
    interpolation_method: str = "trilinear"
    source: Optional[str] = None
    dataset_id: Optional[str] = None


class ProfileResponse(BaseModel):
    """Vertical profile returned only for the selected coordinate.

    Much smaller than sending the global 2D horizontal field.
    """
    lat: float
    lon: float
    variable: str
    unit: str
    time_idx: int
    timestamp: str
    depths: List[float]
    values: List[Optional[float]]
    dataset_id: Optional[str] = None
    source: Optional[str] = None
    provenance: Optional[Dict[str, Any]] = None


class RegionResponse(BaseModel):
    """Bounded 3D region subset — the *detailed* local visualization volume.

    Only returned when the user explicitly requests a local 3D view.
    """
    center_lat: float
    center_lon: float
    radius_km: float
    variable: str
    unit: str
    time_idx: int
    timestamp: str
    depth_min: float
    depth_max: float
    lats: List[float]
    lons: List[float]
    depths: List[float]
    # For each depth level, a 2D horizontal slice (list of lists)
    slices: List[List[List[Optional[float]]]]
    shape: List[int]  # [n_depths, n_lats, n_lons]
    min_val: Optional[float] = None
    max_val: Optional[float] = None
    missing_count: int = 0
    valid_count: int = 0
    resolution: Optional[str] = None
    source_mode: Optional[str] = None
    dataset_id: Optional[str] = None
    cached: Optional[bool] = False


class VolumeDatasetMeta(BaseModel):
    id: str
    name: str
    provider: str
    source_mode: str


class VolumeVariableMeta(BaseModel):
    name: str
    raw_name: str
    units: str


class VolumeBoundsMeta(BaseModel):
    min_lon: float
    max_lon: float
    min_lat: float
    max_lat: float
    min_depth: float
    max_depth: float


class VolumeCoordinates(BaseModel):
    longitude: List[float]
    latitude: List[float]
    depth: List[float]


class VolumeResolution(BaseModel):
    horizontal_km: float
    vertical_levels: int


class VolumeProvenance(BaseModel):
    provider: str
    dataset_id: str
    source_mode: str


class OceanVolumeResponse(BaseModel):
    dataset: VolumeDatasetMeta
    variable: VolumeVariableMeta
    bounds: VolumeBoundsMeta
    coordinates: VolumeCoordinates
    values: List[List[List[Optional[float]]]]
    shape: List[int]
    native_shape: List[int]
    render_shape: List[int]
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    resolution: VolumeResolution
    timestamp: str
    provenance: VolumeProvenance
    u_values: Optional[List[List[List[Optional[float]]]]] = None
    v_values: Optional[List[List[List[Optional[float]]]]] = None
    cached: Optional[bool] = False

