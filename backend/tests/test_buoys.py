"""
SAMUDRA-3D Moored Buoy Observation Contract Test Suite
Verifies buoy station listing, detail retrieval, meteorological parameters,
provenance badges, QC summaries, and 404/empty error handling.
"""
import sys
from pathlib import Path

root_dir = Path(__file__).resolve().parents[2]
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.services.insitu_service import insitu_service, InsituDataService

client = TestClient(app)

def test_buoy_suite():
    print("=== SAMUDRA-3D Moored Buoy Observation Test Suite ===")

    # 1. In-situ status reporting buoy counts
    r_stat = client.get("/api/insitu/status")
    assert r_stat.status_code == 200
    stat = r_stat.json()
    assert stat["buoy_count"] >= 5
    print(f"[OK] Buoy count verified in /api/insitu/status: {stat['buoy_count']} buoys")

    # 2. Browse supported buoy stations (Default / REAL_LOCAL)
    r_buoys = client.get("/api/insitu/buoys")
    assert r_buoys.status_code == 200
    buoys = r_buoys.json()
    assert len(buoys) >= 5
    buoy_ids = [b["id"] for b in buoys]
    assert "INCOIS_BUOY_BD08" in buoy_ids
    assert "INCOIS_BUOY_AD01" in buoy_ids
    assert "INCOIS_BUOY_CB02" in buoy_ids

    # Verify summary fields and provenance
    bd08_sum = next(b for b in buoys if b["id"] == "INCOIS_BUOY_BD08")
    assert bd08_sum["platform_type"] == "buoy"
    assert bd08_sum["wmo_id"] == "23008"
    assert abs(bd08_sum["lat"] - 18.15) < 1e-3
    assert abs(bd08_sum["lon"] - 89.67) < 1e-3
    assert bd08_sum["source_mode"] == "REAL_LOCAL"
    assert bd08_sum["provenance_badge"] == "[REAL • INCOIS]"
    assert bd08_sum["provider"] == "INCOIS"
    assert bd08_sum["max_depth"] == 500.0
    assert bd08_sum["air_temperature"] == 29.2
    assert bd08_sum["surface_pressure_hpa"] == 1008.4
    assert bd08_sum["wind_speed_ms"] == 6.8
    assert bd08_sum["significant_wave_height_m"] == 1.4
    assert bd08_sum["qc_summary"]["pass_rate_pct"] == 100.0
    print("[OK] INCOIS_BUOY_BD08 summary verified (Bay of Bengal OMNI Buoy with meteorological readings)")

    # 3. Inspect single buoy station detail
    r_detail = client.get("/api/insitu/buoys/INCOIS_BUOY_BD08")
    assert r_detail.status_code == 200
    detail = r_detail.json()
    assert detail["id"] == "INCOIS_BUOY_BD08"
    assert len(detail["depths"]) == 11
    assert len(detail["temperature"]) == 11
    assert len(detail["salinity"]) == 11
    assert detail["depths"][0] == 0.5
    assert detail["depths"][-1] == 500.0
    assert detail["temperature"][0] == 28.9
    assert detail["salinity"][0] == 32.1
    assert detail["source_mode"] == "REAL_LOCAL"
    assert detail["provenance_badge"] == "[REAL • INCOIS]"
    print("[OK] INCOIS_BUOY_BD08 detail verified (11 thermistor depths, CTD series, metadata)")

    # Test WMO ID alias lookup
    r_wmo_detail = client.get("/api/insitu/buoys/23008")
    assert r_wmo_detail.status_code == 200
    assert r_wmo_detail.json()["id"] == "INCOIS_BUOY_BD08"
    print("[OK] Buoy WMO ID lookup (/api/insitu/buoys/23008) resolved to INCOIS_BUOY_BD08")

    # 4. Unknown Buoy ID returns HTTP 404
    r_not_found = client.get("/api/insitu/buoys/NONEXISTENT_BUOY_999")
    assert r_not_found.status_code == 404
    assert "not found" in r_not_found.json()["detail"].lower()
    print("[OK] Unknown buoy ID returns HTTP 404")

    # Argo float ID queried on buoy endpoint returns HTTP 404
    r_wrong_type = client.get("/api/insitu/buoys/ARGO_2902145")
    assert r_wrong_type.status_code == 404
    print("[OK] Non-buoy platform ID queried on /api/insitu/buoys/{id} returns HTTP 404")

    # 5. Provenance & Source Mode Filtering
    r_synth = client.get("/api/insitu/buoys?source_mode=SYNTHETIC")
    assert r_synth.status_code == 200
    assert len(r_synth.json()) == 0
    print("[OK] source_mode=SYNTHETIC returns 0 buoys (all supported buoys are real local records)")

    r_real = client.get("/api/insitu/buoys?source_mode=REAL_LOCAL")
    assert r_real.status_code == 200
    assert len(r_real.json()) >= 5
    print("[OK] source_mode=REAL_LOCAL returns supported INCOIS buoys")

    # 6. Missing measurements handling (station without meteorological or deep observations)
    missing_station = {
        "id": "INCOIS_BUOY_TEST_MINIMAL",
        "platform_type": "buoy",
        "name": "INCOIS Test Surface Buoy (No Met Feed)",
        "wmo_id": "23999",
        "lat": 10.0,
        "lon": 75.0,
        "depths": [0.5],
        "temperature": [28.0],
        "salinity": [],
        "qc_flags": [1],
        "air_temperature": None,
        "surface_pressure_hpa": None,
        "wind_speed_ms": None,
        "wind_direction_deg": None,
        "significant_wave_height_m": None
    }
    normalized = insitu_service.normalize_buoy(missing_station)
    assert normalized is not None
    assert normalized["air_temperature"] is None
    assert normalized["surface_pressure_hpa"] is None
    assert normalized["wind_speed_ms"] is None
    assert normalized["wind_direction_deg"] is None
    assert normalized["significant_wave_height_m"] is None
    assert normalized["salinity"] == []
    print("[OK] Missing measurements (None/empty) preserved cleanly without fabricating fake values")

    print("\nALL MOORED BUOY OBSERVATION TESTS PASSED (100%)")

if __name__ == "__main__":
    test_buoy_suite()
