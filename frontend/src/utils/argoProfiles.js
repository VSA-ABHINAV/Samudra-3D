/**
 * SAMUDRA-3D Argo Float Markers and Profile Utilities
 */
import * as THREE from 'three';
import { geoToCartesian, DEFAULT_GLOBE_RADIUS } from './coordinates.js';

export const ARGO_MARKER_RADIUS = DEFAULT_GLOBE_RADIUS + 0.8; // 100.8, sits gracefully above surface (100.0) & scalar layer (100.2)

export const FLOAT_COLORS = {
  default: 0xf59e0b,    // Amber / Gold beacon
  selected: 0x38bdf8,   // Vibrant Sky Blue highlight
  outlier: 0xf43f5e,    // Rose / Alert for QC test fixture
  ring: 0x0284c7        // Selection halo
};

/**
 * Converts geographic coordinates to 3D Cartesian position for Argo float marker.
 * @param {number} lat - Latitude in degrees
 * @param {number} lon - Longitude in degrees
 * @param {number} [radius=ARGO_MARKER_RADIUS] - Radial distance from globe center
 * @returns {THREE.Vector3}
 */
export function getFloat3DPosition(lat, lon, radius = ARGO_MARKER_RADIUS) {
  const pt = geoToCartesian(lat, lon, 0, {
    globeRadius: radius,
    verticalExaggeration: 0
  });
  return new THREE.Vector3(pt.x, pt.y, pt.z);
}

/**
 * Checks if a marker at markerPos is geometrically occluded by the Earth sphere from cameraPos.
 * Uses both surface normal horizon test and line-of-sight sphere intersection test.
 * 
 * @param {THREE.Vector3} markerPos - Marker position in world coordinates
 * @param {THREE.Vector3} cameraPos - Camera position in world coordinates
 * @param {number} [globeRadius=DEFAULT_GLOBE_RADIUS] - Earth globe radius (default 100)
 * @returns {boolean} True if occluded by the Earth
 */
export function isMarkerOccluded(markerPos, cameraPos, globeRadius = DEFAULT_GLOBE_RADIUS) {
  // 1. Surface normal test: normal points outward from globe center (0,0,0)
  const normal = markerPos.clone().normalize();
  const toCamera = cameraPos.clone().sub(markerPos);
  if (normal.dot(toCamera) <= 0) {
    // Facing away from camera horizon
    return true;
  }

  // 2. Line of sight sphere intersection check
  const rayDir = markerPos.clone().sub(cameraPos);
  const distToMarker = rayDir.length();
  rayDir.normalize();

  // Vector from camera to sphere center (0,0,0) is -cameraPos
  const camToCenter = cameraPos.clone().negate();
  const proj = camToCenter.dot(rayDir);

  if (proj > 0 && proj < distToMarker) {
    const closestDistSq = camToCenter.lengthSq() - (proj * proj);
    const effRadius = globeRadius * 0.998;
    if (closestDistSq < effRadius * effRadius) {
      return true;
    }
  }

  return false;
}

/**
 * Creates a 3D Three.js group for an Argo float marker.
 * @param {Object} floatData - Float metadata object
 * @param {boolean} [isSelected=false] - Whether this float is currently selected
 * @returns {THREE.Group}
 */
export function createArgoMarker(floatData, isSelected = false) {
  const group = new THREE.Group();
  group.name = `argo-marker-${floatData.id}`;
  group.userData = {
    id: floatData.id,
    floatData,
    lat: floatData.lat,
    lon: floatData.lon,
    isSelected
  };

  const pos = getFloat3DPosition(floatData.lat, floatData.lon);
  group.position.copy(pos);

  // Align group rotation so local Y points along surface normal
  const normal = pos.clone().normalize();
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

  // 1. Anchor stem connecting globe surface to beacon
  const stemGeom = new THREE.CylinderGeometry(0.12, 0.12, 0.8, 8);
  const stemMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
  const stemMesh = new THREE.Mesh(stemGeom, stemMat);
  stemMesh.position.set(0, -0.4, 0);
  group.add(stemMesh);

  // 2. Main beacon sphere
  const isOutlier = floatData.qc_summary && floatData.qc_summary.bad > 0;
  const baseColor = isSelected
    ? FLOAT_COLORS.selected
    : isOutlier
    ? FLOAT_COLORS.outlier
    : FLOAT_COLORS.default;

  const beaconGeom = new THREE.SphereGeometry(1.2, 16, 16);
  const beaconMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    emissive: baseColor,
    emissiveIntensity: isSelected ? 1.2 : 0.75,
    roughness: 0.3,
    metalness: 0.2
  });
  const beaconMesh = new THREE.Mesh(beaconGeom, beaconMat);
  beaconMesh.name = 'beacon';
  beaconMesh.userData = group.userData;
  group.add(beaconMesh);

  // 3. Selection halo ring
  const ringGeom = new THREE.RingGeometry(1.6, 2.2, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: FLOAT_COLORS.ring,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: isSelected ? 0.9 : 0.0
  });
  const ringMesh = new THREE.Mesh(ringGeom, ringMat);
  ringMesh.name = 'selection-ring';
  ringMesh.rotation.x = Math.PI / 2; // Flat on surface
  ringMesh.visible = isSelected;
  group.add(ringMesh);

  // 4. Subtle pulse outer glow sphere
  const glowGeom = new THREE.SphereGeometry(1.7, 16, 16);
  const glowMat = new THREE.MeshBasicMaterial({
    color: baseColor,
    transparent: true,
    opacity: isSelected ? 0.35 : 0.15,
    wireframe: true
  });
  const glowMesh = new THREE.Mesh(glowGeom, glowMat);
  glowMesh.name = 'glow';
  group.add(glowMesh);

  return group;
}

