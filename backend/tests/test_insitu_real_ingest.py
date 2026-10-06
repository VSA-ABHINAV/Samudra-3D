"""
Unit Tests for SAMUDRA-3D Multi-Platform Real In-situ Ingestion Pipeline
Verifies Argo GDAC, Glider missions, INCOIS moored buoys, satellite thermal front detection, and API source filtering.
"""
import unittest
from pathlib import Path
import numpy as np
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.insitu_service import insitu_service
from backend.app.services.ocean_service import ocean_service
from backend.app.data.registry import dataset_registry
from backend.app.data.incois_ingest import scan_incois_directory
from backend.app.data.argo_ingest import is_in_indian_ocean, sanitize_val, scan_argo_directory
from backend.app.data.glider_ingest import scan_glider_directory
from backend.app.data.satellite_ingest import satellite_manager

client = TestClient(app)


class TestInsituRealIngest(unittest.TestCase):

    def setUp(self):
        # Ensure GLORYS real dataset is active for high-resolution analysis
        if "cmems_mod_glo_phy_my_0.083deg_P1D-m" in dataset_registry._datasets:
            desc = dataset_registry.get_dataset("cmems_mod_glo_phy_my_0.083deg_P1D-m")
            if desc and desc.local_path and Path(desc.local_path).exists():
                ocean_service.set_active_dataset("cmems_mod_glo_phy_my_0.083deg_P1D-m")

    def tearDown(self):
        # Restore default synthetic model for other tests
        ocean_service.set_active_dataset("incois_roms_synthetic")

    def test_01_incois_moored_buoys_ingestion(self):
        """Tests that official INCOIS OMNI moored buoys are loaded with multi-depth thermistor profiles."""
        buoys = scan_incois_directory()
        self.assertGreaterEqual(len(buoys), 5, "Expected at least 5 reference INCOIS moored buoys")
        buoy_ids = [b["id"] for b in buoys]
        self.assertIn("INCOIS_BUOY_BD08", buoy_ids)
        self.assertIn("INCOIS_BUOY_AD01", buoy_ids)

        bd08 = next(b for b in buoys if b["id"] == "INCOIS_BUOY_BD08")
        self.assertEqual(bd08["lat"], 18.15)
        self.assertEqual(bd08["lon"], 89.67)
        self.assertEqual(bd08["metadata"]["provenance_badge"], "[REAL • INCOIS]")
        self.assertIn(500.0, bd08["depths"])
        self.assertEqual(len(bd08["depths"]), len(bd08["temperature"]))

    def test_02_argo_real_ingest_and_domain_filter(self):
        """Tests Argo utility functions: domain bounds checking and missing/fill-value sanitization."""
        # Domain bounds
        self.assertTrue(is_in_indian_ocean(12.5, 80.0))    # Bay of Bengal
        self.assertTrue(is_in_indian_ocean(15.0, 65.0))    # Arabian Sea
        self.assertFalse(is_in_indian_ocean(45.0, -30.0))  # North Atlantic
        self.assertFalse(is_in_indian_ocean(0.0, -140.0))  # Pacific

        # Sanitization
        self.assertIsNone(sanitize_val(None))
        self.assertIsNone(sanitize_val(99999.0))
        self.assertIsNone(sanitize_val(-999.0))
        self.assertEqual(sanitize_val(28.456), 28.456)

    def test_03_glider_ingest_and_waypoints(self):
        """Tests Glider ingestion returns continuous 3D dive/climb waypoints."""
        gliders = insitu_service.get_glider_transects(source_mode="REAL_LOCAL")
        self.assertGreaterEqual(len(gliders), 1, "Expected at least 1 real glider transect")
        g = gliders[0]
        self.assertEqual(g["platform_type"], "glider")
        self.assertGreaterEqual(g["total_waypoints"], 5)

    def test_04_satellite_thermal_fronts(self):
        """Tests spatial temperature gradient vector computation and thermal front extraction."""
        # 1. Test front extraction algorithm with calibrated thermal gradient
        lats = np.linspace(10.0, 15.0, 40)
        lons = np.linspace(80.0, 85.0, 40)
        lon_grid, _lat_grid = np.meshgrid(lons, lats)
        sst_grid = 28.0 - 4.0 / (1.0 + np.exp(-((lon_grid - 82.5) * 5.0)))
        fronts = satellite_manager.compute_thermal_fronts(sst_grid, lats, lons, threshold_deg_per_km=0.015)
        self.assertGreater(len(fronts), 0)
        front = fronts[0]
        self.assertIn("gradient_deg_c_per_km", front)
        self.assertIn("pfz_probability", front)
        self.assertGreaterEqual(front["gradient_deg_c_per_km"], 0.015)

        # 2. Test manager endpoint structure
        analysis = satellite_manager.get_surface_thermal_analysis(
            lat_min=0.0, lat_max=25.0, lon_min=50.0, lon_max=100.0
        )
        self.assertIn("fronts", analysis)
        self.assertIn("provenance_badge", analysis)

    def test_05_api_insitu_source_modes(self):
        """Tests /api/insitu/profiles with source_mode filtering: SYNTHETIC vs REAL_LOCAL vs ALL."""
        # 1. Default / SYNTHETIC: exactly 4 legacy synthetic profiles
        resp_synth = client.get("/api/insitu/profiles?source_mode=SYNTHETIC")
        self.assertEqual(resp_synth.status_code, 200)
        synth_profiles = resp_synth.json()
        self.assertEqual(len(synth_profiles), 4)

        # 2. REAL_LOCAL: real Argo and INCOIS buoys
        resp_real = client.get("/api/insitu/profiles?source_mode=REAL_LOCAL")
        self.assertEqual(resp_real.status_code, 200)
        real_profiles = resp_real.json()
        self.assertGreaterEqual(len(real_profiles), 6)
        real_ids = [p["id"] for p in real_profiles]
        self.assertIn("ARGO_2902210_REAL", real_ids)
        self.assertIn("INCOIS_BUOY_BD08", real_ids)

        # 3. ALL: union of synthetic, real, and custom sensors
        resp_all = client.get("/api/insitu/profiles?source_mode=ALL")
        self.assertEqual(resp_all.status_code, 200)
        all_profiles = resp_all.json()
        expected_count = len(synth_profiles) + len(real_profiles) + len(insitu_service.custom_profiles)
        self.assertEqual(len(all_profiles), expected_count)

    def test_06_configured_raw_data_dir_ingestion(self):
        """Tests that Argo and Glider files in configured raw_data_dir (both singular and plural conventions) are ingested."""
        import tempfile
        import json
        from backend.app.services.insitu_service import InsituDataService

        # 1. Test singular convention (argo/ and glider/)
        with tempfile.TemporaryDirectory() as tmpdir:
            raw_root = Path(tmpdir)
            argo_dir = raw_root / "argo"
            glider_dir = raw_root / "glider"
            argo_dir.mkdir(parents=True)
            glider_dir.mkdir(parents=True)

            raw_argo_data = {
                "id": "ARGO_TEST_RAW_999001",
                "platform_type": "argo",
                "lat": 12.5,
                "lon": 82.5,
                "timestamp": "2026-09-01T12:00:00Z",
                "depths": [0.0, 10.0, 50.0, 100.0],
                "temperature": [28.5, 28.2, 27.0, 24.5],
                "salinity": [34.5, 34.6, 34.8, 35.0],
                "qc_flags": [1, 1, 1, 1],
                "metadata": {"wmo_id": "999001", "source": "Raw GDAC Feed"}
            }
            with open(argo_dir / "argo_999001.json", "w", encoding="utf-8") as f:
                json.dump(raw_argo_data, f)

            raw_glider_data = {
                "id": "GLIDER_TEST_RAW_SG99",
                "platform_type": "glider",
                "mission_name": "Bay of Bengal Deep Transect",
                "lat": 13.0,
                "lon": 84.0,
                "timestamp": "2026-09-01T00:00:00Z",
                "waypoints": [
                    {"lat": 13.0, "lon": 84.0, "depth": 0.0, "temperature": 28.5, "salinity": 34.5, "qc_flag": 1},
                    {"lat": 13.2, "lon": 84.2, "depth": 500.0, "temperature": 15.0, "salinity": 35.0, "qc_flag": 1}
                ],
                "metadata": {"glider_model": "Seaglider"}
            }
            with open(glider_dir / "glider_sg99.json", "w", encoding="utf-8") as f:
                json.dump(raw_glider_data, f)

            service = InsituDataService(raw_data_dir=raw_root)
            argo_found = service.get_profile_by_id("ARGO_TEST_RAW_999001")
            self.assertIsNotNone(argo_found, "Raw Argo profile in configured raw_data_dir should be ingested")
            self.assertEqual(argo_found["source_mode"], "REAL_LOCAL")
            self.assertEqual(argo_found["wmo_id"], "999001")

            glider_found = service.get_glider_by_id("GLIDER_TEST_RAW_SG99")
            self.assertIsNotNone(glider_found, "Raw Glider in configured raw_data_dir should be ingested")
            self.assertEqual(glider_found["source_mode"], "REAL_LOCAL")

        # 2. Test plural directory convention (argos/ and gliders/)
        with tempfile.TemporaryDirectory() as tmpdir:
            raw_root = Path(tmpdir)
            (raw_root / "argos").mkdir(parents=True)
            (raw_root / "gliders").mkdir(parents=True)

            with open(raw_root / "argos" / "argo_999002.json", "w", encoding="utf-8") as f:
                json.dump({
                    "id": "ARGO_TEST_RAW_999002",
                    "lat": 15.0,
                    "lon": 72.0,
                    "depths": [0.0, 50.0],
                    "temperature": [29.0, 27.0],
                    "salinity": [35.5, 35.8],
                    "qc_flags": [1, 1]
                }, f)

            with open(raw_root / "gliders" / "glider_sg98.json", "w", encoding="utf-8") as f:
                json.dump({
                    "id": "GLIDER_TEST_RAW_SG98",
                    "lat": 16.0,
                    "lon": 71.0,
                    "waypoints": [{"lat": 16.0, "lon": 71.0, "depth": 0.0, "qc_flag": 1}]
                }, f)

            service_plural = InsituDataService(raw_data_dir=raw_root)
            self.assertIsNotNone(service_plural.get_profile_by_id("ARGO_TEST_RAW_999002"))
            self.assertIsNotNone(service_plural.get_glider_by_id("GLIDER_TEST_RAW_SG98"))

    def test_07_unset_raw_data_dir_no_fallback(self):
        """Tests that an unset/missing raw-data root is handled safely and does not perform package-relative fallback scans."""
        import tempfile
        from unittest.mock import patch
        from backend.app.services.insitu_service import InsituDataService
        from backend.app.core.config import settings

        with patch.object(settings, "RAW_DATA_DIR", None):
            service = InsituDataService(raw_data_dir=None)
            # Service should initialize safely without error
            self.assertGreater(len(service.synthetic_profiles), 0)
            self.assertGreater(len(service.real_profiles), 0)  # Contains baseline real_argo_sample & INCOIS buoys
            self.assertGreater(len(service.synthetic_gliders), 0)

            # Ensure no nonexistent IDs are present
            self.assertIsNone(service.get_profile_by_id("NONEXISTENT_FLOAT"))


if __name__ == "__main__":
    unittest.main()
