"""
SAMUDRA-3D Moored Buoy Observation Contract Test Suite
Verifies bundled reference buoys, real local file buoys, absence of fabricated timestamps/QC,
provenance badges, meteorological parameters, and 404/empty error handling.
"""
import sys
import tempfile
import json
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

    # 2. Browse supported buoy stations (Default)
    r_buoys = client.get("/api/insitu/buoys")
    assert r_buoys.status_code == 200
    buoys = r_buoys.json()
    assert len(buoys) >= 5
    buoy_ids = [b["id"] for b in buoys]
    assert "INCOIS_BUOY_BD08" in buoy_ids
    assert "INCOIS_BUOY_AD01" in buoy_ids
    assert "INCOIS_BUOY_CB02" in buoy_ids

    # Verify bundled reference fields: no timestamp fabrication, no QC fabrication
    bd08_sum = next(b for b in buoys if b["id"] == "INCOIS_BUOY_BD08")
    assert bd08_sum["platform_type"] == "buoy"
    assert bd08_sum["wmo_id"] == "23008"
    assert abs(bd08_sum["lat"] - 18.15) < 1e-3
    assert abs(bd08_sum["lon"] - 89.67) < 1e-3
    assert bd08_sum["source_mode"] == "BUNDLED_REFERENCE"
    assert bd08_sum["provenance_badge"] == "[REFERENCE • BUNDLED]"
    assert bd08_sum["provenance_note"] == "Bundled reference sample · illustrative, not live"
    assert bd08_sum["provider"] == "INCOIS"
    assert bd08_sum["max_depth"] == 500.0
    assert bd08_sum["air_temperature"] == 29.2
    assert bd08_sum["surface_pressure_hpa"] == 1008.4
    assert bd08_sum["wind_speed_ms"] == 6.8
    assert bd08_sum["significant_wave_height_m"] == 1.4
    assert bd08_sum["timestamp"] is None, "Bundled reference buoy must not fabricate observation timestamp"
    assert bd08_sum["qc_summary"] is None, "Bundled reference buoy must not manufacture all-good QC summary"
    print("[OK] INCOIS_BUOY_BD08 bundled reference summary verified (honest None timestamp & QC)")

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
    assert detail["source_mode"] == "BUNDLED_REFERENCE"
    assert detail["provenance_badge"] == "[REFERENCE • BUNDLED]"
    assert detail["provenance_note"] == "Bundled reference sample · illustrative, not live"
    assert detail["timestamp"] is None
    assert detail["qc_flags"] is None
    assert detail["qc_summary"] is None
    print("[OK] INCOIS_BUOY_BD08 detail verified (11 thermistor depths, CTD series, reference metadata)")

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
    print("[OK] source_mode=SYNTHETIC returns 0 buoys")

    r_bundled = client.get("/api/insitu/buoys?source_mode=BUNDLED_REFERENCE")
    assert r_bundled.status_code == 200
    assert len(r_bundled.json()) >= 5
    print("[OK] source_mode=BUNDLED_REFERENCE returns bundled reference buoys")

    r_all = client.get("/api/insitu/buoys?source_mode=ALL")
    assert r_all.status_code == 200
    assert len(r_all.json()) >= 5
    print("[OK] source_mode=ALL returns all buoys")

    # 6. Genuinely local-file buoy station ingestion test
    with tempfile.TemporaryDirectory() as tmpdir:
        raw_root = Path(tmpdir)
        incois_dir = raw_root / "incois"
        incois_dir.mkdir(parents=True)

        local_buoy_record = {
            "id": "INCOIS_BUOY_LOCAL_BD12",
            "platform_type": "buoy",
            "name": "INCOIS Local File Buoy BD12",
            "wmo_id": "23012",
            "lat": 15.5,
            "lon": 88.2,
            "timestamp": "2026-09-15T06:00:00Z",
            "depths": [0.5, 10.0, 50.0],
            "temperature": [28.5, 27.8, 25.0],
            "salinity": [33.2, 33.5, 34.1],
            "qc_flags": [1, 1, 2],
            "air_temperature": 28.9,
            "source_mode": "REAL_LOCAL",
            "provenance_badge": "[REAL • LOCAL_FILE]",
            "provenance_note": "Parsed from local file local_bd12.json"
        }
        with open(incois_dir / "local_bd12.json", "w", encoding="utf-8") as f:
            json.dump(local_buoy_record, f)

        service = InsituDataService(raw_data_dir=raw_root)
        local_found = service.get_buoy_by_id("INCOIS_BUOY_LOCAL_BD12")
        assert local_found is not None, "Local file buoy must be loaded"
        assert local_found["source_mode"] == "REAL_LOCAL"
        assert local_found["provenance_badge"] == "[REAL • LOCAL_FILE]"
        assert local_found["timestamp"] == "2026-09-15T06:00:00Z"
        assert local_found["qc_flags"] == [1, 1, 2]
        assert local_found["qc_summary"] is not None
        assert local_found["qc_summary"]["pass_rate_pct"] == 100.0
        assert local_found["provenance_note"] == "Parsed from local file local_bd12.json"

        # Verify real_local source mode filter returns it
        local_buoys = service.get_buoy_stations(source_mode="REAL_LOCAL")
        assert any(b["id"] == "INCOIS_BUOY_LOCAL_BD12" for b in local_buoys)
        print("[OK] Genuinely local-file buoy station verified with REAL_LOCAL provenance, timestamp, and QC")

    # 7. Missing measurements handling (station without meteorological or deep observations)
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
        "qc_flags": None,
        "air_temperature": None,
        "surface_pressure_hpa": None,
        "wind_speed_ms": None,
        "wind_direction_deg": None,
        "significant_wave_height_m": None
    }
    normalized = insitu_service.normalize_buoy(missing_station)
    assert normalized is not None
    assert normalized["timestamp"] is None
    assert normalized["qc_flags"] is None
    assert normalized["qc_summary"] is None
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
