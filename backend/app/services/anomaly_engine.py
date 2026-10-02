"""
SAMUDRA-3D 3D Difference Field & Anomaly Engine

Aggregates collocation residuals (delta = MODEL - OBSERVED) from all
available in-situ platforms into a sparse residual field.

Scientific policy:
- Only measured observation locations are represented. No spatial interpolation
  or extrapolation beyond source collocation (support radius ~55 km / 0.5 deg).
- Bad WMO QC flags (3, 4) are excluded before anomaly computation.
- Alerts are labelled "Model-observation discrepancy" — never "hazard" or "prediction".
- Metrics: Bias, MAE, RMSE, alert counts, and valid pair counts.
"""
from typing import List, Tuple, Optional, Dict, Any
from datetime import datetime, timezone
import math
import time

from backend.app.services.collocation import collocation_engine
from backend.app.services.insitu_service import insitu_service
from backend.app.schemas.anomaly import (
    AnomalyPoint,
    CoverageBin,
    AnomalyFieldResponse,
    AnomalySummaryResponse,
)

# Default thresholds (handbook p. 11 mentions configurable residuals)
DEFAULT_TEMP_THRESHOLD = 0.5   # degC
DEFAULT_SAL_THRESHOLD = 0.1    # PSU

# Coverage bin resolution (degrees)
BIN_RESOLUTION = 0.5
SUPPORT_RADIUS_KM = 55.0


def _compute_aggregate_metrics(
    deltas: List[float],
) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """Computes Bias, MAE, RMSE over a list of delta = MODEL - OBSERVED values."""
    n = len(deltas)
    if n == 0:
        return None, None, None
    bias = sum(deltas) / n
    mae = sum(abs(d) for d in deltas) / n
    rmse = math.sqrt(sum(d ** 2 for d in deltas) / n)
    return round(bias, 4), round(mae, 4), round(rmse, 4)


def _bin_key(lat: float, lon: float) -> Tuple[float, float]:
    """Maps a (lat, lon) coordinate to the nearest 0.5-degree bin centre."""
    lat_c = round(math.floor(lat / BIN_RESOLUTION) * BIN_RESOLUTION + BIN_RESOLUTION / 2, 2)
    lon_c = round(math.floor(lon / BIN_RESOLUTION) * BIN_RESOLUTION + BIN_RESOLUTION / 2, 2)
    return (lat_c, lon_c)


