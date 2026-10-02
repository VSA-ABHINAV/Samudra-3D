"""
SAMUDRA-3D Data Adapters
Unified interface for Synthetic ROMS and Real Copernicus Marine GLORYS12V1 Datasets.
"""
from abc import ABC, abstractmethod
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple, Dict, Any, List
import math
import numpy as np
import netCDF4 as nc
from scipy.interpolate import RegularGridInterpolator
from scipy import ndimage
from scipy.integrate import trapezoid

from backend.app.core.config import settings
from backend.app.data.registry import SourceMode, dataset_registry
from backend.app.data.cache import slice_cache
from backend.app.schemas.ocean import (
    OceanMetadataResponse,
    VariableMetadata,
    OceanDataSliceResponse,
    OceanProbeResponse,
    OceanTransectResponse,
    NearestObservationSummary,
    LocationAvailabilityResponse,
    PointValueResponse,
    ProfileResponse,
    RegionResponse,
    OceanVolumeResponse,
    VolumeDatasetMeta,
    VolumeVariableMeta,
    VolumeBoundsMeta,
    VolumeCoordinates,
    VolumeResolution,
    VolumeProvenance
)

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes great-circle distance between two geographic coordinates in kilometres."""
    r_earth = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r_earth * c

def sanitize_value(val: Any) -> Optional[float]:
    """Ensures value is a JSON-compliant float, converting masked/NaN/Inf to None."""
    if val is None or np.ma.is_masked(val):
        return None
    try:
        fval = float(val)
        if np.isnan(fval) or np.isinf(fval) or abs(fval) > 1e10 or fval == -999.0:
            return None
        return round(fval, 4)
    except (ValueError, TypeError):
        return None


# Hard safety limit: maximum grid cells returned by a single /ocean-data request.
# The real GLORYS grid is 301 x 601 = 180,901 cells.  We reject larger requests
# with HTTP 400 to prevent browser overload.
MAX_GRID_CELLS = 100_000

# Maximum payload size in bytes for any single field response
MAX_PAYLOAD_BYTES = 20 * 1024 * 1024  # 20 MB

def calculate_derived_ocean_metrics(depths_in: Any, temps_in: Any) -> Dict[str, Any]:
    """
    Computes Mixed Layer Depth (MLD), D20, D26, and Tropical Cyclone Heat Potential (TCHP).
    Works on lists or numpy arrays, filtering out None and NaN values.
    """
    clean_z = []
    clean_t = []
    if depths_in is not None and temps_in is not None:
        for z, t in zip(depths_in, temps_in):
            if z is not None and t is not None:
                try:
                    fz, ft = float(z), float(t)
                    if not (math.isnan(fz) or math.isnan(ft)):
                        clean_z.append(fz)
                        clean_t.append(ft)
                except (ValueError, TypeError):
                    continue

    if len(clean_z) < 2:
        return {
            "sst": None,
            "mld": None,
            "d20": None,
            "d26": None,
            "tchp": None,
            "tchp_category": None
        }

    depths = np.array(clean_z, dtype=np.float64)
    temps = np.array(clean_t, dtype=np.float64)
    t0 = float(temps[0])

    # 1. Mixed Layer Depth (depth where T <= T(0) - 0.5 degC)
    mld = None
    target_mld_t = t0 - 0.5
    for k in range(1, len(depths)):
        if temps[k] <= target_mld_t:
            z0, z1 = float(depths[k-1]), float(depths[k])
            t_prev, t_curr = float(temps[k-1]), float(temps[k])
            if abs(t_curr - t_prev) > 1e-6:
                mld = z0 + (target_mld_t - t_prev) / (t_curr - t_prev) * (z1 - z0)
            else:
                mld = z0
            break
    if mld is not None:
        mld = round(float(mld), 2)

    # 2. Thermocline depth D20 (depth where T = 20.0 degC)
    d20 = None
    if t0 <= 20.0:
        d20 = 0.0
    else:
        for k in range(1, len(depths)):
            if temps[k] <= 20.0:
                z0, z1 = float(depths[k-1]), float(depths[k])
                t_prev, t_curr = float(temps[k-1]), float(temps[k])
                if abs(t_curr - t_prev) > 1e-6:
                    d20 = z0 + (20.0 - t_prev) / (t_curr - t_prev) * (z1 - z0)
                else:
                    d20 = z0
                break
    if d20 is not None:
        d20 = round(float(d20), 2)

    # 3. 26 degC isotherm depth D26
    d26 = None
    if t0 < 26.0:
        d26 = 0.0
    else:
        for k in range(1, len(depths)):
            if temps[k] <= 26.0:
                z0, z1 = float(depths[k-1]), float(depths[k])
                t_prev, t_curr = float(temps[k-1]), float(temps[k])
                if abs(t_curr - t_prev) > 1e-6:
                    d26 = z0 + (26.0 - t_prev) / (t_curr - t_prev) * (z1 - z0)
                else:
                    d26 = z0
                break
    if d26 is not None:
        d26 = round(float(d26), 2)

    # 4. TCHP (Tropical Cyclone Heat Potential in kJ / cm^2)
    tchp = None
    category = "Low"
    if t0 >= 26.0 and d26 is not None and d26 > 0.0:
        sub_z = []
        sub_t = []
        for z_val, t_val in zip(depths, temps):
            if z_val < d26:
                sub_z.append(float(z_val))
                sub_t.append(float(t_val))
            else:
                break
        sub_z.append(d26)
        sub_t.append(26.0)

        if len(sub_z) >= 2:
            delta_t = np.array(sub_t) - 26.0
            integral = float(trapezoid(delta_t, sub_z))
            rho_cp = 1025.0 * 3985.0
            val = (rho_cp * integral) / 1e7  # kJ / cm^2
            tchp = round(val, 2)
            if tchp < 50.0:
                category = "Low"
            elif tchp < 80.0:
                category = "Moderate"
            elif tchp < 110.0:
                category = "High"
            else:
                category = "Severe"
        else:
            tchp = 0.0
            category = "Low"
    else:
        tchp = 0.0
        category = "Low"

    return {
        "sst": round(t0, 2),
        "mld": mld,
        "d20": d20,
        "d26": d26,
        "tchp": tchp,
        "tchp_category": category
    }

def find_nearest_collocated_obs(lat: float, lon: float, max_dist_km: float = 200.0) -> Optional[NearestObservationSummary]:
    """Finds nearest Argo float or Glider within max_dist_km from insitu_service."""
    try:
        from backend.app.services.insitu_service import insitu_service
        all_profs = insitu_service.get_all_profiles(source_mode="ALL")
        all_gliders = insitu_service.get_glider_transects(source_mode="ALL")
        candidates = list(all_profs) + list(all_gliders)

        nearest_obs = None
        min_dist = float("inf")
        nearest_p = None

        for p in candidates:
            p_lat = p.get("lat")
            p_lon = p.get("lon")
            if p_lat is not None and p_lon is not None:
                d_km = haversine_km(lat, lon, float(p_lat), float(p_lon))
                if d_km < min_dist:
                    min_dist = d_km
                    nearest_p = p

        if nearest_p is not None and min_dist <= max_dist_km:
            return NearestObservationSummary(
                id=nearest_p["id"],
                name=nearest_p.get("name", nearest_p["id"]),
                platform_type=nearest_p.get("platform_type", "argo"),
                lat=float(nearest_p["lat"]),
                lon=float(nearest_p["lon"]),
                distance_km=round(min_dist, 1),
                timestamp=nearest_p.get("timestamp", ""),
                depths=nearest_p.get("depths", []),
                temperature=nearest_p.get("temperature", []),
                salinity=nearest_p.get("salinity", []),
                qc_summary=nearest_p.get("qc_summary")
            )
    except Exception:
        pass
    return None


class BaseOceanAdapter(ABC):
    """Abstract interface for oceanographic data sources in SAMUDRA-3D."""
    @abstractmethod
    def is_loaded(self) -> bool:
        pass

    @abstractmethod
    def load_dataset(self) -> None:
        pass

    @abstractmethod
    def close(self) -> None:
        pass

    @abstractmethod
    def get_metadata(self) -> OceanMetadataResponse:
        pass

    @abstractmethod
    def slice_data(
        self,
        variable: str,
        time_idx: int = 0,
        depth: float = 0.0,
        lat_min: Optional[float] = None,
        lat_max: Optional[float] = None,
        lon_min: Optional[float] = None,
        lon_max: Optional[float] = None
    ) -> OceanDataSliceResponse:
        pass

    @abstractmethod
    def probe_water_column(
        self,
        lat: float,
        lon: float,
        time_idx: int = 0
    ) -> OceanProbeResponse:
        pass

    @abstractmethod
    def extract_transect(
        self,
        lat1: float,
        lon1: float,
        lat2: float,
        lon2: float,
        variable: str = "temperature",
        time_idx: int = 0
    ) -> OceanTransectResponse:
        pass

    @abstractmethod
    def get_availability(self, lat: float, lon: float) -> Any:
        """Returns lightweight metadata: which variables/depths/times/observations are available at (lat, lon)."""
        pass

    @abstractmethod
    def get_point(self, lat: float, lon: float, variable: str, depth: float, time_idx: int = 0) -> Any:
        """Returns a single interpolated value at (lat, lon, depth, time)."""
        pass

    @abstractmethod
    def get_profile(self, lat: float, lon: float, variable: str, time_idx: int = 0) -> Any:
        """Returns a vertical profile (depth[], value[]) at (lat, lon) for one variable."""
        pass

    @abstractmethod
    def get_region(
        self,
        center_lat: float,
        center_lon: float,
        radius_km: float,
        variable: str,
        depth_min: float,
        depth_max: float,
        time_idx: int = 0
    ) -> Any:
        """Returns a bounded 3D region subset for local visualization."""
        pass

    @abstractmethod
    def get_volume_data(
        self,
        variable: str = "temperature",
        time_idx: int = 0,
        center_lat: Optional[float] = None,
        center_lon: Optional[float] = None,
        radius_km: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        depth_min: Optional[float] = None,
        depth_max: Optional[float] = None,
        max_lat_samples: int = 48,
        max_lon_samples: int = 48,
        max_depth_samples: int = 24,
    ) -> OceanVolumeResponse:
        """Returns a 3D sampled spatial volume block for volumetric rendering."""
        pass


class SyntheticRomsAdapter(BaseOceanAdapter):
    """
    CF-1.8 synthetic ROMS dataset adapter.
    Preserves 100% backwards compatibility with all existing unit and regression tests.
    """
    def __init__(self, nc_path: Path = settings.SYNTHETIC_NETCDF_PATH, argo_path: Path = settings.ARGO_PATH):
        self.nc_path = nc_path
        self.argo_path = argo_path
        self.dataset_id = "incois_roms_synthetic"
        self.dataset: Optional[nc.Dataset] = None
        self.times: np.ndarray = np.array([])
        self.time_timestamps: List[str] = []
        self.depths: np.ndarray = np.array([])
        self.lats: np.ndarray = np.array([])
        self.lons: np.ndarray = np.array([])
        self._interpolator_cache: Dict[Tuple[str, int], RegularGridInterpolator] = {}

    def load_dataset(self):
        if not self.nc_path.exists():
            raise FileNotFoundError(f"Synthetic NetCDF dataset not found at {self.nc_path}")

        self.dataset = nc.Dataset(str(self.nc_path), "r")
        self.times = np.array(self.dataset.variables["time"][:], dtype=np.float64)
        self.depths = np.array(self.dataset.variables["depth"][:], dtype=np.float32)
        self.lats = np.array(self.dataset.variables["lat"][:], dtype=np.float32)
        self.lons = np.array(self.dataset.variables["lon"][:], dtype=np.float32)

        base_dt = datetime(2026, 9, 10, 0, 0, 0)
        self.time_timestamps = [
            (base_dt + timedelta(hours=float(h))).strftime("%Y-%m-%dT%H:%M:%SZ")
            for h in self.times
        ]

    def close(self):
        if self.dataset is not None:
            self.dataset.close()
            self.dataset = None

    def is_loaded(self) -> bool:
        return self.dataset is not None

    def get_metadata(self) -> OceanMetadataResponse:
        if not self.is_loaded():
            self.load_dataset()

        assert self.dataset is not None
        variables_meta = {
            "temperature": VariableMetadata(
                name="temperature",
                long_name=getattr(self.dataset.variables["temperature"], "long_name", "Potential Temperature"),
                units="degC",
                standard_name=getattr(self.dataset.variables["temperature"], "standard_name", "sea_water_potential_temperature"),
                valid_range=[-2.0, 35.0]
            ),
            "salinity": VariableMetadata(
                name="salinity",
                long_name=getattr(self.dataset.variables["salinity"], "long_name", "Practical Salinity"),
                units="PSU",
                standard_name=getattr(self.dataset.variables["salinity"], "standard_name", "sea_water_practical_salinity"),
                valid_range=[20.0, 42.0]
            ),
            "currents": VariableMetadata(
                name="currents",
                long_name="Ocean Current Speed and Velocity Vector",
                units="m/s",
                standard_name="sea_water_speed",
                valid_range=[0.0, 3.0]
            ),
            "u_current": VariableMetadata(
                name="u_current",
                long_name="Eastward Ocean Current Velocity",
                units="m/s",
                standard_name="eastward_sea_water_velocity",
                valid_range=[-2.0, 2.0]
            ),
            "v_current": VariableMetadata(
                name="v_current",
                long_name="Northward Ocean Current Velocity",
                units="m/s",
                standard_name="northward_sea_water_velocity",
                valid_range=[-2.0, 2.0]
            )
        }

        return OceanMetadataResponse(
            title=getattr(self.dataset, "title", "Indian Ocean Numerical Simulation"),
            conventions=getattr(self.dataset, "Conventions", "CF-1.8"),
            institution=getattr(self.dataset, "institution", "MoES / INCOIS"),
            source=getattr(self.dataset, "source", "ROMS 3.9"),
            synthetic=True,
            source_mode=SourceMode.SYNTHETIC,
            dataset_id="incois_roms_synthetic",
            provider="Ministry of Earth Sciences / INCOIS",
            license_or_attribution="MoES / INCOIS Internal Research Model",
            provenance={
                "type": "SYNTHETIC_NUMERICAL_SIMULATION",
                "resolution": "0.5 degree rectilinear (~55 km)",
                "note": "Development and regression baseline"
            },
            dimensions={
                "time": len(self.times),
                "depth": len(self.depths),
                "lat": len(self.lats),
                "lon": len(self.lons)
            },
            variables=variables_meta,
            time_steps_hours=self.times.tolist(),
            time_timestamps=self.time_timestamps,
            depth_levels_m=self.depths.tolist(),
            lat_bounds=[float(self.lats[0]), float(self.lats[-1])],
            lon_bounds=[float(self.lons[0]), float(self.lons[-1])],
            spatial_resolution=getattr(self.dataset, "spatial_resolution", "0.5 degree rectilinear")
        )

    def slice_data(
        self,
        variable: str,
        time_idx: int = 0,
        depth: float = 0.0,
        lat_min: Optional[float] = None,
        lat_max: Optional[float] = None,
        lon_min: Optional[float] = None,
        lon_max: Optional[float] = None
    ) -> OceanDataSliceResponse:
        if not self.is_loaded():
            self.load_dataset()

        assert self.dataset is not None
        valid_vars = ["temperature", "salinity", "currents", "u_current", "v_current"]
        if variable not in valid_vars:
            raise ValueError(f"Unsupported variable '{variable}'. Supported: {valid_vars}")

        if time_idx < 0 or time_idx >= len(self.times):
            raise ValueError(f"time_idx {time_idx} out of range [0..{len(self.times)-1}]")

        depth_idx = int(np.argmin(np.abs(self.depths - depth)))
        selected_depth = float(self.depths[depth_idx])

        j_min = 0
        j_max = len(self.lats) - 1
        i_min = 0
        i_max = len(self.lons) - 1

        if lat_min is not None:
            if lat_min > float(self.lats[-1]):
                raise ValueError(f"lat_min {lat_min} is north of domain boundary {self.lats[-1]}")
            j_min = max(0, min(len(self.lats)-1, int(np.searchsorted(self.lats, lat_min, side='left'))))

        if lat_max is not None:
            if lat_max < float(self.lats[0]):
                raise ValueError(f"lat_max {lat_max} is south of domain boundary {self.lats[0]}")
            j_max = max(0, min(len(self.lats)-1, int(np.searchsorted(self.lats, lat_max, side='right')) - 1))

        if j_min > j_max:
            raise ValueError(f"Invalid latitude range: min ({lat_min}) > max ({lat_max})")

        if lon_min is not None:
            if lon_min > float(self.lons[-1]):
                raise ValueError(f"lon_min {lon_min} is east of domain boundary {self.lons[-1]}")
            i_min = max(0, min(len(self.lons)-1, int(np.searchsorted(self.lons, lon_min, side='left'))))

        if lon_max is not None:
            if lon_max < float(self.lons[0]):
                raise ValueError(f"lon_max {lon_max} is west of domain boundary {self.lons[0]}")
            i_max = max(0, min(len(self.lons)-1, int(np.searchsorted(self.lons, lon_max, side='right')) - 1))

        if i_min > i_max:
            raise ValueError(f"Invalid longitude range: min ({lon_min}) > max ({lon_max})")

        sliced_lats = [float(lat) for lat in self.lats[j_min:j_max + 1]]
        sliced_lons = [float(lon) for lon in self.lons[i_min:i_max + 1]]

        u_arr_2d = None
        v_arr_2d = None

        if variable == "currents":
            u_raw = self.dataset.variables["u_current"][time_idx, depth_idx, j_min:j_max+1, i_min:i_max+1]
            v_raw = self.dataset.variables["v_current"][time_idx, depth_idx, j_min:j_max+1, i_min:i_max+1]
            raw_2d = np.sqrt(u_raw**2 + v_raw**2)
            u_arr_2d = u_raw
            v_arr_2d = v_raw
            units = "m/s"
        elif variable in ["u_current", "v_current"]:
            raw_2d = self.dataset.variables[variable][time_idx, depth_idx, j_min:j_max+1, i_min:i_max+1]
            units = "m/s"
        else:
            raw_2d = self.dataset.variables[variable][time_idx, depth_idx, j_min:j_max+1, i_min:i_max+1]
            units = getattr(self.dataset.variables[variable], "units", "degC" if variable == "temperature" else "PSU")

        values_nested = []
        u_nested = [] if u_arr_2d is not None else None
        v_nested = [] if v_arr_2d is not None else None
        valid_vals = []
        missing_count = 0
        valid_count = 0

        for r_idx in range(raw_2d.shape[0]):
            row_vals = []
            u_row = [] if u_arr_2d is not None else None
            v_row = [] if v_arr_2d is not None else None

            for c_idx in range(raw_2d.shape[1]):
                val = raw_2d[r_idx, c_idx]
                sanitized = sanitize_value(val)
                row_vals.append(sanitized)
                if sanitized is None:
                    missing_count += 1
                else:
                    valid_count += 1
                    valid_vals.append(sanitized)

                if u_arr_2d is not None:
                    u_row.append(sanitize_value(u_arr_2d[r_idx, c_idx]))
                    v_row.append(sanitize_value(v_arr_2d[r_idx, c_idx]))

            values_nested.append(row_vals)
            if u_nested is not None:
                u_nested.append(u_row)
                v_nested.append(v_row)

        min_val = min(valid_vals) if valid_vals else None
        max_val = max(valid_vals) if valid_vals else None

        return OceanDataSliceResponse(
            variable=variable,
            units=units,
            time_idx=time_idx,
            timestamp=self.time_timestamps[time_idx],
            requested_depth=float(depth),
            selected_depth=selected_depth,
            source_mode=SourceMode.SYNTHETIC,
            dataset_id="incois_roms_synthetic",
            resolution="0.5 deg (~55 km)",
            cached=False,
            shape=[len(sliced_lats), len(sliced_lons)],
            lats=sliced_lats,
            lons=sliced_lons,
            values=values_nested,
            u_values=u_nested,
            v_values=v_nested,
            min_val=min_val,
            max_val=max_val,
            missing_count=missing_count,
            valid_count=valid_count
        )

    def _get_interpolator(self, variable: str, time_idx: int) -> RegularGridInterpolator:
        key = (variable, time_idx)
        if key in self._interpolator_cache:
            return self._interpolator_cache[key]

        raw_data = self.dataset.variables[variable][time_idx, :, :, :]
        filled_3d = np.zeros_like(raw_data.data, dtype=np.float64)

        for k in range(len(self.depths)):
            layer = raw_data[k, :, :]
            mask = np.ma.getmaskarray(layer)
            if np.any(mask):
                ind = ndimage.distance_transform_edt(mask, return_distances=False, return_indices=True)
                filled_3d[k] = layer.data[tuple(ind)]
            else:
                filled_3d[k] = layer.data

        rgi = RegularGridInterpolator(
            (self.depths, self.lats, self.lons),
            filled_3d,
            bounds_error=False,
            fill_value=None
        )
        self._interpolator_cache[key] = rgi
        return rgi

    def probe_water_column(self, lat: float, lon: float, time_idx: int = 0) -> OceanProbeResponse:
        if not self.is_loaded():
            self.load_dataset()

        assert self.dataset is not None
        if time_idx < 0 or time_idx >= len(self.times):
            raise ValueError(f"time_idx {time_idx} out of range [0..{len(self.times)-1}]")

        if lat < self.lats[0] or lat > self.lats[-1] or lon < self.lons[0] or lon > self.lons[-1]:
            raise ValueError(f"Target coordinates ({lat}, {lon}) outside domain bounds [lat: {self.lats[0]}..{self.lats[-1]}, lon: {self.lons[0]}..{self.lons[-1]}].")

        j_near = int(np.argmin(np.abs(self.lats - lat)))
        i_near = int(np.argmin(np.abs(self.lons - lon)))
        surface_mask = np.ma.getmaskarray(self.dataset.variables["temperature"][time_idx, 0, :, :])
        is_land = bool(surface_mask[j_near, i_near])

        pts = np.column_stack([self.depths, np.full(len(self.depths), lat), np.full(len(self.depths), lon)])

        t_rgi = self._get_interpolator("temperature", time_idx)
        s_rgi = self._get_interpolator("salinity", time_idx)
        u_rgi = self._get_interpolator("u_current", time_idx)
        v_rgi = self._get_interpolator("v_current", time_idx)

        t_interp = t_rgi(pts)
        s_interp = s_rgi(pts)
        u_interp = u_rgi(pts)
        v_interp = v_rgi(pts)
        sp_interp = np.sqrt(u_interp**2 + v_interp**2)

        t_vals = [round(float(v), 3) for v in t_interp]
        s_vals = [round(float(v), 3) for v in s_interp]
        u_vals = [round(float(v), 3) for v in u_interp]
        v_vals = [round(float(v), 3) for v in v_interp]
        sp_vals = [round(float(v), 3) for v in sp_interp]

        metrics = calculate_derived_ocean_metrics(self.depths, t_interp)
        nearest_obs = find_nearest_collocated_obs(lat, lon, max_dist_km=200.0)

        return OceanProbeResponse(
            lat=lat,
            lon=lon,
            time_idx=time_idx,
            timestamp=self.time_timestamps[time_idx],
            is_land=is_land,
            depths=self.depths.tolist(),
            temperature=t_vals,
            salinity=s_vals,
            u_current=u_vals,
            v_current=v_vals,
            current_speed=sp_vals,
            sst=t_vals[0] if t_vals else None,
            sss=s_vals[0] if s_vals else None,
            surface_current_speed=sp_vals[0] if sp_vals else None,
            mld=metrics["mld"],
            d20=metrics["d20"],
            d26=metrics["d26"],
            tchp=metrics["tchp"],
            tchp_category=metrics["tchp_category"],
            nearest_observation=nearest_obs
        )

    def extract_transect(
        self,
        lat1: float,
        lon1: float,
        lat2: float,
        lon2: float,
        variable: str = "temperature",
        time_idx: int = 0
    ) -> OceanTransectResponse:
        if not self.is_loaded():
            self.load_dataset()
        assert self.dataset is not None

        valid_vars = ["temperature", "salinity", "currents", "u_current", "v_current"]
        if variable not in valid_vars:
            raise ValueError(f"Unsupported variable '{variable}'. Supported: {valid_vars}")

        if time_idx < 0 or time_idx >= len(self.times):
            raise ValueError(f"time_idx {time_idx} out of range [0..{len(self.times)-1}]")

        lat_min, lat_max = float(self.lats[0]), float(self.lats[-1])
        lon_min, lon_max = float(self.lons[0]), float(self.lons[-1])

        for (l_lat, l_lon, label) in [(lat1, lon1, "Start"), (lat2, lon2, "End")]:
            if l_lat < lat_min or l_lat > lat_max or l_lon < lon_min or l_lon > lon_max:
                raise ValueError(f"{label} coordinates ({l_lat}, {l_lon}) outside domain [lat: {lat_min}..{lat_max}, lon: {lon_min}..{lon_max}].")

        num_points = 100
        total_dist_km = haversine_km(lat1, lon1, lat2, lon2)
        distances_km = [round(float(d), 2) for d in np.linspace(0.0, total_dist_km, num_points)]
        transect_lats = np.linspace(lat1, lat2, num_points)
        transect_lons = np.linspace(lon1, lon2, num_points)

        surface_mask = np.ma.getmaskarray(self.dataset.variables["temperature"][time_idx, 0, :, :])
        is_land_points = []
        for i in range(num_points):
            j = int(np.argmin(np.abs(self.lats - transect_lats[i])))
            ix = int(np.argmin(np.abs(self.lons - transect_lons[i])))
            is_land_points.append(bool(surface_mask[j, ix]))

        if variable == "currents":
            u_rgi = self._get_interpolator("u_current", time_idx)
            v_rgi = self._get_interpolator("v_current", time_idx)
            units = "m/s"
        else:
            rgi = self._get_interpolator(variable, time_idx)
            units = "degC" if variable == "temperature" else ("PSU" if variable == "salinity" else "m/s")

        matrix: List[List[Optional[float]]] = []
        all_vals: List[float] = []

        for k in range(len(self.depths)):
            d = self.depths[k]
            pts = np.column_stack([np.full(num_points, d), transect_lats, transect_lons])
            if variable == "currents":
                u_arr = u_rgi(pts)
                v_arr = v_rgi(pts)
                layer_vals = np.sqrt(u_arr**2 + v_arr**2)
            else:
                layer_vals = rgi(pts)

            row: List[Optional[float]] = []
            for i in range(num_points):
                if is_land_points[i]:
                    row.append(None)
                else:
                    v = round(float(layer_vals[i]), 3)
                    row.append(v)
                    all_vals.append(v)
            matrix.append(row)

        t_rgi = self._get_interpolator("temperature", time_idx)
        mld_profile: List[Optional[float]] = []
        d20_profile: List[Optional[float]] = []
        tchp_profile: List[Optional[float]] = []

        for i in range(num_points):
            if is_land_points[i]:
                mld_profile.append(None)
                d20_profile.append(None)
                tchp_profile.append(None)
            else:
                pts_col = np.column_stack([self.depths, np.full(len(self.depths), transect_lats[i]), np.full(len(self.depths), transect_lons[i])])
                t_col = t_rgi(pts_col)
                m = calculate_derived_ocean_metrics(self.depths, t_col)
                mld_profile.append(m["mld"])
                d20_profile.append(m["d20"])
                tchp_profile.append(m["tchp"])

        min_val = min(all_vals) if all_vals else None
        max_val = max(all_vals) if all_vals else None

        return OceanTransectResponse(
            lat1=lat1,
            lon1=lon1,
            lat2=lat2,
            lon2=lon2,
            variable=variable,
            units=units,
            time_idx=time_idx,
            timestamp=self.time_timestamps[time_idx],
            num_points=num_points,
            total_distance_km=round(total_dist_km, 2),
            distances_km=distances_km,
            lats=[round(float(y), 4) for y in transect_lats],
            lons=[round(float(x), 4) for x in transect_lons],
            depth_levels=self.depths.tolist(),
            matrix=matrix,
            min_val=min_val,
            max_val=max_val,
            mld_profile=mld_profile,
            d20_profile=d20_profile,
            tchp_profile=tchp_profile,
            dataset_id=self.dataset_id
        )

    def get_availability(self, lat: float, lon: float) -> LocationAvailabilityResponse:
        """Returns lightweight metadata about data availability at (lat, lon). No field values."""
        if not self.is_loaded():
            self.load_dataset()
        if lat < float(self.lats[0]) or lat > float(self.lats[-1]) or lon < float(self.lons[0]) or lon > float(self.lons[-1]):
            return LocationAvailabilityResponse(latitude=lat, longitude=lon, model=False)
        j_near = int(np.argmin(np.abs(self.lats - lat)))
        i_near = int(np.argmin(np.abs(self.lons - lon)))
        surface_mask = np.ma.getmaskarray(self.dataset.variables["temperature"][0, 0, :, :])
        is_land = bool(surface_mask[j_near, i_near])
        return LocationAvailabilityResponse(
            latitude=lat,
            longitude=lon,
            model=not is_land,
            dataset_id="incois_roms_synthetic",
            observations={"argo": True, "glider": True, "ctd": False, "bgc": False},
            variables=["temperature", "salinity", "currents", "u_current", "v_current"],
            depths=[float(d) for d in self.depths],
            times=self.time_timestamps
        )

    def get_point(self, lat: float, lon: float, variable: str, depth: float, time_idx: int = 0) -> PointValueResponse:
        """Returns a single interpolated model value at (lat, lon, depth, time)."""
        if not self.is_loaded():
            self.load_dataset()
        if time_idx < 0 or time_idx >= len(self.times):
            raise ValueError(f"time_idx {time_idx} out of range [0..{len(self.times)-1}]")
        if lat < float(self.lats[0]) or lat > float(self.lats[-1]) or lon < float(self.lons[0]) or lon > float(self.lons[-1]):
            raise ValueError(f"Coordinates ({lat}, {lon}) outside domain bounds.")
        copernicus_var = {"temperature": "temperature", "salinity": "salinity",
                          "u_current": "u_current", "v_current": "v_current"}.get(variable)
        if copernicus_var is None and variable == "currents":
            copernicus_var = "u_current"
        if copernicus_var is None:
            raise ValueError(f"Unsupported variable '{variable}'")
        rgi = self._get_interpolator(copernicus_var, time_idx)
        pts = np.array([[depth, lat, lon]])
        val = sanitize_value(rgi(pts)[0])
        depth_idx = int(np.argmin(np.abs(self.depths - depth)))
        selected_depth = float(self.depths[depth_idx])
        units_map = {"temperature": "degC", "salinity": "PSU", "u_current": "m/s", "v_current": "m/s"}
        return PointValueResponse(
            lat=lat, lon=lon, depth=depth, time=self.time_timestamps[time_idx],
            variable=variable, value=val, unit=units_map.get(variable, "degC"),
            nearest_depth=selected_depth, interpolation_method="trilinear",
            source="INCOIS ROMS Synthetic Model (CF-1.8)", dataset_id="incois_roms_synthetic"
        )

    def get_profile(self, lat: float, lon: float, variable: str, time_idx: int = 0) -> ProfileResponse:
        """Returns a vertical profile at (lat, lon) for one variable across all depth levels."""
        probe = self.probe_water_column(lat=lat, lon=lon, time_idx=time_idx)
        var_map = {"temperature": probe.temperature, "salinity": probe.salinity,
                   "u_current": probe.u_current, "v_current": probe.v_current}
        values = var_map.get(variable, probe.temperature)
        unit_map = {"temperature": "degC", "salinity": "PSU", "u_current": "m/s", "v_current": "m/s"}
        return ProfileResponse(
            lat=lat, lon=lon, variable=variable, unit=unit_map.get(variable, "degC"),
            time_idx=time_idx, timestamp=probe.timestamp,
            depths=[float(d) for d in probe.depths],
            values=values,
            dataset_id="incois_roms_synthetic",
            source="INCOIS ROMS Synthetic Model (CF-1.8)",
            provenance={"interpolation_method": "RegularGridInterpolator (linear)"}
        )

    def get_region(
        self,
        center_lat: float,
        center_lon: float,
        radius_km: float,
        variable: str,
        depth_min: float,
        depth_max: float,
        time_idx: int = 0
    ) -> RegionResponse:
        """Returns a bounded 3D region subset around (center_lat, center_lon)."""
        if not self.is_loaded():
            self.load_dataset()
        lat_span = radius_km / 111.0
        lon_span = radius_km / (111.0 * max(0.01, abs(math.cos(math.radians(center_lat)))))
        lat_min = max(float(self.lats[0]), center_lat - lat_span)
        lat_max = min(float(self.lats[-1]), center_lat + lat_span)
        lon_min = max(float(self.lons[0]), center_lon - lon_span)
        lon_max = min(float(self.lons[-1]), center_lon + lon_span)
        depth_min_idx = int(np.argmin(np.abs(self.depths - depth_min)))
        depth_max_idx = int(np.argmin(np.abs(self.depths - depth_max)))
        if depth_min_idx > depth_max_idx:
            depth_min_idx, depth_max_idx = depth_max_idx, depth_min_idx
        slices = []
        all_vals = []
        last_slice = None
        for k in range(depth_min_idx, depth_max_idx + 1):
            d = float(self.depths[k])
            sl = self.slice_data(variable=variable, time_idx=time_idx, depth=d,
                                 lat_min=lat_min, lat_max=lat_max, lon_min=lon_min, lon_max=lon_max)
            slices.append(sl.values)
            last_slice = sl
            for row in sl.values:
                for v in row:
                    if v is not None:
                        all_vals.append(v)
        sub_depths = [float(self.depths[k]) for k in range(depth_min_idx, depth_max_idx + 1)]
        unit = "degC" if variable == "temperature" else ("PSU" if variable == "salinity" else "m/s")
        return RegionResponse(
            center_lat=center_lat, center_lon=center_lon, radius_km=radius_km,
            variable=variable, unit=unit,
            time_idx=time_idx, timestamp=self.time_timestamps[time_idx],
            depth_min=float(self.depths[depth_min_idx]), depth_max=float(self.depths[depth_max_idx]),
            lats=last_slice.lats if last_slice else [],
            lons=last_slice.lons if last_slice else [],
            depths=sub_depths, slices=slices,
            shape=[len(sub_depths), len(last_slice.lats) if last_slice else 0, len(last_slice.lons) if last_slice else 0],
            min_val=min(all_vals) if all_vals else None,
            max_val=max(all_vals) if all_vals else None,
            valid_count=len(all_vals),
            resolution="regional subset",
            source_mode=SourceMode.SYNTHETIC,
            dataset_id="incois_roms_synthetic"
        )

    def get_volume_data(
        self,
        variable: str = "temperature",
        time_idx: int = 0,
        center_lat: Optional[float] = None,
        center_lon: Optional[float] = None,
        radius_km: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        depth_min: Optional[float] = None,
        depth_max: Optional[float] = None,
        max_lat_samples: int = 48,
        max_lon_samples: int = 48,
        max_depth_samples: int = 24,
    ) -> OceanVolumeResponse:
        if not self.is_loaded():
            self.load_dataset()

        assert self.dataset is not None

        # Convert center_lat, center_lon, radius_km to bounds if provided
        if center_lat is not None and center_lon is not None and radius_km is not None:
            lat_span = radius_km / 111.0
            lon_span = radius_km / (111.0 * max(0.01, abs(math.cos(math.radians(center_lat)))))
            min_lat = max(float(self.lats[0]), center_lat - lat_span)
            max_lat = min(float(self.lats[-1]), center_lat + lat_span)
            min_lon = max(float(self.lons[0]), center_lon - lon_span)
            max_lon = min(float(self.lons[-1]), center_lon + lon_span)

        cache_key = slice_cache.make_volume_key(
            dataset_id="incois_roms_synthetic",
            variable=variable,
            time_idx=time_idx,
            min_lon=min_lon,
            max_lon=max_lon,
            min_lat=min_lat,
            max_lat=max_lat,
            depth_min=depth_min,
            depth_max=depth_max,
            max_lat_samples=max_lat_samples,
            max_lon_samples=max_lon_samples,
            max_depth_samples=max_depth_samples,
        )
        cached_res = slice_cache.get(cache_key)
        if cached_res:
            res = OceanVolumeResponse(**cached_res)
            res.cached = True
            return res

        eff_min_lon = max(float(self.lons[0]), min_lon) if min_lon is not None else float(self.lons[0])
        eff_max_lon = min(float(self.lons[-1]), max_lon) if max_lon is not None else float(self.lons[-1])
        eff_min_lat = max(float(self.lats[0]), min_lat) if min_lat is not None else float(self.lats[0])
        eff_max_lat = min(float(self.lats[-1]), max_lat) if max_lat is not None else float(self.lats[-1])
        eff_min_depth = max(float(self.depths[0]), depth_min) if depth_min is not None else float(self.depths[0])
        eff_max_depth = min(float(self.depths[-1]), depth_max) if depth_max is not None else float(self.depths[-1])

        i_min = max(0, min(len(self.lons) - 1, int(np.searchsorted(self.lons, eff_min_lon, side='left'))))
        i_max = max(0, min(len(self.lons) - 1, int(np.searchsorted(self.lons, eff_max_lon, side='right')) - 1))
        if i_min > i_max:
            i_min, i_max = i_max, i_min

        j_min = max(0, min(len(self.lats) - 1, int(np.searchsorted(self.lats, eff_min_lat, side='left'))))
        j_max = max(0, min(len(self.lats) - 1, int(np.searchsorted(self.lats, eff_max_lat, side='right')) - 1))
        if j_min > j_max:
            j_min, j_max = j_max, j_min

        k_min = max(0, min(len(self.depths) - 1, int(np.searchsorted(self.depths, eff_min_depth, side='left'))))
        k_max = max(0, min(len(self.depths) - 1, int(np.searchsorted(self.depths, eff_max_depth, side='right')) - 1))
        if k_min > k_max:
            k_min, k_max = k_max, k_min

        n_lon = i_max - i_min + 1
        n_lat = j_max - j_min + 1
        n_depth = k_max - k_min + 1

        stride_x = max(1, math.ceil(n_lon / max_lon_samples))
        stride_y = max(1, math.ceil(n_lat / max_lat_samples))
        stride_z = max(1, math.ceil(n_depth / max_depth_samples))

        sub_lons = [round(float(x), 4) for x in self.lons[i_min:i_max + 1:stride_x]]
        sub_lats = [round(float(y), 4) for y in self.lats[j_min:j_max + 1:stride_y]]
        sub_depths = [round(float(z), 2) for z in self.depths[k_min:k_max + 1:stride_z]]

        time_idx = max(0, min(len(self.times) - 1, time_idx))
        timestamp = self.time_timestamps[time_idx] if self.time_timestamps else ""

        u_3d = None
        v_3d = None
        if variable == "currents":
            u_raw = self.dataset.variables["u_current"][time_idx, k_min:k_max + 1:stride_z, j_min:j_max + 1:stride_y, i_min:i_max + 1:stride_x]
            v_raw = self.dataset.variables["v_current"][time_idx, k_min:k_max + 1:stride_z, j_min:j_max + 1:stride_y, i_min:i_max + 1:stride_x]
            u_sq = np.where(np.ma.getmaskarray(u_raw) | np.isnan(u_raw), 0.0, np.asarray(u_raw)**2)
            v_sq = np.where(np.ma.getmaskarray(v_raw) | np.isnan(v_raw), 0.0, np.asarray(v_raw)**2)
            raw_3d = np.sqrt(np.maximum(0.0, u_sq + v_sq))
            u_3d = u_raw
            v_3d = v_raw
            units = "m/s"
            raw_name = "u_current,v_current"
        elif variable == "u_current":
            raw_3d = self.dataset.variables["u_current"][time_idx, k_min:k_max + 1:stride_z, j_min:j_max + 1:stride_y, i_min:i_max + 1:stride_x]
            u_3d = raw_3d
            units = "m/s"
            raw_name = "u_current"
        elif variable == "v_current":
            raw_3d = self.dataset.variables["v_current"][time_idx, k_min:k_max + 1:stride_z, j_min:j_max + 1:stride_y, i_min:i_max + 1:stride_x]
            v_3d = raw_3d
            units = "m/s"
            raw_name = "v_current"
        elif variable == "salinity":
            raw_3d = self.dataset.variables["salinity"][time_idx, k_min:k_max + 1:stride_z, j_min:j_max + 1:stride_y, i_min:i_max + 1:stride_x]
            units = "PSU"
            raw_name = "salinity"
        else:
            variable = "temperature"
            raw_3d = self.dataset.variables["temperature"][time_idx, k_min:k_max + 1:stride_z, j_min:j_max + 1:stride_y, i_min:i_max + 1:stride_x]
            units = "degC"
            raw_name = "temperature"

        raw_np = np.asarray(raw_3d)
        mask_np = np.ma.getmaskarray(raw_3d) if np.ma.is_masked(raw_3d) else np.zeros(raw_np.shape, dtype=bool)
        nan_mask = np.isnan(raw_np) | (raw_np < -1e9) | (raw_np > 1e9) | mask_np

        values_3d: List[List[List[Optional[float]]]] = []
        valid_vals: List[float] = []

        nz, ny, nx = raw_np.shape
        for k in range(nz):
            plane = []
            for j in range(ny):
                row = []
                for i in range(nx):
                    if nan_mask[k, j, i]:
                        row.append(None)
                    else:
                        val = round(float(raw_np[k, j, i]), 2 if variable != "currents" else 3)
                        row.append(val)
                        valid_vals.append(val)
                plane.append(row)
            values_3d.append(plane)

        u_values_3d = None
        v_values_3d = None
        if u_3d is not None:
            u_values_3d = []
            u_np = np.asarray(u_3d)
            u_mask = np.ma.getmaskarray(u_3d) if np.ma.is_masked(u_3d) else np.zeros(u_np.shape, dtype=bool)
            for k in range(nz):
                plane = []
                for j in range(ny):
                    row = []
                    for i in range(nx):
                        if u_mask[k, j, i] or np.isnan(u_np[k, j, i]):
                            row.append(None)
                        else:
                            row.append(round(float(u_np[k, j, i]), 3))
                    plane.append(row)
                u_values_3d.append(plane)
        if v_3d is not None:
            v_values_3d = []
            v_np = np.asarray(v_3d)
            v_mask = np.ma.getmaskarray(v_3d) if np.ma.is_masked(v_3d) else np.zeros(v_np.shape, dtype=bool)
            for k in range(nz):
                plane = []
                for j in range(ny):
                    row = []
                    for i in range(nx):
                        if v_mask[k, j, i] or np.isnan(v_np[k, j, i]):
                            row.append(None)
                        else:
                            row.append(round(float(v_np[k, j, i]), 3))
                    plane.append(row)
                v_values_3d.append(plane)

        response = OceanVolumeResponse(
            dataset=VolumeDatasetMeta(
                id="incois_roms_synthetic",
                name="ROMS 3.9 Indian Ocean Simulation",
                provider="Ministry of Earth Sciences / INCOIS",
                source_mode=SourceMode.SYNTHETIC.value,
            ),
            variable=VolumeVariableMeta(
                name=variable,
                raw_name=raw_name,
                units=units
            ),
            bounds=VolumeBoundsMeta(
                min_lon=sub_lons[0] if sub_lons else 0.0,
                max_lon=sub_lons[-1] if sub_lons else 0.0,
                min_lat=sub_lats[0] if sub_lats else 0.0,
                max_lat=sub_lats[-1] if sub_lats else 0.0,
                min_depth=sub_depths[0] if sub_depths else 0.0,
                max_depth=sub_depths[-1] if sub_depths else 0.0
            ),
            coordinates=VolumeCoordinates(
                longitude=sub_lons,
                latitude=sub_lats,
                depth=sub_depths
            ),
            values=values_3d,
            shape=[nz, ny, nx],
            native_shape=[len(self.depths), len(self.lats), len(self.lons)],
            render_shape=[nz, ny, nx],
            min_value=min(valid_vals) if valid_vals else None,
            max_value=max(valid_vals) if valid_vals else None,
            resolution=VolumeResolution(
                horizontal_km=round(55.0 * stride_x, 2),
                vertical_levels=nz
            ),
            timestamp=timestamp,
            provenance=VolumeProvenance(
                provider="Ministry of Earth Sciences / INCOIS",
                dataset_id="incois_roms_synthetic",
                source_mode=SourceMode.SYNTHETIC.value
            ),
            u_values=u_values_3d,
            v_values=v_values_3d,
            cached=False
        )
        slice_cache.set(cache_key, response.model_dump(), write_disk=False)
        return response


class GlorysLocalAdapter(BaseOceanAdapter):
    """
    Real Copernicus Marine GLORYS12V1 High-Resolution Physics Reanalysis Adapter.
    Processes cmems_mod_glo_phy_my_0.083deg_P1D-m subset lazily using NetCDF4/scipy.
    Variable Normalization:
      thetao -> temperature (degC)
      so     -> salinity (PSU)
      uo     -> u_current (m/s)
      vo     -> v_current (m/s)
      currents -> speed = sqrt(uo^2 + vo^2)
    """
    def __init__(self, nc_path: Optional[Path] = None):
        if nc_path is None:
            desc = dataset_registry.get_dataset("cmems_mod_glo_phy_my_0.083deg_P1D-m")
            self.nc_path = Path(desc.local_path) if desc and desc.local_path else Path(settings.RAW_DATA_DIR) / "cmems_mod_glo_phy_my_0.083deg_P1D-m_thetao-so-uo-vo_50.00E-100.00E_0.00N-25.00N_0.49-92.33m_2025-01-01-2025-01-07.nc"
        else:
            self.nc_path = nc_path
        self.dataset_id = "cmems_mod_glo_phy_my_0.083deg_P1D-m"

        self.dataset: Optional[nc.Dataset] = None
        self.times: np.ndarray = np.array([])
        self.time_timestamps: List[str] = []
        self.depths: np.ndarray = np.array([])
        self.lats: np.ndarray = np.array([])
        self.lons: np.ndarray = np.array([])
        self._interpolator_cache: Dict[Tuple[str, int], RegularGridInterpolator] = {}

    def load_dataset(self):
        if not self.nc_path.exists():
            raise FileNotFoundError(f"Real Copernicus GLORYS NetCDF not found at {self.nc_path}")

        self.dataset = nc.Dataset(str(self.nc_path), "r")
        self.times = np.array(self.dataset.variables["time"][:], dtype=np.float64)
        self.depths = np.array(self.dataset.variables["depth"][:], dtype=np.float32)
        self.lats = np.array(self.dataset.variables["latitude"][:], dtype=np.float32)
        self.lons = np.array(self.dataset.variables["longitude"][:], dtype=np.float32)

        base_epoch = datetime(1950, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
        self.time_timestamps = []
        for h in self.times:
            dt = base_epoch + timedelta(hours=float(h))
            self.time_timestamps.append(dt.strftime("%Y-%m-%dT%H:%M:%SZ"))

    def close(self):
        if self.dataset is not None:
            self.dataset.close()
            self.dataset = None

    def is_loaded(self) -> bool:
        return self.dataset is not None

    def get_metadata(self) -> OceanMetadataResponse:
        if not self.is_loaded():
            self.load_dataset()

        assert self.dataset is not None
        variables_meta = {
            "temperature": VariableMetadata(
                name="temperature",
                long_name="Sea Water Potential Temperature (Copernicus thetao)",
                units="degC",
                standard_name="sea_water_potential_temperature",
                valid_range=[-2.0, 36.0]
            ),
            "salinity": VariableMetadata(
                name="salinity",
                long_name="Sea Water Practical Salinity (Copernicus so)",
                units="PSU",
                standard_name="sea_water_salinity",
                valid_range=[20.0, 42.0]
            ),
            "currents": VariableMetadata(
                name="currents",
                long_name="Ocean Current Velocity Vector & Speed (Copernicus uo + vo)",
                units="m/s",
                standard_name="sea_water_speed",
                valid_range=[0.0, 3.5]
            ),
            "u_current": VariableMetadata(
                name="u_current",
                long_name="Eastward Seawater Velocity (Copernicus uo)",
                units="m/s",
                standard_name="eastward_sea_water_velocity",
                valid_range=[-3.0, 3.0]
            ),
            "v_current": VariableMetadata(
                name="v_current",
                long_name="Northward Seawater Velocity (Copernicus vo)",
                units="m/s",
                standard_name="northward_sea_water_velocity",
                valid_range=[-3.0, 3.0]
            )
        }

        first_dt = datetime.fromisoformat(self.time_timestamps[0].replace("Z", "+00:00"))
        rel_hours = []
        for ts in self.time_timestamps:
            cur_dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            rel_hours.append(round((cur_dt - first_dt).total_seconds() / 3600.0, 1))

        return OceanMetadataResponse(
            title="Copernicus Marine GLORYS12V1 Global Ocean Physics Reanalysis",
            conventions="CF-1.4",
            institution="Copernicus Marine Service / Mercator Ocean International",
            source="MERCATOR GLORYS12V1 (cmems_mod_glo_phy_my_0.083deg_P1D-m)",
            synthetic=False,
            source_mode=SourceMode.REAL_LOCAL,
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            provider="Copernicus Marine Service (Mercator Ocean)",
            license_or_attribution="E.U. Copernicus Marine Service Information",
            provenance={
                "product_id": "GLOBAL_MULTIYEAR_PHY_001_030",
                "resolution_degrees": 0.083333,
                "resolution_km": 8.33,
                "nominal_grid": "0.083 deg (~8.3 km)",
                "citation": "Mercator Ocean International GLORYS12V1 Reanalysis",
                "status": "VERIFIED_REAL_LOCAL"
            },
            dimensions={
                "time": len(self.times),
                "depth": len(self.depths),
                "lat": len(self.lats),
                "lon": len(self.lons)
            },
            variables=variables_meta,
            time_steps_hours=rel_hours,
            time_timestamps=self.time_timestamps,
            depth_levels_m=[float(d) for d in self.depths],
            lat_bounds=[float(self.lats[0]), float(self.lats[-1])],
            lon_bounds=[float(self.lons[0]), float(self.lons[-1])],
            spatial_resolution="0.0833 degree rectilinear (~8.3 km grid)"
        )

    def slice_data(
        self,
        variable: str,
        time_idx: int = 0,
        depth: float = 0.0,
        lat_min: Optional[float] = None,
        lat_max: Optional[float] = None,
        lon_min: Optional[float] = None,
        lon_max: Optional[float] = None
    ) -> OceanDataSliceResponse:
        if not self.is_loaded():
            self.load_dataset()

        assert self.dataset is not None

        # Check cache
        cache_key = slice_cache.make_key(
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            variable=variable,
            time_idx=time_idx,
            depth=depth,
            lat_min=lat_min,
            lat_max=lat_max,
            lon_min=lon_min,
            lon_max=lon_max
        )
        cached_res = slice_cache.get(cache_key)
        if cached_res:
            res_obj = OceanDataSliceResponse(**cached_res)
            res_obj.cached = True
            return res_obj

        valid_vars = ["temperature", "salinity", "currents", "u_current", "v_current"]
        if variable not in valid_vars:
            raise ValueError(f"Unsupported variable '{variable}'. Supported: {valid_vars}")

        if time_idx < 0 or time_idx >= len(self.times):
            raise ValueError(f"time_idx {time_idx} out of range [0..{len(self.times)-1}]")

        # Spatial bounds are REQUIRED for the real dataset to prevent accidental
        # full-grid retrieval (301x601 = 180,901 cells).
        # The globe is a coordinate index, not a data container.
        if lat_min is None or lat_max is None or lon_min is None or lon_max is None:
            raise ValueError(
                "Spatial bounds (lat_min, lat_max, lon_min, lon_max) are required. "
                "The globe is a coordinate index, not a data container. "
                "Request a bounded region instead of the full global grid."
            )

        depth_idx = int(np.argmin(np.abs(self.depths - depth)))
        selected_depth = float(self.depths[depth_idx])

        j_min = 0
        j_max = len(self.lats) - 1
        i_min = 0
        i_max = len(self.lons) - 1

        if lat_min is not None:
            if lat_min > float(self.lats[-1]):
                raise ValueError(f"lat_min {lat_min} is north of domain boundary {self.lats[-1]}")
            j_min = max(0, min(len(self.lats)-1, int(np.searchsorted(self.lats, lat_min, side='left'))))

        if lat_max is not None:
            if lat_max < float(self.lats[0]):
                raise ValueError(f"lat_max {lat_max} is south of domain boundary {self.lats[0]}")
            j_max = max(0, min(len(self.lats)-1, int(np.searchsorted(self.lats, lat_max, side='right')) - 1))

        if j_min > j_max:
            raise ValueError(f"Invalid latitude range: min ({lat_min}) > max ({lat_max})")

        if lon_min is not None:
            if lon_min > float(self.lons[-1]):
                raise ValueError(f"lon_min {lon_min} is east of domain boundary {self.lons[-1]}")
            i_min = max(0, min(len(self.lons)-1, int(np.searchsorted(self.lons, lon_min, side='left'))))

        if lon_max is not None:
            if lon_max < float(self.lons[0]):
                raise ValueError(f"lon_max {lon_max} is west of domain boundary {self.lons[0]}")
            i_max = max(0, min(len(self.lons)-1, int(np.searchsorted(self.lons, lon_max, side='right')) - 1))

        if i_min > i_max:
            raise ValueError(f"Invalid longitude range: min ({lon_min}) > max ({lon_max})")

        # Progressive-detail (LOD) auto-decimation: the backend chooses the coarsest
        # integer decimation step that keeps the response within the payload budget.
        # This is a real LOD system derived from the dataset's native resolution.
        n_lat = j_max - j_min + 1
        n_lon = i_max - i_min + 1
        step = 1
        while ((n_lat // step) + (1 if n_lat % step else 0)) * ((n_lon // step) + (1 if n_lon % step else 0)) > MAX_GRID_CELLS and step < 32:
            step += 1
        eff_lat = (n_lat // step) + (1 if n_lat % step else 0)
        eff_lon = (n_lon // step) + (1 if n_lon % step else 0)
        n_cells = eff_lat * eff_lon
        if n_cells > MAX_GRID_CELLS:
            raise ValueError(
                f"Requested spatial extent yields {n_cells:,} grid cells, exceeding the "
                f"hard safety limit of {MAX_GRID_CELLS:,} cells even after decimation. "
                f"Please reduce geographic area, depth range, or time range."
            )

        effective_resolution_km = 8.33 * step
        resolution_label = (
            "~8.3 km (Copernicus GLORYS12V1)"
            if step == 1
            else f"~{effective_resolution_km:.1f} km LOD decimation (step={step}, macro view)"
        )

        sub_lats = self.lats[j_min:j_max+1:step]
        sub_lons = self.lons[i_min:i_max+1:step]

        u_arr_2d = None
        v_arr_2d = None

        if variable == "currents":
            u_raw = self.dataset.variables["uo"][time_idx, depth_idx, j_min:j_max+1:step, i_min:i_max+1:step]
            v_raw = self.dataset.variables["vo"][time_idx, depth_idx, j_min:j_max+1:step, i_min:i_max+1:step]
            raw_2d = np.sqrt(u_raw**2 + v_raw**2)
            u_arr_2d = u_raw
            v_arr_2d = v_raw
            units = "m/s"
        elif variable == "u_current":
            raw_2d = self.dataset.variables["uo"][time_idx, depth_idx, j_min:j_max+1:step, i_min:i_max+1:step]
            units = "m/s"
        elif variable == "v_current":
            raw_2d = self.dataset.variables["vo"][time_idx, depth_idx, j_min:j_max+1:step, i_min:i_max+1:step]
            units = "m/s"
        elif variable == "salinity":
            raw_2d = self.dataset.variables["so"][time_idx, depth_idx, j_min:j_max+1:step, i_min:i_max+1:step]
            units = "PSU"
        else:  # temperature
            raw_2d = self.dataset.variables["thetao"][time_idx, depth_idx, j_min:j_max+1:step, i_min:i_max+1:step]
            units = "degC"

        values_nested = []
        u_nested = [] if u_arr_2d is not None else None
        v_nested = [] if v_arr_2d is not None else None
        valid_vals = []
        missing_count = 0
        valid_count = 0

        for r_idx in range(raw_2d.shape[0]):
            row_vals = []
            u_row = [] if u_arr_2d is not None else None
            v_row = [] if v_arr_2d is not None else None

            for c_idx in range(raw_2d.shape[1]):
                val = raw_2d[r_idx, c_idx]
                sanitized = sanitize_value(val)
                row_vals.append(sanitized)
                if sanitized is None:
                    missing_count += 1
                else:
                    valid_count += 1
                    valid_vals.append(sanitized)

                if u_arr_2d is not None:
                    u_row.append(sanitize_value(u_arr_2d[r_idx, c_idx]))
                    v_row.append(sanitize_value(v_arr_2d[r_idx, c_idx]))

            values_nested.append(row_vals)
            if u_nested is not None:
                u_nested.append(u_row)
                v_nested.append(v_row)

        min_val = min(valid_vals) if valid_vals else None
        max_val = max(valid_vals) if valid_vals else None

        res_payload = OceanDataSliceResponse(
            variable=variable,
            units=units,
            time_idx=time_idx,
            timestamp=self.time_timestamps[time_idx],
            requested_depth=float(depth),
            selected_depth=selected_depth,
            source_mode=SourceMode.REAL_LOCAL,
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            resolution=resolution_label,
            cached=False,
            shape=[len(sub_lats), len(sub_lons)],
            lats=[float(la) for la in sub_lats],
            lons=[float(lo) for lo in sub_lons],
            values=values_nested,
            u_values=u_nested,
            v_values=v_nested,
            min_val=min_val,
            max_val=max_val,
            missing_count=missing_count,
            valid_count=valid_count
        )

        slice_cache.set(cache_key, res_payload.model_dump())
        return res_payload

    def _get_interpolator(self, copernicus_var: str, time_idx: int) -> RegularGridInterpolator:
        key = (copernicus_var, time_idx)
        if key in self._interpolator_cache:
            return self._interpolator_cache[key]

        raw_data = self.dataset.variables[copernicus_var][time_idx, :, :, :]
        data = np.array(raw_data, dtype=np.float32)
        if np.ma.is_masked(raw_data):
            data[raw_data.mask] = np.nan

        interp = RegularGridInterpolator(
            (self.depths, self.lats, self.lons),
            data,
            method='linear',
            bounds_error=False,
            fill_value=np.nan
        )
        self._interpolator_cache[key] = interp
        return interp

    def probe_water_column(self, lat: float, lon: float, time_idx: int = 0) -> OceanProbeResponse:
        if not self.is_loaded():
            self.load_dataset()

        assert self.dataset is not None
        if time_idx < 0 or time_idx >= len(self.times):
            raise ValueError(f"time_idx {time_idx} out of range [0..{len(self.times)-1}]")

        if lat < self.lats[0] or lat > self.lats[-1] or lon < self.lons[0] or lon > self.lons[-1]:
            raise ValueError(f"Target coordinates ({lat}, {lon}) outside domain bounds [lat: {self.lats[0]}..{self.lats[-1]}, lon: {self.lons[0]}..{self.lons[-1]}].")

        t_interp = self._get_interpolator("thetao", time_idx)
        s_interp = self._get_interpolator("so", time_idx)
        u_interp = self._get_interpolator("uo", time_idx)
        v_interp = self._get_interpolator("vo", time_idx)

        pts = np.column_stack([self.depths, np.full_like(self.depths, lat), np.full_like(self.depths, lon)])
        t_vals = [sanitize_value(v) for v in t_interp(pts)]
        s_vals = [sanitize_value(v) for v in s_interp(pts)]
        u_vals = [sanitize_value(v) for v in u_interp(pts)]
        v_vals = [sanitize_value(v) for v in v_interp(pts)]

        spd_vals = []
        for u, v in zip(u_vals, v_vals):
            if u is not None and v is not None:
                spd_vals.append(round(math.sqrt(u**2 + v**2), 4))
            else:
                spd_vals.append(None)

        is_land = all(v is None for v in t_vals)
        metrics = calculate_derived_ocean_metrics(self.depths.tolist(), t_vals)
        nearest_obs = find_nearest_collocated_obs(lat, lon, max_dist_km=200.0)

        return OceanProbeResponse(
            lat=lat,
            lon=lon,
            time_idx=time_idx,
            timestamp=self.time_timestamps[time_idx],
            is_land=is_land,
            depths=[float(d) for d in self.depths],
            temperature=t_vals,
            salinity=s_vals,
            u_current=u_vals,
            v_current=v_vals,
            current_speed=spd_vals,
            sst=metrics["sst"],
            sss=s_vals[0] if s_vals else None,
            surface_current_speed=spd_vals[0] if spd_vals else None,
            mld=metrics["mld"],
            d20=metrics["d20"],
            d26=metrics["d26"],
            tchp=metrics["tchp"],
            tchp_category=metrics["tchp_category"],
            nearest_observation=nearest_obs
        )

    def extract_transect(
        self,
        lat1: float,
        lon1: float,
        lat2: float,
        lon2: float,
        variable: str = "temperature",
        time_idx: int = 0
    ) -> OceanTransectResponse:
        if not self.is_loaded():
            self.load_dataset()

        assert self.dataset is not None
        if time_idx < 0 or time_idx >= len(self.times):
            raise ValueError(f"time_idx {time_idx} out of range [0..{len(self.times)-1}]")

        lat_min, lat_max = float(self.lats[0]), float(self.lats[-1])
        lon_min, lon_max = float(self.lons[0]), float(self.lons[-1])

        for (l_lat, l_lon, label) in [(lat1, lon1, "Start"), (lat2, lon2, "End")]:
            if l_lat < lat_min or l_lat > lat_max or l_lon < lon_min or l_lon > lon_max:
                raise ValueError(f"{label} coordinates ({l_lat}, {l_lon}) outside domain [lat: {lat_min}..{lat_max}, lon: {lon_min}..{lon_max}].")

        c_var = "thetao" if variable == "temperature" else ("so" if variable == "salinity" else variable)
        units = "degC" if variable == "temperature" else ("PSU" if variable == "salinity" else "m/s")

        num_points = 100
        total_dist_km = haversine_km(lat1, lon1, lat2, lon2)
        distances_km = [round(float(d), 2) for d in np.linspace(0.0, total_dist_km, num_points)]
        transect_lats = np.linspace(lat1, lat2, num_points)
        transect_lons = np.linspace(lon1, lon2, num_points)

        if variable == "currents":
            u_rgi = self._get_interpolator("uo", time_idx)
            v_rgi = self._get_interpolator("vo", time_idx)
        else:
            rgi = self._get_interpolator(c_var, time_idx)

        matrix: List[List[Optional[float]]] = []
        all_vals: List[float] = []

        for d in self.depths:
            pts = np.column_stack([np.full(num_points, d), transect_lats, transect_lons])
            row = []
            if variable == "currents":
                u_row = u_rgi(pts)
                v_row = v_rgi(pts)
                for u, v in zip(u_row, v_row):
                    if not np.isnan(u) and not np.isnan(v):
                        val = round(float(math.sqrt(u**2 + v**2)), 3)
                        row.append(val)
                        all_vals.append(val)
                    else:
                        row.append(None)
            else:
                interp_row = rgi(pts)
                for v in interp_row:
                    san = sanitize_value(v)
                    row.append(san)
                    if san is not None:
                        all_vals.append(san)
            matrix.append(row)

        # Derived metrics along transect
        t_rgi = self._get_interpolator("thetao", time_idx)
        mld_profile: List[Optional[float]] = []
        d20_profile: List[Optional[float]] = []
        tchp_profile: List[Optional[float]] = []

        for i in range(num_points):
            pts_col = np.column_stack([self.depths, np.full(len(self.depths), transect_lats[i]), np.full(len(self.depths), transect_lons[i])])
            t_col = [sanitize_value(v) for v in t_rgi(pts_col)]
            if all(v is None for v in t_col):
                mld_profile.append(None)
                d20_profile.append(None)
                tchp_profile.append(None)
            else:
                m = calculate_derived_ocean_metrics(self.depths.tolist(), t_col)
                mld_profile.append(m["mld"])
                d20_profile.append(m["d20"])
                tchp_profile.append(m["tchp"])

        min_val = min(all_vals) if all_vals else None
        max_val = max(all_vals) if all_vals else None

        return OceanTransectResponse(
            lat1=lat1,
            lon1=lon1,
            lat2=lat2,
            lon2=lon2,
            variable=variable,
            units=units,
            time_idx=time_idx,
            timestamp=self.time_timestamps[time_idx],
            num_points=num_points,
            total_distance_km=round(total_dist_km, 2),
            distances_km=distances_km,
            lats=[round(float(y), 4) for y in transect_lats],
            lons=[round(float(x), 4) for x in transect_lons],
            depth_levels=[float(d) for d in self.depths],
            matrix=matrix,
            min_val=min_val,
            max_val=max_val,
            mld_profile=mld_profile,
            d20_profile=d20_profile,
            tchp_profile=tchp_profile,
            dataset_id=self.dataset_id
        )

    def get_availability(self, lat: float, lon: float) -> LocationAvailabilityResponse:
        """Returns lightweight metadata about data availability at (lat, lon). No field values."""
        if not self.is_loaded():
            self.load_dataset()
        if lat < float(self.lats[0]) or lat > float(self.lats[-1]) or lon < float(self.lons[0]) or lon > float(self.lons[-1]):
            return LocationAvailabilityResponse(latitude=lat, longitude=lon, model=False,
                                                dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m")
        j_near = int(np.argmin(np.abs(self.lats - lat)))
        i_near = int(np.argmin(np.abs(self.lons - lon)))
        surface_mask = np.ma.getmaskarray(self.dataset.variables["thetao"][0, 0, :, :])
        is_land = bool(surface_mask[j_near, i_near])
        obs = {"argo": False, "glider": False, "ctd": False, "bgc": False}
        try:
            from backend.app.services.insitu_service import insitu_service
            for prof in insitu_service.get_all_profiles(source_mode="ALL"):
                p_lat, p_lon = prof.get("lat"), prof.get("lon")
                if p_lat is None or p_lon is None:
                    continue
                if haversine_km(lat, lon, float(p_lat), float(p_lon)) <= 200.0:
                    ptype = (prof.get("platform_type") or "argo").lower()
                    if ptype in obs:
                        obs[ptype] = True
        except Exception:
            pass
        return LocationAvailabilityResponse(
            latitude=lat,
            longitude=lon,
            model=not is_land,
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            observations=obs,
            variables=["temperature", "salinity", "currents", "u_current", "v_current"],
            depths=[float(d) for d in self.depths],
            times=self.time_timestamps
        )

    def get_point(self, lat: float, lon: float, variable: str, depth: float, time_idx: int = 0) -> PointValueResponse:
        """Returns a single interpolated model value at (lat, lon, depth, time)."""
        if not self.is_loaded():
            self.load_dataset()
        if time_idx < 0 or time_idx >= len(self.times):
            raise ValueError(f"time_idx {time_idx} out of range [0..{len(self.times)-1}]")
        if lat < float(self.lats[0]) or lat > float(self.lats[-1]) or lon < float(self.lons[0]) or lon > float(self.lons[-1]):
            raise ValueError(f"Coordinates ({lat}, {lon}) outside domain bounds.")
        cvar = {"temperature": "thetao", "salinity": "so",
                "u_current": "uo", "v_current": "vo", "currents": "uo"}.get(variable)
        if cvar is None:
            raise ValueError(f"Unsupported variable '{variable}'")
        rgi = self._get_interpolator(cvar, time_idx)
        pts = np.array([[depth, lat, lon]])
        val = sanitize_value(rgi(pts)[0])
        depth_idx = int(np.argmin(np.abs(self.depths - depth)))
        selected_depth = float(self.depths[depth_idx])
        units_map = {"temperature": "degC", "salinity": "PSU", "u_current": "m/s",
                     "v_current": "m/s", "currents": "m/s"}
        return PointValueResponse(
            lat=lat, lon=lon, depth=depth, time=self.time_timestamps[time_idx],
            variable=variable, value=val, unit=units_map.get(variable, "degC"),
            nearest_depth=selected_depth, interpolation_method="trilinear",
            source="Copernicus GLORYS12V1 Reanalysis", dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m"
        )
    def get_profile(self, lat: float, lon: float, variable: str, time_idx: int = 0) -> ProfileResponse:
        """Returns a vertical profile at (lat, lon) for one variable across all dataset depths."""
        probe = self.probe_water_column(lat=lat, lon=lon, time_idx=time_idx)
        var_map = {"temperature": probe.temperature, "salinity": probe.salinity,
                   "u_current": probe.u_current, "v_current": probe.v_current,
                   "currents": probe.current_speed}
        values = var_map.get(variable, probe.temperature)
        unit_map = {"temperature": "degC", "salinity": "PSU", "u_current": "m/s",
                    "v_current": "m/s", "currents": "m/s"}
        return ProfileResponse(
            lat=lat, lon=lon, variable=variable, unit=unit_map.get(variable, "degC"),
            time_idx=time_idx, timestamp=probe.timestamp,
            depths=[float(d) for d in probe.depths],
            values=values,
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            source="Copernicus GLORYS12V1 Reanalysis",
            provenance={
                "interpolation_method": "RegularGridInterpolator (linear)",
                "product_id": "GLOBAL_MULTIYEAR_PHY_001_030",
                "citation": "E.U. Copernicus Marine Service Information"
            }
        )

    def get_region(
        self,
        center_lat: float,
        center_lon: float,
        radius_km: float,
        variable: str,
        depth_min: float,
        depth_max: float,
        time_idx: int = 0
    ) -> RegionResponse:
        """Returns a bounded 3D region subset around (center_lat, center_lon) for local visualization."""
        if not self.is_loaded():
            self.load_dataset()
        lat_span = radius_km / 111.0
        lon_span = radius_km / (111.0 * max(0.01, abs(math.cos(math.radians(center_lat)))))
        lat_min = max(float(self.lats[0]), center_lat - lat_span)
        lat_max = min(float(self.lats[-1]), center_lat + lat_span)
        lon_min = max(float(self.lons[0]), center_lon - lon_span)
        lon_max = min(float(self.lons[-1]), center_lon + lon_span)
        depth_min_idx = int(np.argmin(np.abs(self.depths - depth_min)))
        depth_max_idx = int(np.argmin(np.abs(self.depths - depth_max)))
        if depth_min_idx > depth_max_idx:
            depth_min_idx, depth_max_idx = depth_max_idx, depth_min_idx
        slices = []
        all_vals = []
        last_slice = None
        for k in range(depth_min_idx, depth_max_idx + 1):
            d = float(self.depths[k])
            sl = self.slice_data(variable=variable, time_idx=time_idx, depth=d,
                                 lat_min=lat_min, lat_max=lat_max, lon_min=lon_min, lon_max=lon_max)
            slices.append(sl.values)
            last_slice = sl
            for row in sl.values:
                for v in row:
                    if v is not None:
                        all_vals.append(v)
        sub_depths = [float(self.depths[k]) for k in range(depth_min_idx, depth_max_idx + 1)]
        unit = "degC" if variable == "temperature" else ("PSU" if variable == "salinity" else "m/s")
        return RegionResponse(
            center_lat=center_lat, center_lon=center_lon, radius_km=radius_km,
            variable=variable, unit=unit,
            time_idx=time_idx, timestamp=self.time_timestamps[time_idx],
            depth_min=float(self.depths[depth_min_idx]), depth_max=float(self.depths[depth_max_idx]),
            lats=last_slice.lats if last_slice else [],
            lons=last_slice.lons if last_slice else [],
            depths=sub_depths, slices=slices,
            shape=[len(sub_depths), len(last_slice.lats) if last_slice else 0, len(last_slice.lons) if last_slice else 0],
            min_val=min(all_vals) if all_vals else None,
            max_val=max(all_vals) if all_vals else None,
            valid_count=len(all_vals),
            resolution=f"Copernicus GLORYS12V1 (~8.3 km) bounded region, radius {radius_km} km",
            source_mode=SourceMode.REAL_LOCAL,
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m"
        )

    def get_volume_data(
        self,
        variable: str = "temperature",
        time_idx: int = 0,
        center_lat: Optional[float] = None,
        center_lon: Optional[float] = None,
        radius_km: Optional[float] = None,
        min_lon: Optional[float] = None,
        max_lon: Optional[float] = None,
        min_lat: Optional[float] = None,
        max_lat: Optional[float] = None,
        depth_min: Optional[float] = None,
        depth_max: Optional[float] = None,
        max_lat_samples: int = 48,
        max_lon_samples: int = 48,
        max_depth_samples: int = 24,
    ) -> OceanVolumeResponse:
        if not self.is_loaded():
            self.load_dataset()

        assert self.dataset is not None

        # Convert center_lat, center_lon, radius_km to bounds if provided
        if center_lat is not None and center_lon is not None and radius_km is not None:
            lat_span = radius_km / 111.0
            lon_span = radius_km / (111.0 * max(0.01, abs(math.cos(math.radians(center_lat)))))
            min_lat = max(float(self.lats[0]), center_lat - lat_span)
            max_lat = min(float(self.lats[-1]), center_lat + lat_span)
            min_lon = max(float(self.lons[0]), center_lon - lon_span)
            max_lon = min(float(self.lons[-1]), center_lon + lon_span)

        cache_key = slice_cache.make_volume_key(
            dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
            variable=variable,
            time_idx=time_idx,
            min_lon=min_lon,
            max_lon=max_lon,
            min_lat=min_lat,
            max_lat=max_lat,
            depth_min=depth_min,
            depth_max=depth_max,
            max_lat_samples=max_lat_samples,
            max_lon_samples=max_lon_samples,
            max_depth_samples=max_depth_samples,
        )
        cached_res = slice_cache.get(cache_key)
        if cached_res:
            res = OceanVolumeResponse(**cached_res)
            res.cached = True
            return res

        eff_min_lon = max(float(self.lons[0]), min_lon) if min_lon is not None else float(self.lons[0])
        eff_max_lon = min(float(self.lons[-1]), max_lon) if max_lon is not None else float(self.lons[-1])
        eff_min_lat = max(float(self.lats[0]), min_lat) if min_lat is not None else float(self.lats[0])
        eff_max_lat = min(float(self.lats[-1]), max_lat) if max_lat is not None else float(self.lats[-1])
        eff_min_depth = max(float(self.depths[0]), depth_min) if depth_min is not None else float(self.depths[0])
        eff_max_depth = min(float(self.depths[-1]), depth_max) if depth_max is not None else float(self.depths[-1])

        i_min = max(0, min(len(self.lons) - 1, int(np.searchsorted(self.lons, eff_min_lon, side='left'))))
        i_max = max(0, min(len(self.lons) - 1, int(np.searchsorted(self.lons, eff_max_lon, side='right')) - 1))
        if i_min > i_max:
            i_min, i_max = i_max, i_min

        j_min = max(0, min(len(self.lats) - 1, int(np.searchsorted(self.lats, eff_min_lat, side='left'))))
        j_max = max(0, min(len(self.lats) - 1, int(np.searchsorted(self.lats, eff_max_lat, side='right')) - 1))
        if j_min > j_max:
            j_min, j_max = j_max, j_min

        k_min = max(0, min(len(self.depths) - 1, int(np.searchsorted(self.depths, eff_min_depth, side='left'))))
        k_max = max(0, min(len(self.depths) - 1, int(np.searchsorted(self.depths, eff_max_depth, side='right')) - 1))
        if k_min > k_max:
            k_min, k_max = k_max, k_min

        n_lon = i_max - i_min + 1
        n_lat = j_max - j_min + 1
        n_depth = k_max - k_min + 1

        stride_x = max(1, math.ceil(n_lon / max_lon_samples))
        stride_y = max(1, math.ceil(n_lat / max_lat_samples))
        stride_z = max(1, math.ceil(n_depth / max_depth_samples))

        sub_lons = [round(float(x), 4) for x in self.lons[i_min:i_max + 1:stride_x]]
        sub_lats = [round(float(y), 4) for y in self.lats[j_min:j_max + 1:stride_y]]
        sub_depths = [round(float(z), 2) for z in self.depths[k_min:k_max + 1:stride_z]]

        time_idx = max(0, min(len(self.times) - 1, time_idx))
        timestamp = self.time_timestamps[time_idx] if self.time_timestamps else ""

        u_3d = None
        v_3d = None
        if variable == "currents":
            u_raw = self.dataset.variables["uo"][time_idx, k_min:k_max + 1:stride_z, j_min:j_max + 1:stride_y, i_min:i_max + 1:stride_x]
            v_raw = self.dataset.variables["vo"][time_idx, k_min:k_max + 1:stride_z, j_min:j_max + 1:stride_y, i_min:i_max + 1:stride_x]
            u_sq = np.where(np.ma.getmaskarray(u_raw) | np.isnan(u_raw), 0.0, np.asarray(u_raw)**2)
            v_sq = np.where(np.ma.getmaskarray(v_raw) | np.isnan(v_raw), 0.0, np.asarray(v_raw)**2)
            raw_3d = np.sqrt(np.maximum(0.0, u_sq + v_sq))
            u_3d = u_raw
            v_3d = v_raw
            units = "m/s"
            raw_name = "uo,vo"
        elif variable == "u_current":
            raw_3d = self.dataset.variables["uo"][time_idx, k_min:k_max + 1:stride_z, j_min:j_max + 1:stride_y, i_min:i_max + 1:stride_x]
            u_3d = raw_3d
            units = "m/s"
            raw_name = "uo"
        elif variable == "v_current":
            raw_3d = self.dataset.variables["vo"][time_idx, k_min:k_max + 1:stride_z, j_min:j_max + 1:stride_y, i_min:i_max + 1:stride_x]
            v_3d = raw_3d
            units = "m/s"
            raw_name = "vo"
        elif variable == "salinity":
            raw_3d = self.dataset.variables["so"][time_idx, k_min:k_max + 1:stride_z, j_min:j_max + 1:stride_y, i_min:i_max + 1:stride_x]
            units = "PSU"
            raw_name = "so"
        else:
            variable = "temperature"
            raw_3d = self.dataset.variables["thetao"][time_idx, k_min:k_max + 1:stride_z, j_min:j_max + 1:stride_y, i_min:i_max + 1:stride_x]
            units = "degC"
            raw_name = "thetao"

        raw_np = np.asarray(raw_3d)
        mask_np = np.ma.getmaskarray(raw_3d) if np.ma.is_masked(raw_3d) else np.zeros(raw_np.shape, dtype=bool)
        nan_mask = np.isnan(raw_np) | (raw_np < -1e9) | (raw_np > 1e9) | mask_np

        values_3d: List[List[List[Optional[float]]]] = []
        valid_vals: List[float] = []

        nz, ny, nx = raw_np.shape
        for k in range(nz):
            plane = []
            for j in range(ny):
                row = []
                for i in range(nx):
                    if nan_mask[k, j, i]:
                        row.append(None)
                    else:
                        val = round(float(raw_np[k, j, i]), 2 if variable != "currents" else 3)
                        row.append(val)
                        valid_vals.append(val)
                plane.append(row)
            values_3d.append(plane)

        u_values_3d = None
        v_values_3d = None
        if u_3d is not None:
            u_values_3d = []
            u_np = np.asarray(u_3d)
            u_mask = np.ma.getmaskarray(u_3d) if np.ma.is_masked(u_3d) else np.zeros(u_np.shape, dtype=bool)
            for k in range(nz):
                plane = []
                for j in range(ny):
                    row = []
                    for i in range(nx):
                        if u_mask[k, j, i] or np.isnan(u_np[k, j, i]):
                            row.append(None)
                        else:
                            row.append(round(float(u_np[k, j, i]), 3))
                    plane.append(row)
                u_values_3d.append(plane)
        if v_3d is not None:
            v_values_3d = []
            v_np = np.asarray(v_3d)
            v_mask = np.ma.getmaskarray(v_3d) if np.ma.is_masked(v_3d) else np.zeros(v_np.shape, dtype=bool)
            for k in range(nz):
                plane = []
                for j in range(ny):
                    row = []
                    for i in range(nx):
                        if v_mask[k, j, i] or np.isnan(v_np[k, j, i]):
                            row.append(None)
                        else:
                            row.append(round(float(v_np[k, j, i]), 3))
                    plane.append(row)
                v_values_3d.append(plane)

        response = OceanVolumeResponse(
            dataset=VolumeDatasetMeta(
                id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
                name="Copernicus GLORYS12V1 Global Physics Reanalysis",
                provider="Copernicus Marine Service / Mercator Ocean",
                source_mode=SourceMode.REAL_LOCAL.value,
            ),
            variable=VolumeVariableMeta(
                name=variable,
                raw_name=raw_name,
                units=units
            ),
            bounds=VolumeBoundsMeta(
                min_lon=sub_lons[0] if sub_lons else 0.0,
                max_lon=sub_lons[-1] if sub_lons else 0.0,
                min_lat=sub_lats[0] if sub_lats else 0.0,
                max_lat=sub_lats[-1] if sub_lats else 0.0,
                min_depth=sub_depths[0] if sub_depths else 0.0,
                max_depth=sub_depths[-1] if sub_depths else 0.0
            ),
            coordinates=VolumeCoordinates(
                longitude=sub_lons,
                latitude=sub_lats,
                depth=sub_depths
            ),
            values=values_3d,
            shape=[nz, ny, nx],
            native_shape=[len(self.depths), len(self.lats), len(self.lons)],
            render_shape=[nz, ny, nx],
            min_value=min(valid_vals) if valid_vals else None,
            max_value=max(valid_vals) if valid_vals else None,
            resolution=VolumeResolution(
                horizontal_km=round(8.33 * stride_x, 2),
                vertical_levels=nz
            ),
            timestamp=timestamp,
            provenance=VolumeProvenance(
                provider="Copernicus Marine Service / Mercator Ocean",
                dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
                source_mode=SourceMode.REAL_LOCAL.value
            ),
            u_values=u_values_3d,
            v_values=v_values_3d,
            cached=False
        )
        slice_cache.set(cache_key, response.model_dump(), write_disk=False)
        return response


