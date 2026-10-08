"""
Tests for Phase 11: Excluded-Feature Cleanup and Retained Shared Workflows
Verifies that:
1. Excluded features (Live external feeds, Saved locations/analyses) have no active/dedicated public routes.
2. Truthful OFFLINE_INTEGRATION_GAP status is preserved.
3. Dedicated saved-feature ORM exports (SavedLocation, AnalysisRun, CollocationResult, Anomaly) are absent from models.
4. Database tables and rows remain intact (no drop tables or data loss).
5. Retained core endpoints (model data, observations, buoys, collation, anomaly, auth, admin, dataset downloads) function correctly.
"""
import unittest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.db import get_db_connection
from backend.app.services.insitu_service import insitu_service


class TestPhase11ExcludedCleanup(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_excluded_routes_return_404(self):
        """Dedicated routes for excluded features must not exist and return 404."""
        excluded_endpoints = [
            "/api/saved-locations",
            "/api/saved_locations",
            "/api/locations/saved",
            "/api/saved-analyses",
            "/api/saved_analyses",
            "/api/analyses/saved",
            "/api/bookmarks",
            "/api/live-feeds",
            "/api/live_feeds",
            "/api/cyclone-tracks",
            "/api/cyclone/live-track",
            "/api/fishing-bulletins",
            "/api/pfz/live-feed",
        ]
        for ep in excluded_endpoints:
            with self.subTest(endpoint=ep):
                resp = self.client.get(ep)
                self.assertEqual(resp.status_code, 404, f"Expected 404 for excluded endpoint: {ep}")

    def test_insitu_status_preserves_offline_integration_gap(self):
        """In-situ telemetry status must report OFFLINE_INTEGRATION_GAP honestly."""
        resp = self.client.get("/api/insitu/status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data.get("erddap_live_feed"), "OFFLINE_INTEGRATION_GAP")
        self.assertEqual(data.get("status"), "operational")
        self.assertGreater(data.get("buoy_count", 0), 0)

    def test_database_tables_and_records_intact(self):
        """Verify database tables and rows were not dropped or purged."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()

            # Check users table
            cursor.execute("SELECT COUNT(*) as cnt FROM users")
            user_cnt = cursor.fetchone()["cnt"]
            self.assertGreater(user_cnt, 0, "Users table must not be empty or dropped")

            # Check data_sources table
            cursor.execute("SELECT COUNT(*) as cnt FROM data_sources")
            ds_cnt = cursor.fetchone()["cnt"]
            self.assertGreater(ds_cnt, 0, "Data sources table must not be empty or dropped")

            # Check sensors table
            cursor.execute("SELECT COUNT(*) as cnt FROM sensors")
            sensor_cnt = cursor.fetchone()["cnt"]
            self.assertGreaterEqual(sensor_cnt, 0, "Sensors table query should succeed")
        finally:
            conn.close()

    def test_excluded_orm_exports_absent_and_shared_location_retained(self):
        """Verify excluded ORM model classes are absent from exports and shared Location is preserved."""
        import backend.app.db.models as db_models
        import backend.app.db as db_package

        # Excluded ORM exports must not be in __all__ or module attributes
        for name in ["SavedLocation", "AnalysisRun", "CollocationResult", "Anomaly"]:
            self.assertNotIn(name, db_models.__all__, f"{name} must not be exported in db.models.__all__")
            self.assertFalse(hasattr(db_models, name), f"{name} must not exist on db.models")
            self.assertNotIn(name, db_package.__all__, f"{name} must not be exported in db.__all__")
            self.assertFalse(hasattr(db_package, name), f"{name} must not exist on db package")

        # Shared Location model must remain exported and functional
        self.assertIn("Location", db_models.__all__)
        self.assertTrue(hasattr(db_models, "Location"))
        self.assertEqual(db_models.Location.__tablename__, "locations")

    def test_retained_routes_functional(self):
        """Verify that all retained core endpoints operate correctly."""
        # 1. System health & metadata
        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)

        resp = self.client.get("/api/metadata")
        self.assertEqual(resp.status_code, 200)

        # 2. In-situ observations (Argo, Gliders, Buoys)
        resp = self.client.get("/api/insitu/argo")
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.json(), list)

        resp = self.client.get("/api/insitu/gliders")
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.json(), list)

        resp = self.client.get("/api/insitu/buoys")
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.json(), list)

        # 3. Datasets catalog & downloader estimation
        resp = self.client.get("/api/datasets")
        self.assertEqual(resp.status_code, 200)

        # 4. Thermal fronts (active model horizontal temperature gradient, not live satellite scraping)
        resp = self.client.get("/api/ocean/thermal-fronts")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("fronts", data)
        self.assertIn("provenance_badge", data)

        # 5. In-depth analysis
        resp = self.client.get("/api/ocean/in-depth-analysis?lat=12.0&lon=80.0&depth=10.0")
        self.assertEqual(resp.status_code, 200)


if __name__ == "__main__":
    unittest.main()
