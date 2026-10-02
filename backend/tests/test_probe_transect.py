"""
SAMUDRA-3D Probe and Transect Scientific Acceptance Tests
"""
import sys
import unittest
from pathlib import Path

root_dir = Path(__file__).resolve().parents[2]
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

class TestProbeTransect(unittest.TestCase):
    def setUp(self):
        from backend.app.services.ocean_service import ocean_service
        ocean_service.set_active_dataset("incois_roms_synthetic")
    def test_ocean_probe_valid(self):
        """Tests vertical water column probe at Bay of Bengal coordinate."""
        r = client.get("/api/ocean/probe?lat=12.0&lon=82.0&time_idx=0")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(len(data["depths"]), 9)
        self.assertEqual(len(data["temperature"]), 9)
        self.assertEqual(len(data["salinity"]), 9)
        self.assertEqual(len(data["current_speed"]), 9)
        self.assertIsNotNone(data["sst"])
        self.assertIsNotNone(data["sss"])
        self.assertIsNotNone(data["mld"])
        self.assertIsNotNone(data["d20"])
        self.assertIsNotNone(data["tchp"])
        self.assertIn(data["tchp_category"], ["Low", "Moderate", "High", "Severe"])

        # Nearest observation within 200km should find ARGO_2902145
        self.assertIsNotNone(data["nearest_observation"])
        self.assertLess(data["nearest_observation"]["distance_km"], 200.0)
        self.assertEqual(data["nearest_observation"]["id"], "ARGO_2902145")

    def test_ocean_probe_real_platform_collocation(self):
        """Tests probe near real INCOIS Argo float (ARGO_2902210_REAL) in Andaman Sea."""
        r = client.get("/api/ocean/probe?lat=11.3&lon=88.5&time_idx=0")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIsNotNone(data["nearest_observation"])
        self.assertEqual(data["nearest_observation"]["id"], "ARGO_2902210_REAL")
        self.assertLess(data["nearest_observation"]["distance_km"], 50.0)

    def test_ocean_probe_out_of_bounds(self):
        """Tests coordinates outside Indian Ocean numerical model domain."""
        r = client.get("/api/ocean/probe?lat=45.0&lon=80.0&time_idx=0")
        self.assertEqual(r.status_code, 400)
        self.assertIn("domain bounds", r.json()["detail"].lower())

    def test_ocean_transect_valid(self):
        """Tests ODV vertical cross-section interpolation across 100 points with direct value comparison."""
        r = client.get("/api/ocean/transect?lat1=10.0&lon1=80.0&lat2=18.0&lon2=90.0&variable=temperature&time_idx=0")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["dataset_id"], "incois_roms_synthetic")
        self.assertEqual(data["variable"], "temperature")
        self.assertEqual(data["units"], "degC")
        self.assertEqual(data["time_idx"], 0)
        self.assertAlmostEqual(data["lat1"], 10.0, places=3)
        self.assertAlmostEqual(data["lon1"], 80.0, places=3)
        self.assertAlmostEqual(data["lat2"], 18.0, places=3)
        self.assertAlmostEqual(data["lon2"], 90.0, places=3)
        self.assertEqual(data["num_points"], 100)
        self.assertEqual(len(data["depth_levels"]), 9)
        self.assertEqual(len(data["matrix"]), 9)
        self.assertEqual(len(data["matrix"][0]), 100)
        self.assertEqual(len(data["distances_km"]), 100)
        self.assertIsNotNone(data["min_val"])
        self.assertIsNotNone(data["max_val"])
        self.assertEqual(len(data["mld_profile"]), 100)
        self.assertEqual(len(data["d20_profile"]), 100)
        self.assertEqual(len(data["tchp_profile"]), 100)

        # Directly compare start point against a direct probe at (10.0, 80.0)
        r_probe_start = client.get("/api/ocean/probe?lat=10.0&lon=80.0&time_idx=0")
        self.assertEqual(r_probe_start.status_code, 200)
        probe_start = r_probe_start.json()
        for k in range(len(data["depth_levels"])):
            t_transect = data["matrix"][k][0]
            t_probe = probe_start["temperature"][k]
            if t_transect is not None and t_probe is not None:
                self.assertAlmostEqual(t_transect, t_probe, delta=0.05)

        # Verify physical ocean stratification: surface is warmer than deep abyss
        surface_t = [v for v in data["matrix"][0] if v is not None]
        abyss_t = [v for v in data["matrix"][-1] if v is not None]
        self.assertTrue(len(surface_t) > 0)
        self.assertTrue(len(abyss_t) > 0)
        self.assertGreater(sum(surface_t) / len(surface_t), sum(abyss_t) / len(abyss_t))

    def test_ocean_transect_currents(self):
        """Tests currents vector magnitude cross-section."""
        r = client.get("/api/ocean/transect?lat1=8.0&lon1=75.0&lat2=12.0&lon2=78.0&variable=currents&time_idx=0")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["variable"], "currents")
        self.assertEqual(data["units"], "m/s")
        self.assertEqual(len(data["matrix"]), 9)
        self.assertEqual(len(data["matrix"][0]), 100)

    def test_ocean_transect_invalid_coords(self):
        """Tests invalid transect endpoints."""
        r = client.get("/api/ocean/transect?lat1=-10.0&lon1=80.0&lat2=18.0&lon2=90.0&variable=temperature")
        self.assertEqual(r.status_code, 400)

    def test_derived_metrics_robustness(self):
        """Tests calculate_derived_metrics handling None, NaN, and irregular arrays."""
        from backend.app.services.ocean_service import ocean_service
        # Partial None inputs (calculates gracefully from remaining valid levels)
        res_partial = ocean_service.calculate_derived_metrics([0, 10, 50], [None, 28.0, 26.0])
        self.assertEqual(res_partial["mld"], 20.0)

        # All None inputs
        res_none = ocean_service.calculate_derived_metrics([0, 10, 50], [None, None, None])
        self.assertIsNone(res_none["mld"])

        # All NaN / empty
        res_empty = ocean_service.calculate_derived_metrics([], [])
        self.assertIsNone(res_empty["mld"])

        # Normal valid profile
        z = [0, 10, 50, 100, 200, 500, 1000, 2000, 4000]
        t = [29.5, 29.2, 28.1, 24.0, 18.0, 10.0, 6.0, 3.0, 1.5]
        res_val = ocean_service.calculate_derived_metrics(z, t)
        self.assertIsNotNone(res_val["mld"])
        self.assertIsNotNone(res_val["d20"])
        self.assertIsNotNone(res_val["d26"])
        self.assertIsNotNone(res_val["tchp"])
        self.assertIn(res_val["tchp_category"], ["Low", "Moderate", "High", "Severe"])

if __name__ == "__main__":
    unittest.main()
