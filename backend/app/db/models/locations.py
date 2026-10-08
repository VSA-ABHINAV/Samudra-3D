"""
SAMUDRA-3D Geographical Locations Preset Model
"""
from sqlalchemy import Column, String, Float, JSON
from backend.app.db.database import Base

class Location(Base):
    __tablename__ = "locations"

    id = Column(String(64), primary_key=True, index=True)
    name = Column(String(128), nullable=False, index=True)
    category = Column(String(64), nullable=False) # ocean_basin, sub_basin, coastal, harbor, island
    lat = Column(Float, nullable=False, index=True)
    lon = Column(Float, nullable=False, index=True)
    zoom_distance = Column(Float, default=150.0, nullable=False)
    bbox = Column(JSON, default=dict, nullable=True) # {lat_min, lat_max, lon_min, lon_max}
    description = Column(String(256), nullable=True)
