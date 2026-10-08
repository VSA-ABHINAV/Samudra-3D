"""
SAMUDRA-3D Database Package
Provides PostgreSQL / SQLAlchemy 2.x engine, models, and legacy SQLite compatibility.
"""
from backend.app.db.database import Base, engine, SessionLocal, get_db, DATABASE_URL
from backend.app.db.legacy_sqlite import get_db_connection, hash_password, init_db
from backend.app.db.models import (
    Role,
    User,
    UserSession,
    AuditLog,
    Dataset,
    DatasetVersion,
    DatasetFile,
    DatasetVariable,
    ObservationPlatform,
    ObservationProfile,
    ObservationMeasurement,
    GliderTransect,
    Location,
    DownloadJob,
    CacheEntry
)

__all__ = [
    "Base",
    "engine",
    "SessionLocal",
    "get_db",
    "DATABASE_URL",
    "get_db_connection",
    "hash_password",
    "init_db",
    "Role",
    "User",
    "UserSession",
    "AuditLog",
    "Dataset",
    "DatasetVersion",
    "DatasetFile",
    "DatasetVariable",
    "ObservationPlatform",
    "ObservationProfile",
    "ObservationMeasurement",
    "GliderTransect",
    "Location",
    "DownloadJob",
    "CacheEntry"
]
