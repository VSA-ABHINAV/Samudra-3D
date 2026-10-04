"""
SAMUDRA-3D In-situ Observation Test Suite
"""
import sys
from pathlib import Path

root_dir = Path(__file__).resolve().parents[2]
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.services.insitu_service import insitu_service, PRESSURE_TO_DEPTH_FACTOR

client = TestClient(app)

def test_insitu_suite():
    print("=== SAMUDRA-3D In-situ Argo Test Suite ===")

    # 1. Health and System Status
    r_stat = client.get("/api/insitu/status")
    assert r_stat.status_code == 200
    stat = r_stat.json()
    assert stat["status"] == "operational"
    assert stat["argo_count"] >= 3
    assert stat["synthetic_count"] == 4
    assert stat["real_sample_count"] >= 1
    assert "OFFLINE_INTEGRATION_GAP" in stat["erddap_live_feed"]
    print(f"[OK] In-situ status verified: {stat['total_profiles']} profiles ({stat['argo_count']} Argo, {stat['glider_count']} Glider)")

    # 2. General Profiles Endpoint & Filtering
    r_all = client.get("/api/insitu/profiles")
    assert r_all.status_code == 200
    all_profs = r_all.json()
    assert len(all_profs) == 4
    print("[OK] GET /api/insitu/profiles -> 4 default synthetic profiles")

    # Platform type filter
    r_argo_only = client.get("/api/insitu/profiles?platform_type=argo")
    assert r_argo_only.status_code == 200
    argo_only = r_argo_only.json()
    assert len(argo_only) == 3
    assert all(p["platform_type"] == "argo" for p in argo_only)
    assert not any(p["id"] == "GLIDER_INCOIS_04" for p in argo_only)
    print("[OK] Platform type filter (?platform_type=argo) verified")

    # QC Filter (excludes outlier profile with bad QC flags)
    r_qc_clean = client.get("/api/insitu/profiles?qc_filter=true")
    assert r_qc_clean.status_code == 200
    qc_clean = r_qc_clean.json()
    assert not any(p["id"] == "ARGO_TEST_QC_OUTLIER" for p in qc_clean)
    assert any(p["id"] == "ARGO_2902145" for p in qc_clean)
    print("[OK] QC filter (?qc_filter=true) excluded outlier profile")

    # Real local sample query
    r_real = client.get("/api/insitu/profiles?source_mode=REAL_LOCAL")
    assert r_real.status_code == 200
    real_list = r_real.json()
    assert len(real_list) >= 1
    ids = [p["id"] for p in real_list]
    assert "ARGO_2902210_REAL" in ids
    assert all(p["source_mode"] == "REAL_LOCAL" for p in real_list)
    print("[OK] Real local sample retrieval verified")

    # 3. Argo Summaries Endpoint
    r_argo = client.get("/api/insitu/argo")
    assert r_argo.status_code == 200
    argo_summaries = r_argo.json()
    assert len(argo_summaries) == 3
    bob = next(p for p in argo_summaries if p["id"] == "ARGO_2902145")
    assert bob["wmo_id"] == "2902145"
    assert abs(bob["lat"] - 12.48) < 1e-3
    assert abs(bob["lon"] - 82.03) < 1e-3
    assert bob["max_depth"] == 2000.0
    assert bob["surface_temp"] == 29.1
    assert bob["qc_summary"]["pass_rate_pct"] == 100.0
    print("[OK] Bay of Bengal Argo Float 2902145 summary verified (12.48°N, 82.03°E)")

    as_float = next(p for p in argo_summaries if p["id"] == "ARGO_2902198")
    assert as_float["wmo_id"] == "2902198"
    assert abs(as_float["lat"] - 16.52) < 1e-3
    assert abs(as_float["lon"] - 71.85) < 1e-3
    print("[OK] Arabian Sea Argo Float 2902198 summary verified (16.52°N, 71.85°E)")

    # 4. Argo Detail by ID Endpoint
    r_detail = client.get("/api/insitu/argo/ARGO_2902145")
    assert r_detail.status_code == 200
    detail = r_detail.json()
    assert detail["id"] == "ARGO_2902145"
    assert len(detail["depths"]) == 14
    assert len(detail["temperature"]) == 14
    assert len(detail["salinity"]) == 14
    assert len(detail["qc_flags"]) == 14
    assert detail["depths"][0] == 0.0
    assert detail["depths"][-1] == 2000.0
    assert detail["metadata"]["data_centre"] == "INCOIS-DAC"
    assert detail["source_mode"] == "SYNTHETIC"
    print("[OK] Detailed profile retrieval for ARGO_2902145 verified (14 vertical levels)")

    # Real sample detail with pressure-to-depth conversion
    r_real_detail = client.get("/api/insitu/argo/ARGO_2902210_REAL")
    assert r_real_detail.status_code == 200
    real_detail = r_real_detail.json()
    assert real_detail["id"] == "ARGO_2902210_REAL"
    assert real_detail["source_mode"] == "REAL_LOCAL"
    # First pressure is 5.0 dbar -> 5.0 * 0.992 = 4.96m
    assert abs(real_detail["depths"][0] - round(5.0 * PRESSURE_TO_DEPTH_FACTOR, 2)) < 1e-2
    assert real_detail["metadata"]["float_type"] == "APEX"
    assert "Indian National Centre for Ocean Information Services" in real_detail["metadata"]["attribution"]
    print("[OK] Pressure-to-depth conversion and real source metadata verified for ARGO_2902210_REAL")

    # 404 Error handling
    r_not_found = client.get("/api/insitu/argo/UNKNOWN_FLOAT_999999")
    assert r_not_found.status_code == 404
    assert "not found" in r_not_found.json()["detail"].lower()
    print("[OK] Error check: Unknown float ID returns HTTP 404")

    # 5. Service-level Unit Tests: Out-of-Domain & Pressure Math
    assert insitu_service.is_in_domain(12.0, 80.0) is True
    assert insitu_service.is_in_domain(45.0, 80.0) is False  # North of 30°N
    assert insitu_service.is_in_domain(-40.0, 80.0) is False # South of 30°S
    assert insitu_service.is_in_domain(10.0, 10.0) is False  # West of 30°E
    assert insitu_service.is_in_domain(10.0, 130.0) is False # East of 120°E
    print("[OK] Domain bounding validation verified (30°S to 30°N, 30°E to 120°E)")

    print("\nALL IN-SITU ACCEPTANCE TESTS PASSED (100%)")

if __name__ == "__main__":
    test_insitu_suite()
