"""
SAMUDRA-3D Collocation Engine Test Suite
"""
import sys
import math
import time
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

root = Path(__file__).resolve().parents[2]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from backend.app.main import app
from backend.app.services.collocation import collocation_engine

class TestCollocationEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_01_collocation_health_and_affine_ground_truth(self):
        """Analytical affine field ground-truth trilinear verification."""
        res = self.client.get("/api/collocation/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "operational")
        self.assertTrue(data["affine_verification_passed"])

        affine = collocation_engine.run_affine_verification()
        self.assertTrue(affine["passed"])
        self.assertLess(affine["max_abs_error"], 1e-4)
        print(f"[OK] Analytical affine trilinear exactness verified (Max error: {affine['max_abs_error']:.6f})")

    def test_02_sign_convention_and_residual_metrics(self):
        """delta = MODEL - OBSERVED, under-prediction/over-prediction, bias, MAE, RMSE."""
        # Check delta = MODEL - OBSERVED
        # model=18.5, obs=19.1 -> delta = -0.6
        summary_neg = collocation_engine.compute_metrics([(18.5, 19.1)], "temperature", 1, 0.0, 0.0, "linear")
        self.assertAlmostEqual(summary_neg.bias, -0.6, places=3)
        self.assertEqual(summary_neg.prediction_tendency, "under-prediction")

        # reverse: model=19.1, obs=18.5 -> delta = +0.6
        summary_pos = collocation_engine.compute_metrics([(19.1, 18.5)], "temperature", 1, 0.0, 0.0, "linear")
        self.assertAlmostEqual(summary_pos.bias, +0.6, places=3)
        self.assertEqual(summary_pos.prediction_tendency, "over-prediction")

        # Reference exact test case: residuals [-1, 0, 2]
        # model - obs = -1 -> (10, 11); model - obs = 0 -> (10, 10); model - obs = 2 -> (12, 10)
        test_pairs = [(10.0, 11.0), (10.0, 10.0), (12.0, 10.0)]
        summary_hb = collocation_engine.compute_metrics(test_pairs, "temperature", 3, 0.0, 0.0, "linear")

        expected_bias = 1.0 / 3.0
        expected_mae = (1.0 + 0.0 + 2.0) / 3.0  # 1.0
        expected_rmse = math.sqrt((1.0 + 0.0 + 4.0) / 3.0)  # sqrt(5/3) ~ 1.290994

        self.assertAlmostEqual(summary_hb.bias, expected_bias, places=4)
        self.assertAlmostEqual(summary_hb.mae, expected_mae, places=4)
        self.assertAlmostEqual(summary_hb.rmse, expected_rmse, places=4)
        print(f"[OK] Sign convention and residual metrics verified: Bias={summary_hb.bias:.4f} (1/3), MAE={summary_hb.mae:.4f} (1.0), RMSE={summary_hb.rmse:.4f} (sqrt(5/3))")

    def test_03_profile_collocation_argo_synthetic(self):
        """Collocation of primary Argo float ARGO_2902145."""
        res = self.client.get("/api/collocation/profile/ARGO_2902145")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["profile_id"], "ARGO_2902145")
        self.assertEqual(data["platform_type"], "argo")

        # Verify temperature collocation
        temp = data["temperature"]
        self.assertIsNotNone(temp)
        self.assertEqual(temp["variable"], "temperature")
        self.assertEqual(temp["valid_pairs"], 14)
        self.assertIsNotNone(temp["bias"])
        self.assertIsNotNone(temp["mae"])
        self.assertIsNotNone(temp["rmse"])
        self.assertEqual(len(data["temperature_levels"]), 14)

        # Verify salinity collocation
        sal = data["salinity"]
        self.assertIsNotNone(sal)
        self.assertEqual(sal["variable"], "salinity")
        self.assertEqual(sal["valid_pairs"], 14)
        self.assertIsNotNone(sal["bias"])

        # Check model health
        self.assertIn(data["model_health"], ["EXCELLENT", "GOOD", "ACCEPTABLE", "REQUIRES_CALIBRATION"])
        self.assertLess(data["latency_ms"], 300.0)
        print(f"[OK] ARGO_2902145 collocated in {data['latency_ms']:.2f}ms (Health: {data['model_health']})")

    def test_04_qc_outlier_and_missing_levels(self):
        """Strict exclusion of bad QC flags (flag 4) from metrics."""
        res = self.client.get("/api/collocation/profile/ARGO_TEST_QC_OUTLIER")
        self.assertEqual(res.status_code, 200)
        data = res.json()

        # ARGO_TEST_QC_OUTLIER has 4 levels, 1 has QC flag 4
        self.assertEqual(data["temperature"]["total_levels"], 4)
        self.assertEqual(data["temperature"]["valid_pairs"], 3)

        rejected = [lvl for lvl in data["temperature_levels"] if not lvl["valid"]]
        self.assertEqual(len(rejected), 1)
        self.assertEqual(rejected[0]["rejection_reason"], "BAD_QC_FLAG")
        self.assertEqual(rejected[0]["qc_flag"], 4)
        self.assertIsNone(rejected[0]["model_value"])
        self.assertIsNone(rejected[0]["delta"])
        print("[OK] QC outlier correctly rejected and excluded from validation metrics")

    def test_05_real_local_samples_collocation(self):
        """Collocation of real local Argo and Glider samples."""
        # Real Argo: ARGO_2902210_REAL
        res_argo = self.client.get("/api/collocation/profile/ARGO_2902210_REAL")
        self.assertEqual(res_argo.status_code, 200)
        d_argo = res_argo.json()
        self.assertGreater(d_argo["temperature"]["valid_pairs"], 0)

        # Real Glider: GLIDER_REAL_INCOIS_SG02
        res_glider = self.client.get("/api/collocation/profile/GLIDER_REAL_INCOIS_SG02")
        self.assertEqual(res_glider.status_code, 200)
        d_glider = res_glider.json()
        self.assertGreater(d_glider["temperature"]["valid_pairs"], 0)
        print(f"[OK] Real local Argo ({d_argo['profile_id']}) and Glider ({d_glider['profile_id']}) collocated successfully")

    def test_06_glider_transect_waypoint_collocation(self):
        """Collocation of 3D glider transect: GLIDER_BOB_SG01."""
        res = self.client.get("/api/collocation/glider/GLIDER_BOB_SG01")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["glider_id"], "GLIDER_BOB_SG01")
        self.assertEqual(data["total_waypoints"], 25)
        self.assertEqual(data["matched_waypoints"], 25)
        self.assertIsNotNone(data["temperature_summary"]["bias"])
        print(f"[OK] Glider GLIDER_BOB_SG01 collocated (25 waypoints, Bias: {data['temperature_summary']['bias']:.4f}°C)")

    def test_07_domain_bounds_rejection(self):
        """Out of bounds rejection (coordinates outside Indian Ocean domain)."""
        # Trilinear spatial interpolation with out-of-bounds coords
        val, err = collocation_engine.trilinear_interpolate_3d(
            collocation_engine.ocean_svc.dataset.variables["temperature"][0, :, :, :],
            lat=45.0,  # North of 25N
            lon=80.0,
            depth=10.0
        )
        self.assertIsNone(val)
        self.assertIn("OUT_OF_BOUNDS_LAT", err)

        val, err = collocation_engine.trilinear_interpolate_3d(
            collocation_engine.ocean_svc.dataset.variables["temperature"][0, :, :, :],
            lat=15.0,
            lon=125.0,  # East of 95E
            depth=10.0
        )
        self.assertIsNone(val)
        self.assertIn("OUT_OF_BOUNDS_LON", err)
        print("[OK] Out of bounds spatial coordinates rejected cleanly with descriptive error codes")

    def test_08_unknown_profile_returns_404(self):
        """HTTP 404 for unknown profile ID."""
        res = self.client.get("/api/insitu/argo/UNKNOWN_FLOAT_XYZ")
        self.assertEqual(res.status_code, 404)

        res = self.client.get("/api/collocation/profile/UNKNOWN_FLOAT_XYZ")
        self.assertEqual(res.status_code, 404)

        res = self.client.get("/api/collocation/glider/UNKNOWN_GLIDER_XYZ")
        self.assertEqual(res.status_code, 404)
        print("[OK] Unknown platform IDs returned HTTP 404")

    def test_09_argo_profile_lookup_by_wmo_and_case(self):
        """Argo ID lookup with exact ID, lowercase, WMO ID, and real sample."""
        # 1. Exact ID
        res_exact = self.client.get("/api/insitu/argo/ARGO_2902145")
        self.assertEqual(res_exact.status_code, 200)
        self.assertEqual(res_exact.json()["id"], "ARGO_2902145")

        # 2. Lowercase prefix
        res_lower = self.client.get("/api/insitu/argo/argo_2902145")
        self.assertEqual(res_lower.status_code, 200)
        self.assertEqual(res_lower.json()["id"], "ARGO_2902145")

        # 3. Numeric WMO ID
        res_wmo = self.client.get("/api/insitu/argo/2902145")
        self.assertEqual(res_wmo.status_code, 200)
        self.assertEqual(res_wmo.json()["id"], "ARGO_2902145")

        # 4. Real sample WMO lookup
        res_real = self.client.get("/api/insitu/argo/2902210")
        self.assertEqual(res_real.status_code, 200)
        self.assertEqual(res_real.json()["id"], "ARGO_2902210_REAL")
        print("[OK] Argo float WMO ID and case-normalization lookups verified")

if __name__ == "__main__":
    print("=== SAMUDRA-3D Collocation Engine Acceptance Test Suite ===")
    unittest.main(verbosity=2)
