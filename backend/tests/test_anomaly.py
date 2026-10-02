"""
SAMUDRA-3D Anomaly Engine Test Suite
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
from backend.app.services.anomaly_engine import anomaly_engine

class TestAnomalyEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_01_anomaly_field_sign_convention_and_points(self):
        """Verify delta = MODEL - OBSERVED, points structure, and physical units."""
        res = self.client.get("/api/anomaly/field?variable=temperature")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["variable"], "temperature")
        self.assertEqual(data["unit"], "degC")
        self.assertGreater(data["total_valid_pairs"], 0)
        self.assertGreater(data["platform_count"], 0)

        # Check every point respects delta = MODEL - OBSERVED
        for pt in data["points"]:
            expected_delta = round(pt["model_value"] - pt["observed_value"], 4)
            self.assertAlmostEqual(pt["delta"], expected_delta, places=3)
            self.assertIn(pt["platform_type"], ["argo", "glider"])
            self.assertGreaterEqual(pt["depth"], 0.0)

    def test_02_threshold_boundary(self):
        """Threshold boundary logic (|delta| >= threshold triggers alert)."""
        # 1. Default threshold 0.5
        res = self.client.get("/api/anomaly/field?variable=temperature&threshold=0.5")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        threshold = data["threshold"]
        self.assertEqual(threshold, 0.5)

        for pt in data["points"]:
            if abs(pt["delta"]) >= 0.5:
                self.assertTrue(pt["is_alert"], f"Point {pt['platform_id']} delta {pt['delta']} should be alert")
            else:
                self.assertFalse(pt["is_alert"], f"Point {pt['platform_id']} delta {pt['delta']} should not be alert")

        # 2. Extreme threshold: 0.0 -> all points must be alert
        res_zero = self.client.get("/api/anomaly/field?variable=temperature&threshold=0.0")
        data_zero = res_zero.json()
        self.assertEqual(data_zero["alert_count"], data_zero["total_valid_pairs"])
        for pt in data_zero["points"]:
            self.assertTrue(pt["is_alert"])

        # 3. Extreme threshold: 999.0 -> zero alerts
        res_high = self.client.get("/api/anomaly/field?variable=temperature&threshold=999.0")
        data_high = res_high.json()
        self.assertEqual(data_high["alert_count"], 0)
        for pt in data_high["points"]:
            self.assertFalse(pt["is_alert"])

    def test_03_qc_and_missing_exclusion(self):
        """Bad QC flags (3, 4) and missing values excluded from anomaly field."""
        res = self.client.get("/api/anomaly/field?variable=temperature")
        self.assertEqual(res.status_code, 200)
        data = res.json()

        for pt in data["points"]:
            self.assertNotIn(pt["qc_flag"], [3, 4], "Bad QC flag should not appear in anomaly field")
            self.assertIsNotNone(pt["observed_value"])
            self.assertIsNotNone(pt["model_value"])
            self.assertIsNotNone(pt["delta"])

    def test_04_depth_range_filter(self):
        """Depth range filtering [depth_min, depth_max]."""
        d_min, d_max = 50.0, 300.0
        res = self.client.get(f"/api/anomaly/field?variable=temperature&depth_min={d_min}&depth_max={d_max}")
        self.assertEqual(res.status_code, 200)
        data = res.json()

        for pt in data["points"]:
            self.assertGreaterEqual(pt["depth"], d_min)
            self.assertLessEqual(pt["depth"], d_max)

        # Inverted range must return 400 Bad Request
        res_inv = self.client.get("/api/anomaly/field?depth_min=400&depth_max=100")
        self.assertEqual(res_inv.status_code, 400)

    def test_05_coverage_bins_and_sparse_disclaimer(self):
        """Coverage bins, support radius, and mandatory sparse disclaimer."""
        res = self.client.get("/api/anomaly/field?variable=temperature")
        self.assertEqual(res.status_code, 200)
        data = res.json()

        # Check coverage bins
        self.assertGreater(len(data["coverage_bins"]), 0)
        total_binned = sum(b["count"] for b in data["coverage_bins"])
        self.assertEqual(total_binned, data["total_valid_pairs"])
        for b in data["coverage_bins"]:
            self.assertTrue(b["has_data"])
            self.assertGreater(b["count"], 0)

        # Check sparse policy & disclaimer
        self.assertIn("55", str(data["support_radius_km"]))
        self.assertIn("Sparse observations", data["no_data_warning"])
        self.assertIn("No interpolation", data["no_data_warning"])

    def test_06_summary_endpoint(self):
        """Verify /api/anomaly/summary endpoint structure."""
        res = self.client.get("/api/anomaly/summary")
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertIn("temperature", data)
        self.assertIn("salinity", data)
        self.assertEqual(data["temperature"]["variable"], "temperature")
        self.assertEqual(data["salinity"]["variable"], "salinity")
        self.assertGreater(data["platform_count"], 0)

        # Verify D07 explicit deferral record
        self.assertIn("DEFERRED", data["health_score_status"])
        self.assertIn("D07", data["health_score_status"])

    def test_07_invalid_parameters(self):
        """Parameter validation error handling."""
        # Unsupported variable
        res = self.client.get("/api/anomaly/field?variable=current_speed")
        self.assertEqual(res.status_code, 400)
        self.assertIn("Unsupported variable", res.json()["detail"])

        # Negative depth_min -> FastAPI validation 422
        res_neg = self.client.get("/api/anomaly/field?depth_min=-10")
        self.assertEqual(res_neg.status_code, 422)

    def test_08_field_latency(self):
        """Performance check: /api/anomaly/field completes in < 500ms."""
        t0 = time.perf_counter()
        res = self.client.get("/api/anomaly/field?variable=temperature")
        dt_ms = (time.perf_counter() - t0) * 1000.0
        self.assertEqual(res.status_code, 200)
        self.assertLess(dt_ms, 500.0)
        print(f"[OK] Anomaly field endpoint latency: {dt_ms:.2f}ms (< 500ms target)")

    def test_09_source_mode_isolation_and_filtering(self):
        """Test REAL_LOCAL, SYNTHETIC, and ALL source modes return distinct platform sets and counts."""
        # 1. REAL_LOCAL
        res_real = self.client.get("/api/anomaly/field?variable=temperature&source_mode=REAL_LOCAL")
        self.assertEqual(res_real.status_code, 200)
        data_real = res_real.json()
        self.assertEqual(data_real["source_mode"], "REAL_LOCAL")
        real_pids = set(p["platform_id"] for p in data_real["points"])
        # Ensure no synthetic platforms in real mode
        for pid in real_pids:
            self.assertFalse(pid.startswith("SYN_"), f"Synthetic ID {pid} found in REAL_LOCAL anomaly field")

        # 2. SYNTHETIC
        res_syn = self.client.get("/api/anomaly/field?variable=temperature&source_mode=SYNTHETIC")
        self.assertEqual(res_syn.status_code, 200)
        data_syn = res_syn.json()
        self.assertEqual(data_syn["source_mode"], "SYNTHETIC")
        syn_pids = set(p["platform_id"] for p in data_syn["points"])

        # 3. ALL
        res_all = self.client.get("/api/anomaly/field?variable=temperature&source_mode=ALL")
        self.assertEqual(res_all.status_code, 200)
        data_all = res_all.json()
        self.assertEqual(data_all["source_mode"], "ALL")
        all_pids = set(p["platform_id"] for p in data_all["points"])

        # Platform count assertions
        self.assertGreater(data_real["platform_count"], 0)
        self.assertGreater(data_syn["platform_count"], 0)
        self.assertEqual(data_real["platform_count"], len(real_pids))
        self.assertEqual(data_syn["platform_count"], len(syn_pids))
        self.assertEqual(data_all["platform_count"], len(all_pids))
        self.assertEqual(all_pids, real_pids | syn_pids)
        self.assertEqual(data_all["total_valid_pairs"], data_real["total_valid_pairs"] + data_syn["total_valid_pairs"])

    def test_10_invalid_source_mode(self):
        """Invalid source_mode returns 400 Bad Request."""
        res = self.client.get("/api/anomaly/field?variable=temperature&source_mode=INVALID_MODE")
        self.assertEqual(res.status_code, 400)
        self.assertIn("Invalid source_mode", res.json()["detail"])

        res_sum = self.client.get("/api/anomaly/summary?source_mode=INVALID_MODE")
        self.assertEqual(res_sum.status_code, 400)
        self.assertIn("Invalid source_mode", res_sum.json()["detail"])

    def test_11_zero_valid_platform_count(self):
        """When 0 points survive depth filters, platform_count is 0 and aggregate metrics are None."""
        # Query impossible depth range (e.g. 3990 to 4000 where no observations exist)
        res = self.client.get("/api/anomaly/field?variable=temperature&depth_min=3990&depth_max=4000")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_valid_pairs"], 0)
        self.assertEqual(data["platform_count"], 0)
        self.assertEqual(data["alert_count"], 0)
        self.assertIsNone(data["bias"])
        self.assertIsNone(data["mae"])
        self.assertIsNone(data["rmse"])

    def test_12_summary_source_mode_partitioning(self):
        """Verify summary endpoint partitions results by source_mode."""
        res_real = self.client.get("/api/anomaly/summary?source_mode=REAL_LOCAL")
        self.assertEqual(res_real.status_code, 200)
        data_real = res_real.json()
        self.assertEqual(data_real["temperature"]["source_mode"], "REAL_LOCAL")

        res_syn = self.client.get("/api/anomaly/summary?source_mode=SYNTHETIC")
        self.assertEqual(res_syn.status_code, 200)
        data_syn = res_syn.json()
        self.assertEqual(data_syn["temperature"]["source_mode"], "SYNTHETIC")

        self.assertNotEqual(data_real["platform_count"], data_syn["platform_count"])

    def test_13_dataset_id_provenance(self):
        """Verify anomaly field response includes dataset_id matching active dataset."""
        res = self.client.get("/api/anomaly/field?variable=temperature")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("dataset_id", data)
        self.assertIsNotNone(data["dataset_id"])
        self.assertEqual(data["dataset_id"], "incois_roms_synthetic")


if __name__ == "__main__":
    unittest.main(verbosity=2)