/**
 * Raycasts against visible Argo markers in markersGroup, excluding Earth-occluded markers.
 * @param {THREE.Raycaster} raycaster
 * @param {THREE.Group} markersGroup
 * @param {THREE.Vector3} cameraPos
 * @param {number} [globeRadius=DEFAULT_GLOBE_RADIUS]
 * @returns {Object|null} Intersected float data or null
 */
export function raycastArgoMarkers(raycaster, markersGroup, cameraPos, globeRadius = DEFAULT_GLOBE_RADIUS) {
  if (!markersGroup || !markersGroup.visible) return null;

  const intersects = raycaster.intersectObjects(markersGroup.children, true);
  if (!intersects.length) return null;

  for (const hit of intersects) {
    // Walk up to find the group containing userData
    let obj = hit.object;
    while (obj && !obj.userData?.id && obj.parent) {
      obj = obj.parent;
    }

    if (obj && obj.userData?.floatData) {
      const worldPos = new THREE.Vector3();
      obj.getWorldPosition(worldPos);

      // Verify not occluded by Earth
      if (!isMarkerOccluded(worldPos, cameraPos, globeRadius)) {
        return obj.userData.floatData;
      }
    }
  }

  return null;
}

/**
 * Updates marker visual appearance based on selection state.
 * @param {THREE.Group} markersGroup
 * @param {string|null} selectedId
 */
export function updateMarkerSelectionVisuals(markersGroup, selectedId) {
  if (!markersGroup) return;

  markersGroup.children.forEach((group) => {
    const isSelected = group.userData.id === selectedId;
    group.userData.isSelected = isSelected;

    const beacon = group.getObjectByName('beacon');
    const ring = group.getObjectByName('selection-ring');
    const glow = group.getObjectByName('glow');

    const isOutlier = group.userData.floatData?.qc_summary?.bad > 0;
    const color = isSelected
      ? FLOAT_COLORS.selected
      : isOutlier
      ? FLOAT_COLORS.outlier
      : FLOAT_COLORS.default;

    if (beacon && beacon.material) {
      beacon.material.color.setHex(color);
      if (beacon.material.emissive) {
        beacon.material.emissive.setHex(color);
        beacon.material.emissiveIntensity = isSelected ? 1.2 : 0.75;
      }
      beacon.scale.setScalar(isSelected ? 1.35 : 1.0);
    }

    if (ring && ring.material) {
      ring.visible = isSelected;
      ring.material.opacity = isSelected ? 0.9 : 0.0;
    }

    if (glow && glow.material) {
      glow.material.color.setHex(color);
      glow.material.opacity = isSelected ? 0.4 : 0.15;
      glow.scale.setScalar(isSelected ? 1.4 : 1.0);
    }
  });
}

/**
 * Updates visibility of markers on the far side of the Earth during rendering.
 * @param {THREE.Group} markersGroup
 * @param {THREE.Vector3} cameraPos
 * @param {number} [globeRadius=DEFAULT_GLOBE_RADIUS]
 */
export function updateOccludedMarkersVisibility(markersGroup, cameraPos, globeRadius = DEFAULT_GLOBE_RADIUS) {
  if (!markersGroup || !markersGroup.visible) return;

  const worldPos = new THREE.Vector3();
  markersGroup.children.forEach((group) => {
    group.getWorldPosition(worldPos);
    const occluded = isMarkerOccluded(worldPos, cameraPos, globeRadius);
    // Dim or hide occluded markers so they don't shine through semi-transparent globe
    group.visible = !occluded;
  });
}

/**
 * Disposes all geometries, materials, and textures in a markers group.
 * @param {THREE.Group} markersGroup
 */
export function disposeArgoMarkers(markersGroup) {
  if (!markersGroup) return;

  markersGroup.children.forEach((child) => {
    child.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        if (Array.isArray(node.material)) {
          node.material.forEach((m) => m.dispose());
        } else {
          node.material.dispose();
        }
      }
    });
  });

  while (markersGroup.children.length > 0) {
    markersGroup.remove(markersGroup.children[0]);
  }
}

/**
 * Formats geographic coordinates into human readable scientific strings (e.g. "12.48°N, 82.03°E").
 */
export function formatFloatCoordinates(lat, lon) {
  if (lat === undefined || lon === undefined) return 'N/A';
  const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lonStr}`;
}

/**
 * Formats UTC timestamp string to ISO date.
 */
export function formatFloatDate(isoStr) {
  if (!isoStr) return 'N/A';
  try {
    const dt = new Date(isoStr);
    return dt.toISOString().replace('.000Z', ' UTC').replace('T', ' ');
  } catch {
    return isoStr;
  }
}
