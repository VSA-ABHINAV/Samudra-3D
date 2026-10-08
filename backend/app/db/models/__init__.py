"""
SAMUDRA-3D Database Models Registry
Exposes all models for Alembic migrations and application services.
"""
from backend.app.db.database import Base
from backend.app.db.models.users import Role, User, UserSession, AuditLog
from backend.app.db.models.datasets import Dataset, DatasetVersion, DatasetFile, DatasetVariable
from backend.app.db.models.observations import (
    ObservationPlatform,
    ObservationProfile,
    ObservationMeasurement,
    GliderTransect
)
from backend.app.db.models.locations import Location
from backend.app.db.models.jobs import DownloadJob, CacheEntry

__all__ = [
    "Base",
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