class AnomalyEngine:
    """
    Aggregates all available in-situ collocations into a sparse 3D residual field.
    """
    def __init__(self):
        self._field_cache: Dict[Tuple[str, Optional[float], float, float, str, str], AnomalyFieldResponse] = {}
        self._summary_cache: Dict[Tuple[str, str], AnomalySummaryResponse] = {}

    def compute_field(
        self,
        variable: str = "temperature",
        threshold: Optional[float] = None,
        depth_min: float = 0.0,
        depth_max: float = 4000.0,
        source_mode: str = "ALL",
    ) -> AnomalyFieldResponse:
        """
        Builds a sparse anomaly field for the requested variable.
        Only QC-good levels within [depth_min, depth_max] are included.
        """
        t_start = time.perf_counter()

        if threshold is None:
            threshold = DEFAULT_TEMP_THRESHOLD if variable == "temperature" else DEFAULT_SAL_THRESHOLD

        cache_key = (variable, threshold, depth_min, depth_max, str(collocation_engine.ocean_svc.active_dataset_id), source_mode)
        if cache_key in self._field_cache:
            cached_resp = self._field_cache[cache_key]
            return cached_resp.model_copy(update={"latency_ms": round((time.perf_counter() - t_start) * 1000.0, 2)})

        unit = "degC" if variable == "temperature" else "PSU"
        points: List[AnomalyPoint] = []
        platform_ids_seen = set()

        # ── Argo Profiles ────────────────────────────────────────────────────
        all_profiles = insitu_service.get_all_profiles(source_mode=source_mode)
        for profile in all_profiles:
            pid = profile["id"]
            collocation = collocation_engine.collocate_profile(pid)
            if collocation is None:
                continue

            platform_ids_seen.add(pid)
            levels = (
                collocation.temperature_levels
                if variable == "temperature"
                else collocation.salinity_levels
            )

            for lvl in levels:
                if not lvl.valid:
                    continue
                if lvl.delta is None or lvl.model_value is None or lvl.observed_value is None:
                    continue
                if not (depth_min <= lvl.depth <= depth_max):
                    continue
                points.append(AnomalyPoint(
                    platform_id=pid,
                    platform_type=profile.get("platform_type", "argo").lower(),
                    lat=collocation.lat,
                    lon=collocation.lon,
                    depth=lvl.depth,
                    variable=variable,
                    delta=lvl.delta,
                    observed_value=lvl.observed_value,
                    model_value=lvl.model_value,
                    qc_flag=lvl.qc_flag,
                    is_alert=abs(lvl.delta) >= threshold,
                ))

        # ── Glider Transects ─────────────────────────────────────────────────
        all_gliders = insitu_service.get_glider_transects(source_mode=source_mode)
        for glider in all_gliders:
            gid = glider["id"]
            collocation = collocation_engine.collocate_glider(gid)
            if collocation is None:
                continue

            platform_ids_seen.add(gid)
            for wp in collocation.waypoints:
                if not wp.valid:
                    continue
                if not (depth_min <= wp.depth <= depth_max):
                    continue

                if variable == "temperature" and wp.delta_temp is not None and wp.model_temp is not None and wp.observed_temp is not None:
                    points.append(AnomalyPoint(
                        platform_id=gid,
                        platform_type="glider",
                        lat=wp.lat,
                        lon=wp.lon,
                        depth=wp.depth,
                        variable=variable,
                        delta=wp.delta_temp,
                        observed_value=wp.observed_temp,
                        model_value=wp.model_temp,
                        qc_flag=1,
                        is_alert=abs(wp.delta_temp) >= threshold,
                    ))
                elif variable == "salinity" and wp.delta_sal is not None and wp.model_sal is not None and wp.observed_sal is not None:
                    points.append(AnomalyPoint(
                        platform_id=gid,
                        platform_type="glider",
                        lat=wp.lat,
                        lon=wp.lon,
                        depth=wp.depth,
                        variable=variable,
                        delta=wp.delta_sal,
                        observed_value=wp.observed_sal,
                        model_value=wp.model_sal,
                        qc_flag=1,
                        is_alert=abs(wp.delta_sal) >= threshold,
                    ))

        # ── Aggregate Metrics ─────────────────────────────────────────────────
        alert_count = sum(1 for p in points if p.is_alert)
        all_deltas = [p.delta for p in points]
        bias, mae, rmse = _compute_aggregate_metrics(all_deltas)

        # ── Coverage Bins ─────────────────────────────────────────────────────
        bin_data: Dict[Tuple[float, float], List[float]] = {}
        for p in points:
            key = _bin_key(p.lat, p.lon)
            bin_data.setdefault(key, []).append(p.delta)

        coverage_bins: List[CoverageBin] = []
        for (lat_c, lon_c), deltas in bin_data.items():
            mean_d = round(sum(deltas) / len(deltas), 4) if deltas else None
            coverage_bins.append(CoverageBin(
                lat_center=lat_c,
                lon_center=lon_c,
                count=len(deltas),
                mean_delta=mean_d,
                has_data=True,
            ))

        latency = (time.perf_counter() - t_start) * 1000.0
        contributing_platform_ids = set(p.platform_id for p in points)

        active_ds = str(collocation_engine.ocean_svc.active_dataset_id)
        resp = AnomalyFieldResponse(
            variable=variable,
            unit=unit,
            threshold=threshold,
            depth_min=depth_min,
            depth_max=depth_max,
            dataset_id=active_ds,
            source_mode=source_mode,
            points=points,
            coverage_bins=coverage_bins,
            alert_count=alert_count,
            total_valid_pairs=len(points),
            platform_count=len(contributing_platform_ids),
            bias=bias,
            mae=mae,
            rmse=rmse,
            support_radius_km=SUPPORT_RADIUS_KM,
            latency_ms=round(latency, 2),
        )
        self._field_cache[cache_key] = resp
        return resp

    def compute_summary(self, source_mode: str = "ALL") -> AnomalySummaryResponse:
        """Returns cross-variable summary for both Temperature and Salinity."""
        cache_key = (str(collocation_engine.ocean_svc.active_dataset_id), source_mode)
        if cache_key in self._summary_cache:
            return self._summary_cache[cache_key]

        temp_field = self.compute_field("temperature", DEFAULT_TEMP_THRESHOLD, source_mode=source_mode)
        sal_field = self.compute_field("salinity", DEFAULT_SAL_THRESHOLD, source_mode=source_mode)
        platform_ids = set(p.platform_id for p in temp_field.points) | set(p.platform_id for p in sal_field.points)
        now = datetime.now(tz=timezone.utc).isoformat()
        res = AnomalySummaryResponse(
            temperature=temp_field,
            salinity=sal_field,
            platform_count=len(platform_ids),
            timestamp=now,
        )
        self._summary_cache[cache_key] = res
        return res


anomaly_engine = AnomalyEngine()
