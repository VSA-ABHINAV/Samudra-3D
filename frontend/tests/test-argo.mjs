/**
 * SAMUDRA-3D Argo Float Markers Unit Tests
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ARGO_MARKER_RADIUS,
  FLOAT_COLORS,
  getFloat3DPosition,
  isMarkerOccluded,
  createArgoMarker,
  updateMarkerSelectionVisuals,
  disposeArgoMarkers,
  formatFloatCoordinates,
  formatFloatDate
} from '../src/utils/argoProfiles.js';
import { geoToCartesian } from '../src/utils/coordinates.js';

console.log('--- Testing SAMUDRA-3D Argo Float Markers  ---');

// -----------------------------------------------------------------------------
// 1. 3D Spherical Coordinate Placement & Precision
// -----------------------------------------------------------------------------
const bobLat = 12.48;
const bobLon = 82.03;
const bobPos = getFloat3DPosition(bobLat, bobLon);

assert.ok(bobPos instanceof THREE.Vector3, 'Position must be a THREE.Vector3');
const bobRadius = bobPos.length();
assert.ok(
  Math.abs(bobRadius - ARGO_MARKER_RADIUS) < 1e-4,
  `Marker radius ${bobRadius} must match ARGO_MARKER_RADIUS ${ARGO_MARKER_RADIUS}`
);
assert.ok(bobPos.y > 0, 'Bay of Bengal Y coordinate must be positive (Northern hemisphere)');
assert.ok(bobPos.x > 0, 'Bay of Bengal X coordinate must be positive (Eastern longitude)');
assert.ok(bobPos.z > 0, 'Bay of Bengal Z coordinate must be positive (cos(82°) > 0)');

const asLat = 16.52;
const asLon = 71.85;
const asPos = getFloat3DPosition(asLat, asLon);
assert.ok(Math.abs(asPos.length() - ARGO_MARKER_RADIUS) < 1e-4);
console.log('✓ 1. 3D spherical coordinate placement verified (Bay of Bengal & Arabian Sea)');

// -----------------------------------------------------------------------------
// 2. Alignment with Shared Coordinate System
// -----------------------------------------------------------------------------
const rawPt = geoToCartesian(bobLat, bobLon, 0, {
  globeRadius: ARGO_MARKER_RADIUS,
  verticalExaggeration: 0
});
assert.ok(Math.abs(bobPos.x - rawPt.x) < 1e-6);
assert.ok(Math.abs(bobPos.y - rawPt.y) < 1e-6);
assert.ok(Math.abs(bobPos.z - rawPt.z) < 1e-6);
console.log('✓ 2. Float coordinate projection strictly aligns with globe coordinate system');

// -----------------------------------------------------------------------------
// 3. Earth Occlusion & Far-Side Line-of-Sight Geometry
// -----------------------------------------------------------------------------
// Camera directly in front of marker (e.g. looking at Bay of Bengal from distance 220)
const frontCam = bobPos.clone().normalize().multiplyScalar(220);
assert.equal(
  isMarkerOccluded(bobPos, frontCam, 100),
  false,
  'Marker must NOT be occluded when camera faces it directly'
);

// Camera on the exact antipodal opposite side of the globe
const backCam = bobPos.clone().normalize().multiplyScalar(-220);
assert.equal(
  isMarkerOccluded(bobPos, backCam, 100),
  true,
  'Marker must BE occluded when camera is on the far side of the Earth'
);

// Camera looking at Earth from 90° away (tangent/limb horizon)
// A camera along the perpendicular plane where dot product <= 0
const perpCam = new THREE.Vector3(-bobPos.z, bobPos.y, bobPos.x).normalize().multiplyScalar(220);
assert.equal(
  isMarkerOccluded(bobPos, perpCam, 100),
  true,
  'Marker on the back-facing limb must be occluded'
);
console.log('✓ 3. Earth occlusion geometry verified (front visible, antipodal hidden, limb tested)');

// -----------------------------------------------------------------------------
// 4. Geographic String Formatting
// -----------------------------------------------------------------------------
assert.equal(formatFloatCoordinates(12.48, 82.03), '12.48°N, 82.03°E');
assert.equal(formatFloatCoordinates(-11.25, 88.50), '11.25°S, 88.50°E');
assert.equal(formatFloatCoordinates(-15.5, -45.2), '15.50°S, 45.20°W');
assert.equal(formatFloatDate('2026-09-10T12:00:00Z'), '2026-09-10 12:00:00 UTC');
console.log('✓ 4. Geographic coordinates and timestamp formatting verified');

// -----------------------------------------------------------------------------
// 5. Marker Three.js Hierarchy, 3D Mesh Integrity & Anti-Regression Assertions
// -----------------------------------------------------------------------------
const mockFloat = {
  id: 'ARGO_2902145',
  platform_type: 'argo',
  name: 'Argo Float 2902145 (Bay of Bengal)',
  wmo_id: '2902145',
  lat: 12.48,
  lon: 82.03,
  timestamp: '2026-09-10T12:00:00Z',
  qc_summary: { good: 14, bad: 0, pass_rate_pct: 100 }
};

const markerGroup = createArgoMarker(mockFloat, false);
assert.ok(markerGroup instanceof THREE.Group);
assert.equal(markerGroup.name, 'argo-marker-ARGO_2902145');
assert.equal(markerGroup.userData.id, 'ARGO_2902145');

// Anti-regression: Ensure marker NEVER uses THREE.Sprite or screen-space unattenuated quads
let spriteCount = 0;
let meshCount = 0;
markerGroup.traverse((child) => {
  if (child instanceof THREE.Sprite || child.isSprite) {
    spriteCount++;
  }
  if (child instanceof THREE.Mesh || child.isMesh) {
    meshCount++;
  }
});
assert.equal(spriteCount, 0, 'Argo marker must NOT contain any THREE.Sprite objects');
assert.ok(meshCount >= 4, 'Argo marker must contain at least 4 bounded 3D meshes (stem, beacon, ring, glow)');

const beacon = markerGroup.getObjectByName('beacon');
assert.ok(beacon, 'Marker must contain beacon mesh');
assert.ok(beacon.geometry instanceof THREE.SphereGeometry, 'Beacon must use 3D SphereGeometry');
assert.equal(beacon.geometry.parameters.radius, 1.2, 'Beacon sphere radius must be 1.2 units');

const ring = markerGroup.getObjectByName('selection-ring');
assert.ok(ring, 'Marker must contain selection ring mesh');
assert.ok(ring.geometry instanceof THREE.RingGeometry, 'Selection ring must use 3D RingGeometry');
assert.equal(ring.visible, false, 'Selection ring must be hidden when not selected');

const glow = markerGroup.getObjectByName('glow');
assert.ok(glow, 'Marker must contain glow mesh');
assert.ok(glow.geometry instanceof THREE.SphereGeometry, 'Glow must use 3D SphereGeometry');

// Test selecting marker
const markersContainer = new THREE.Group();
markersContainer.add(markerGroup);

updateMarkerSelectionVisuals(markersContainer, 'ARGO_2902145');
assert.equal(ring.visible, true, 'Selection ring must become visible when selected');
assert.equal(beacon.scale.x, 1.35, 'Beacon must scale up when selected');

// Re-verify no sprites introduced upon selection
let selectedSpriteCount = 0;
markerGroup.traverse((child) => {
  if (child instanceof THREE.Sprite || child.isSprite) selectedSpriteCount++;
});
assert.equal(selectedSpriteCount, 0, 'Selected Argo marker must NOT contain any THREE.Sprite objects');

// Test deselecting marker
updateMarkerSelectionVisuals(markersContainer, null);
assert.equal(ring.visible, false, 'Selection ring must hide when deselected');
assert.equal(beacon.scale.x, 1.0, 'Beacon scale must return to 1.0');

// Test cleanup
disposeArgoMarkers(markersContainer);
assert.equal(markersContainer.children.length, 0, 'disposeArgoMarkers must remove all children');
console.log('✓ 5. Three.js 3D mesh structure, anti-sprite regression, selection highlighting, and resource disposal verified');

console.log('\nALL ARGO FLOAT TESTS PASSED (100%)\n');
