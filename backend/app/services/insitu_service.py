"""
SAMUDRA-3D In-situ Observation Service
Ingests real Argo GDAC, IFREMER gliders, INCOIS moored buoys, and user-registered sensors.
"""
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import json
import uuid
import math
from backend.app.core.config import settings
from backend.app.db import get_db_connection
from backend.app.schemas.insitu import (
    QCFlagSummary,
    ArgoProfileMetadata,
    ArgoProfileSummary,
    ArgoProfileDetail,
    GliderWaypoint,
    GliderTransectSummary,
    GliderTransectDetail,
    BuoySummary,
    BuoyDetail,
    InsituStatusResponse,
    SensorRegistrationRequest
)
from backend.app.data.argo_ingest import scan_argo_directory
from backend.app.data.glider_ingest import scan_glider_directory

# Standard Indian Ocean domain bounds
DOMAIN_LAT_MIN = -30.0
DOMAIN_LAT_MAX = 30.0
DOMAIN_LON_MIN = 30.0
DOMAIN_LON_MAX = 120.0

PRESSURE_TO_DEPTH_FACTOR = 0.992

class InsituDataService:
    def __init__(
        self,
        argo_path: Path = settings.ARGO_PATH,
        real_sample_path: Path = settings.SAMPLE_DATA_DIR / "real_argo_sample.json",
        glider_path: Path = settings.SAMPLE_DATA_DIR / "glider_transects.json",
        real_glider_path: Path = settings.SAMPLE_DATA_DIR / "real_glider_sample.json",
        raw_data_dir: Optional[Path] = None
    ):
        self.argo_path = argo_path
        self.real_sample_path = real_sample_path
        self.glider_path = glider_path
        self.real_glider_path = real_glider_path
        self._raw_data_dir = raw_data_dir

        self.synthetic_profiles: List[Dict[str, Any]] = []
        self.real_profiles: List[Dict[str, Any]] = []
        self.custom_profiles: List[Dict[str, Any]] = []
        self._profiles_by_id: Dict[str, Dict[str, Any]] = {}

        self.synthetic_gliders: List[Dict[str, Any]] = []
        self.real_gliders: List[Dict[str, Any]] = []
        self._gliders_by_id: Dict[str, Dict[str, Any]] = {}

        self.buoy_stations: List[Dict[str, Any]] = []
        self._buoys_by_id: Dict[str, Dict[str, Any]] = {}

        self.load_observations()
        self.load_custom_sensors()

    def is_in_domain(self, lat: float, lon: float) -> bool:
        """Verifies if coordinates fall within Indian Ocean domain bounds."""
        return (DOMAIN_LAT_MIN <= lat <= DOMAIN_LAT_MAX) and (DOMAIN_LON_MIN <= lon <= DOMAIN_LON_MAX)

    def compute_qc_summary(self, qc_flags: List[int]) -> QCFlagSummary:
        """Computes statistical summary of WMO Argo/Glider QC flags (1=good, 2=probably good, 3=bad, 4=outlier)."""
        good = sum(1 for f in qc_flags if f == 1)
        probably_good = sum(1 for f in qc_flags if f == 2)
        bad = sum(1 for f in qc_flags if f in (3, 4))
        missing = sum(1 for f in qc_flags if f == 9)
        total = len(qc_flags)
        pass_rate = round(((good + probably_good) / total * 100.0), 1) if total > 0 else 0.0
        return QCFlagSummary(
            good=good,
            probably_good=probably_good,
            bad=bad,
            missing=missing,
            total=total,
            pass_rate_pct=pass_rate
        )

    def normalize_profile(self, raw: Dict[str, Any], default_source_mode: str = "SYNTHETIC") -> Optional[Dict[str, Any]]:
        """Normalizes raw profile records with domain verification, QC analysis, and pressure-to-depth conversion."""
        profile_id = raw.get("id")
        lat = raw.get("lat")
        lon = raw.get("lon")

        if not profile_id or lat is None or lon is None:
            return None

        # Domain boundary check
        if not self.is_in_domain(lat, lon):
            return None

        depths = raw.get("depths")
        if not depths and "pressure" in raw:
            depths = [round(p * PRESSURE_TO_DEPTH_FACTOR, 2) for p in raw["pressure"]]

        if not depths:
            depths = [0.0]

        temps = raw.get("temperature", [])
        sals = raw.get("salinity", [])
        qc_flags = raw.get("qc_flags", [1] * len(depths))

        qc_summary = self.compute_qc_summary(qc_flags)
        metadata = raw.get("metadata", {})
        source_mode = metadata.get("source_mode", default_source_mode)

        wmo_id = metadata.get("wmo_id") or raw.get("wmo_id")
        if not wmo_id and "ARGO_" in profile_id:
            wmo_id = profile_id.replace("ARGO_", "").split("_")[0]

        surface_temp = temps[0] if temps else None
        surface_sal = sals[0] if sals else None
        max_depth = max(depths) if depths else 0.0

        return {
            "id": profile_id,
            "platform_type": raw.get("platform_type", "argo"),
            "name": raw.get("name", f"Sensor {profile_id}"),
            "wmo_id": wmo_id,
            "lat": float(lat),
            "lon": float(lon),
            "timestamp": raw.get("timestamp", datetime.now(timezone.utc).isoformat()),
            "depths": depths,
            "temperature": temps,
            "salinity": sals,
            "qc_flags": qc_flags,
            "qc_summary": qc_summary.model_dump(),
            "max_depth": max_depth,
            "num_levels": len(depths),
            "surface_temp": surface_temp,
            "surface_salinity": surface_sal,
            "metadata": metadata,
            "source_mode": source_mode
        }

    def normalize_glider_transect(self, raw: Dict[str, Any], default_source_mode: str = "SYNTHETIC") -> Optional[Dict[str, Any]]:
        """Normalizes underwater glider mission transect data with 3D waypoints and dive cycles."""
        glider_id = raw.get("id")
        lat = raw.get("lat")
        lon = raw.get("lon")

        if not glider_id or lat is None or lon is None:
            return None

        if not self.is_in_domain(lat, lon):
            return None

        waypoints = raw.get("waypoints", [])
        clean_waypoints = []
        for wp in waypoints:
            w_lat = wp.get("lat")
            w_lon = wp.get("lon")
            if w_lat is None or w_lon is None:
                continue
            if not self.is_in_domain(w_lat, w_lon):
                continue
            
            w_depth = wp.get("depth")
            if w_depth is None and "pressure_dbar" in wp:
                w_depth = round(wp["pressure_dbar"] * PRESSURE_TO_DEPTH_FACTOR, 2)

            clean_waypoints.append({
                "waypoint_index": wp.get("waypoint_index", len(clean_waypoints)),
                "timestamp": wp.get("timestamp", raw.get("timestamp")),
                "lat": float(w_lat),
                "lon": float(w_lon),
                "depth": w_depth,
                "pressure_dbar": wp.get("pressure_dbar"),
                "temperature": wp.get("temperature"),
                "salinity": wp.get("salinity"),
                "qc_flag": wp.get("qc_flag", 1),
                "phase": wp.get("phase", "dive"),
                "dive_number": wp.get("dive_number", 1)
            })

        metadata = raw.get("metadata", {})
        source_mode = metadata.get("source_mode", default_source_mode)
        qc_flags = raw.get("qc_flags") or [wp["qc_flag"] for wp in clean_waypoints]
        qc_summary = self.compute_qc_summary(qc_flags)

        depths = raw.get("depths")
        if not depths:
            depths = sorted(list({wp["depth"] for wp in clean_waypoints if wp["depth"] is not None}))

        temps = raw.get("temperature")
        sals = raw.get("salinity")

        return {
            "id": glider_id,
            "platform_type": "glider",
            "name": raw.get("name", f"Glider {glider_id}"),
            "wmo_id": raw.get("wmo_id") or metadata.get("wmo_id"),
            "model": raw.get("model") or metadata.get("glider_model", "Slocum / Seaglider"),
            "mission": raw.get("mission") or metadata.get("mission", "Ocean Transect"),
            "lat": float(lat),
            "lon": float(lon),
            "timestamp": raw.get("timestamp", datetime.now(timezone.utc).isoformat()),
            "total_dives": raw.get("total_dives", 1),
            "max_depth": raw.get("max_depth", 1000.0),
            "total_waypoints": len(clean_waypoints),
            "surface_temp": raw.get("surface_temp"),
            "surface_salinity": raw.get("surface_salinity"),
            "depths": depths,
            "temperature": temps or [],
            "salinity": sals or [],
            "qc_flags": qc_flags,
            "qc_summary": qc_summary.model_dump(),
            "waypoints": clean_waypoints,
            "metadata": metadata,
            "source_mode": source_mode
        }

    def normalize_buoy(self, raw: Dict[str, Any], default_source_mode: str = "BUNDLED_REFERENCE") -> Optional[Dict[str, Any]]:
        """Normalizes INCOIS moored ocean buoy stations and thermistor chain profiles."""
        buoy_id = raw.get("id")
        lat = raw.get("lat")
        lon = raw.get("lon")

        if not buoy_id or lat is None or lon is None:
            return None

        if not self.is_in_domain(lat, lon):
            return None

        depths = raw.get("depths")
        if not depths and "pressure" in raw:
            depths = [round(p * PRESSURE_TO_DEPTH_FACTOR, 2) for p in raw["pressure"]]
        if not depths:
            depths = [0.5]

        temps = raw.get("temperature", [])
        sals = raw.get("salinity", [])
        qc_flags = raw.get("qc_flags")

        qc_summary = self.compute_qc_summary(qc_flags).model_dump() if qc_flags is not None else None
        metadata = dict(raw.get("metadata", {}))
        source_mode = raw.get("source_mode") or metadata.get("source_mode") or default_source_mode
        default_badge = "[REAL • LOCAL_FILE]" if source_mode == "REAL_LOCAL" else "[REFERENCE • BUNDLED]"
        provenance_badge = raw.get("provenance_badge") or metadata.get("provenance_badge") or default_badge
        provenance_note = raw.get("provenance_note") or metadata.get("provenance_note")
        if not provenance_note:
            if source_mode == "REAL_LOCAL":
                file_name = metadata.get("file")
                provenance_note = f"Parsed from local file {file_name}" if file_name else "Parsed from local file"
            elif source_mode == "BUNDLED_REFERENCE":
                provenance_note = "Bundled reference sample · illustrative, not live"
        provider = raw.get("provider") or metadata.get("provider", "INCOIS")

        wmo_id = raw.get("wmo_id") or metadata.get("wmo_id")
        if not wmo_id and "BUOY_" in buoy_id:
            wmo_id = buoy_id.replace("INCOIS_BUOY_", "").replace("BUOY_", "")

        surface_temp = raw.get("surface_temp") if raw.get("surface_temp") is not None else (temps[0] if temps else None)
        surface_sal = raw.get("surface_salinity") if raw.get("surface_salinity") is not None else (sals[0] if sals else None)
        max_depth = max(depths) if depths else 0.0

        return {
            "id": buoy_id,
            "platform_type": "buoy",
            "name": raw.get("name", f"INCOIS Buoy {buoy_id}"),
            "wmo_id": str(wmo_id) if wmo_id is not None else None,
            "lat": float(lat),
            "lon": float(lon),
            "timestamp": raw.get("timestamp"),
            "depths": depths,
            "temperature": temps,
            "salinity": sals,
            "qc_flags": qc_flags,
            "qc_summary": qc_summary,
            "max_depth": float(max_depth),
            "num_levels": len(depths),
            "surface_temp": surface_temp,
            "surface_salinity": surface_sal,
            "air_temperature": raw.get("air_temperature"),
            "surface_pressure_hpa": raw.get("surface_pressure_hpa"),
            "wind_speed_ms": raw.get("wind_speed_ms"),
            "wind_direction_deg": raw.get("wind_direction_deg"),
            "significant_wave_height_m": raw.get("significant_wave_height_m"),
            "metadata": metadata,
            "source_mode": source_mode,
            "provenance_badge": provenance_badge,
            "provenance_note": provenance_note,
            "provider": provider
        }

    def load_observations(self):
        """Loads and normalizes observation files (Argo floats, gliders, and INCOIS buoys)."""
        self.synthetic_profiles = []
        self.real_profiles = []
        self._profiles_by_id = {}

        self.synthetic_gliders = []
        self.real_gliders = []
        self._gliders_by_id = {}

        self.buoy_stations = []
        self._buoys_by_id = {}
        seen_ids = set()

        # 1. Load primary synthetic dataset (4 profiles for backward compatibility)
        if self.argo_path.exists():
            with open(self.argo_path, "r", encoding="utf-8") as f:
                raw_list = json.load(f)
                for item in raw_list:
                    pid = item.get("id")
                    if pid in seen_ids:
                        continue
                    norm = self.normalize_profile(item, default_source_mode="SYNTHETIC")
                    if norm:
                        self.synthetic_profiles.append(norm)
                        self._profiles_by_id[norm["id"]] = norm
                        seen_ids.add(norm["id"])

        # 2. Load documented real local argo sample if available
        if self.real_sample_path.exists():
            with open(self.real_sample_path, "r", encoding="utf-8") as f:
                item = json.load(f)
                pid = item.get("id")
                if pid not in seen_ids:
                    norm = self.normalize_profile(item, default_source_mode="REAL_LOCAL")
                    if norm:
                        self.real_profiles.append(norm)
                        self._profiles_by_id[norm["id"]] = norm
                        seen_ids.add(norm["id"])

        # 2b. Scan real Argo files in configured SAMUDRA_DATA_ROOT/raw/argo
        try:
            raw_root = self._raw_data_dir if self._raw_data_dir is not None else settings.RAW_DATA_DIR
            if raw_root:
                argo_dir = raw_root / "argo"
                if not argo_dir.exists() and (raw_root / "argos").exists():
                    argo_dir = raw_root / "argos"
                argo_real = scan_argo_directory(argo_dir)
                for item in argo_real:
                    pid = item.get("id")
                    if pid in seen_ids:
                        continue
                    norm = self.normalize_profile(item, default_source_mode="REAL_LOCAL")
                    if norm:
                        self.real_profiles.append(norm)
                        self._profiles_by_id[norm["id"]] = norm
                        seen_ids.add(norm["id"])
        except Exception:
            pass

        # 3. Load synthetic glider transects
        if self.glider_path.exists():
            with open(self.glider_path, "r", encoding="utf-8") as f:
                raw_gliders = json.load(f)
                for item in raw_gliders:
                    norm = self.normalize_glider_transect(item, default_source_mode="SYNTHETIC")
                    if norm:
                        self.synthetic_gliders.append(norm)
                        self._gliders_by_id[norm["id"]] = norm
                        self._profiles_by_id[norm["id"]] = norm

        # 4. Load documented real local glider sample
        if self.real_glider_path.exists():
            with open(self.real_glider_path, "r", encoding="utf-8") as f:
                item = json.load(f)
                norm = self.normalize_glider_transect(item, default_source_mode="REAL_LOCAL")
                if norm:
                    self.real_gliders.append(norm)
                    self._gliders_by_id[norm["id"]] = norm
                    self._profiles_by_id[norm["id"]] = norm

        # 5b. Scan real Glider files in configured SAMUDRA_DATA_ROOT/raw/glider
        try:
            raw_root = self._raw_data_dir if self._raw_data_dir is not None else settings.RAW_DATA_DIR
            if raw_root:
                glider_dir = raw_root / "glider"
                if not glider_dir.exists() and (raw_root / "gliders").exists():
                    glider_dir = raw_root / "gliders"
                glider_real = scan_glider_directory(glider_dir)
                for item in glider_real:
                    norm = self.normalize_glider_transect(item, default_source_mode="REAL_LOCAL")
                    if norm:
                        self.real_gliders.append(norm)
                        self._gliders_by_id[norm["id"]] = norm
                        self._profiles_by_id[norm["id"]] = norm
        except Exception:
            pass

        # 6. INCOIS OMNI buoys – loads INCOIS buoy reference records + REAL_LOCAL files.
        try:
            from backend.app.data.incois_ingest import scan_incois_directory
            raw_root = self._raw_data_dir if self._raw_data_dir is not None else settings.RAW_DATA_DIR
            incois_dir = (raw_root / "incois") if raw_root else None
            incois = scan_incois_directory(incois_dir)
            for item in incois:
                pid = item.get("id")
                norm = self.normalize_buoy(item, default_source_mode=item.get("source_mode", "BUNDLED_REFERENCE"))
                if norm:
                    self.buoy_stations.append(norm)
                    self._buoys_by_id[norm["id"]] = norm
                    if pid not in seen_ids:
                        if norm.get("source_mode") == "REAL_LOCAL":
                            self.real_profiles.append(norm)
                        self._profiles_by_id[norm["id"]] = norm
                        seen_ids.add(norm["id"])
        except Exception:
            pass

    def load_custom_sensors(self):
        """Loads user-registered in-situ sensors from SQLite database."""
        self.custom_profiles = []
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM custom_sensors WHERE is_active = 1")
            rows = cursor.fetchall()
            conn.close()

            import json
            for r in rows:
                depths = json.loads(r["depths"]) if r["depths"] else []
                temps = json.loads(r["temperature"]) if r["temperature"] else []
                sals = json.loads(r["salinity"]) if r["salinity"] else []
                has_obs = len(depths) > 0 and len(temps) > 0
                qc_flags = [1] * len(depths) if has_obs else []
                qc_sum = self.compute_qc_summary(qc_flags) if has_obs else None

                prof = {
                    "id": r["id"],
                    "platform_type": r["platform_type"],
                    "name": r["name"],
                    "wmo_id": r["wmo_id"],
                    "lat": float(r["lat"]),
                    "lon": float(r["lon"]),
                    "timestamp": r["created_at"],
                    "depths": depths,
                    "temperature": temps,
                    "salinity": sals,
                    "has_observations": has_obs,
                    "qc_flags": qc_flags,
                    "qc_summary": qc_sum.model_dump() if qc_sum else None,
                    "max_depth": float(r["max_depth"] or (max(depths) if depths else 0.0)),
                    "num_levels": len(depths),
                    "surface_temp": float(r["surface_temp"]) if r["surface_temp"] is not None else (temps[0] if temps else None),
                    "surface_salinity": float(r["surface_salinity"]) if r["surface_salinity"] is not None else (sals[0] if sals else None),
                    "metadata": {
                        "agency": r["agency"] or "Ocean Observation Network",
                        "created_by": r["created_by"],
                        "source_mode": "USER_REGISTERED_SENSOR",
                        "status": "Awaiting Telemetry Feed" if not has_obs else "Observations Active"
                    },
                    "source_mode": "USER_REGISTERED_SENSOR"
                }
                self.custom_profiles.append(prof)
                self._profiles_by_id[prof["id"]] = prof
        except Exception:
            pass

    def register_sensor(self, req: SensorRegistrationRequest) -> Dict[str, Any]:
        """Registers a new in-situ ocean sensor into SQLite without fabricating data."""
        if not self.is_in_domain(req.lat, req.lon):
            raise ValueError(f"Sensor coordinates ({req.lat}, {req.lon}) are outside Indian Ocean domain.")

        import json
        sensor_id = f"SENSOR-{uuid.uuid4().hex[:8].upper()}"
        now_iso = datetime.now(timezone.utc).isoformat()

        depths = req.depths or []
        temps = req.temperature or []
        sals = req.salinity or []
        has_obs = len(depths) > 0 and len(temps) > 0

        qc_flags = [1] * len(depths) if has_obs else []
        qc_sum = self.compute_qc_summary(qc_flags) if has_obs else None

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO custom_sensors (
                id, platform_type, name, wmo_id, lat, lon, depths,
                temperature, salinity, surface_temp, surface_salinity,
                max_depth, agency, created_by, created_at, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        """, (
            sensor_id,
            req.platform_type,
            req.name,
            req.wmo_id or sensor_id.replace("SENSOR-", ""),
            req.lat,
            req.lon,
            json.dumps(depths),
            json.dumps(temps),
            json.dumps(sals),
            float(req.surface_temp) if req.surface_temp is not None else (temps[0] if temps else None),
            float(req.surface_salinity) if req.surface_salinity is not None else (sals[0] if sals else None),
            float(req.max_depth or (max(depths) if depths else 0.0)),
            req.agency or "Ocean Observation Network",
            req.created_by or "Administrator",
            now_iso
        ))
        conn.commit()
        conn.close()

        prof = {
            "id": sensor_id,
            "platform_type": req.platform_type,
            "name": req.name,
            "wmo_id": req.wmo_id or sensor_id.replace("SENSOR-", ""),
            "lat": float(req.lat),
            "lon": float(req.lon),
            "timestamp": now_iso,
            "depths": depths,
            "temperature": temps,
            "salinity": sals,
            "has_observations": has_obs,
            "qc_flags": qc_flags,
            "qc_summary": qc_sum.model_dump() if qc_sum else None,
            "max_depth": float(req.max_depth or (max(depths) if depths else 0.0)),
            "num_levels": len(depths),
            "surface_temp": float(req.surface_temp) if req.surface_temp is not None else (temps[0] if temps else None),
            "surface_salinity": float(req.surface_salinity) if req.surface_salinity is not None else (sals[0] if sals else None),
            "metadata": {
                "agency": req.agency or "Ocean Observation Network",
                "created_by": req.created_by or "Administrator",
                "source_mode": "USER_REGISTERED_SENSOR",
                "status": "Awaiting Telemetry Feed" if not has_obs else "Observations Active"
            },
            "source_mode": "USER_REGISTERED_SENSOR"
        }

        self.custom_profiles.append(prof)
        self._profiles_by_id[sensor_id] = prof
        return prof

    def delete_sensor(self, sensor_id: str) -> bool:
        """Deletes a custom registered sensor from SQLite and in-memory cache."""
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM custom_sensors WHERE id = ?", (sensor_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()

        self.custom_profiles = [p for p in self.custom_profiles if p["id"] != sensor_id]
        if sensor_id in self._profiles_by_id:
            del self._profiles_by_id[sensor_id]
        return deleted

    def get_custom_sensors(self) -> List[Dict[str, Any]]:
        """Returns all user-registered custom sensors."""
        return list(self.custom_profiles)

    def get_all_profiles(
        self,
        platform_type: Optional[str] = None,
        qc_filter: bool = False,
        source_mode: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Returns normalized profiles.
        Default (source_mode is None or 'SYNTHETIC') preserves exactly the 4 primary profiles.
        If source_mode='REAL_LOCAL', returns real profiles.
        If source_mode='ALL', returns union.
        """
        if source_mode == "REAL_LOCAL":
            res = list(self.real_profiles)
        elif source_mode == "CUSTOM":
            res = list(self.custom_profiles)
        elif source_mode == "ALL":
            res = list(self.synthetic_profiles) + list(self.real_profiles) + list(self.custom_profiles)
        else:
            res = list(self.synthetic_profiles)

        if platform_type:
            res = [p for p in res if p.get("platform_type") == platform_type]
        if qc_filter:
            res = [p for p in res if p.get("qc_summary", {}).get("pass_rate_pct", 100) >= 90.0]
        return res

    def get_argo_profiles(
        self,
        qc_filter: bool = False,
        source_mode: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Returns active Argo floats with coordinate positions, metadata, and quality summaries."""
        return self.get_all_profiles(platform_type="argo", qc_filter=qc_filter, source_mode=source_mode)

    def get_glider_transects(
        self,
        qc_filter: bool = False,
        source_mode: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Returns underwater glider mission transects with summary metrics."""
        if source_mode == "REAL_LOCAL":
            gliders = list(self.real_gliders)
        elif source_mode == "ALL":
            gliders = list(self.synthetic_gliders) + list(self.real_gliders)
        else:
            gliders = list(self.synthetic_gliders)

        if qc_filter:
            gliders = [g for g in gliders if g.get("qc_summary", {}).get("pass_rate_pct", 100) >= 90.0]
        return gliders

    def get_glider_by_id(self, glider_id: str) -> Optional[Dict[str, Any]]:
        """Returns single glider transect detail by identifier."""
        return self._gliders_by_id.get(glider_id)

    def get_buoy_stations(
        self,
        qc_filter: bool = False,
        source_mode: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Returns supported INCOIS moored ocean buoy stations with latest observations."""
        if source_mode == "SYNTHETIC":
            return []

        buoys = list(self.buoy_stations)
        if source_mode and source_mode != "ALL":
            buoys = [b for b in buoys if b.get("source_mode") == source_mode]
        if qc_filter:
            buoys = [
                b for b in buoys
                if b.get("qc_summary") is not None
                and b.get("qc_summary", {}).get("pass_rate_pct", 0) >= 90.0
            ]
        return buoys

    def get_buoy_by_id(self, buoy_id: str) -> Optional[Dict[str, Any]]:
        """Returns single buoy station details and depth series by identifier."""
        if not buoy_id:
            return None
        if buoy_id in self._buoys_by_id:
            return self._buoys_by_id[buoy_id]

        bid_clean = buoy_id.strip()
        bid_upper = bid_clean.upper()

        for b in self._buoys_by_id.values():
            if (b.get("id") or "").upper() == bid_upper:
                return b
            wmo = (b.get("wmo_id") or "").upper()
            if wmo and (wmo == bid_upper or f"INCOIS_BUOY_{wmo}" == bid_upper or f"BUOY_{wmo}" == bid_upper):
                return b
        return None

    def get_profile_by_id(self, profile_id: str) -> Optional[Dict[str, Any]]:
        """Returns single profile or glider by identifier (supports exact ID, case-insensitive, and WMO ID)."""
        if not profile_id:
            return None
        if profile_id in self._profiles_by_id:
            return self._profiles_by_id[profile_id]

        pid_clean = profile_id.strip()
        pid_upper = pid_clean.upper()

        # 1. Exact case-insensitive match on profile ID
        for p in self._profiles_by_id.values():
            if (p.get("id") or "").upper() == pid_upper:
                return p

        # 2. Match on WMO ID (e.g. '2902145' or 'ARGO_2902145')
        digits_only = pid_upper[5:] if pid_upper.startswith("ARGO_") else pid_upper
        for p in self._profiles_by_id.values():
            if p.get("platform_type") != "argo":
                continue
            wmo = (p.get("wmo_id") or p.get("metadata", {}).get("wmo_id") or "").upper()
            if wmo:
                if wmo == pid_upper or wmo == digits_only or f"ARGO_{wmo}" == pid_upper:
                    return p
        return None

    def get_status(self) -> InsituStatusResponse:
        """Returns operational telemetry, ingestion summary, and ERDDAP integration status."""
        all_profs = self.synthetic_profiles + self.real_profiles
        argo_count = sum(1 for p in all_profs if p.get("platform_type") == "argo")
        
        all_gliders = self.synthetic_gliders + self.real_gliders
        glider_count = len(all_gliders)
        buoy_count = len(self.buoy_stations)
        synthetic_count = len(self.synthetic_profiles)
        real_count = len(self.real_profiles)

        return InsituStatusResponse(
            status="operational",
            total_profiles=len(all_profs),
            argo_count=argo_count,
            glider_count=glider_count,
            buoy_count=buoy_count,
            synthetic_count=synthetic_count,
            real_sample_count=real_count,
            erddap_live_feed="OFFLINE_INTEGRATION_GAP",
            data_centre="INCOIS-DAC",
            timestamp=datetime.now(timezone.utc).isoformat()
        )

insitu_service = InsituDataService()
