# Antigravity Observation Globe Rendering Fix Report

## Status: READY FOR CODEX REVIEW

Date: October 4, 2026
Branch: `release/reviewed-core-2026-09-29`
Scope: Fix 3D Indian Ocean Globe rendering defect triggered when opening Observations fleet drawer / enabling Argo & Glider layers.

---

## 1. Root Cause Analysis

### Identified Failure Trigger
When opening the Observation Fleet Drawer or activating the in-situ layers (`showArgo`, `showGliders`), `frontend/src/utils/argoProfiles.js` created Argo float markers using `THREE.Sprite` with `sizeAttenuation: false` on `THREE.SpriteMaterial` without a custom texture map.

### Underlying Mechanism
1. In Three.js, when `sizeAttenuation: false` is enabled on `SpriteMaterial`, the sprite vertex shader transforms the quad in Normalized Device Coordinates (NDC / clip-space screen coordinates).
2. The sprite scale was set to `(1.0, 1.0)` by default (and `1.35` when selected), which in NDC space represents a quad spanning 50% to 100% of the entire viewport dimensions.
3. Because no circular texture map was applied, Three.js rendered the default untransformed 1x1 quad tinted with the marker colors (`0x38bdf8` cyan when selected, `0x0284c7` blue for selection halo, and `0xf59e0b` amber by default).
4. On a 16:9 widescreen viewport (e.g., 1920x1080), these unscaled screen-space quads stretched into giant opaque cyan/blue/amber rectangular bands directly across the center of the viewport, occluding the 3D Indian Ocean globe.

---

## 2. Solution Implemented

1. **Replaced Screen-Space Quads with Authentic 3D Meshes (`frontend/src/utils/argoProfiles.js`)**:
   - Replaced `THREE.Sprite` with `sizeAttenuation: false` in `createArgoMarker` and `updateMarkerSelectionVisuals` with true 3D spherical mesh geometries.
   - Restored the 3D beacon sphere (`THREE.SphereGeometry(1.2, 16, 16)` with `MeshStandardMaterial` emissive lighting), anchor stem (`THREE.CylinderGeometry(0.12, 0.12, 0.8, 8)`), selection halo ring (`THREE.RingGeometry(1.6, 2.2, 32)` positioned flat along surface normal), and pulse glow outer sphere (`THREE.SphereGeometry(1.7, 16, 16)`).
   - Preserved raycasting hit-detection in `raycastArgoMarkers`, selection highlighting in `updateMarkerSelectionVisuals`, Earth horizon occlusion in `updateOccludedMarkersVisibility`, and clean memory disposal in `disposeArgoMarkers`.
2. **Added Comprehensive Playwright Regression Test (`frontend/tests/observation-globe-rendering.spec.js`)**:
   - Tests full workflow at 1920x1080: initial globe render, opening the observation drawer, toggling Argo and Glider layers, selecting an active float, closing the drawer, re-opening the drawer, and independent layer toggles.
   - Verifies the globe remains 100% spherical and intact without visual artifacts or runtime errors.

---

## 3. Touched Files

| File | Change Type | Description |
|---|---|---|
| `frontend/src/utils/argoProfiles.js` | Fix | Replaced unscaled screen-space `Sprite` quads with 3D beacon spheres, stems, and selection halo meshes |
| `frontend/tests/observation-globe-rendering.spec.js` | Test | Added regression test verifying globe rendering at 1920x1080 across all Observation drawer and layer toggle combinations |
| `docs/antigravity-observation-globe-rendering-fix-report.md` | Report | This root cause and verification report |

---

## 4. Evidence Artifacts

Screenshots captured during test execution in `docs/evidence/observation-globe-fix/`:
- `01-globe-initial-1920x1080.png`: Clean 3D Indian Ocean Globe before opening drawer.
- `02-observation-drawer-open.png`: Observation Fleet Drawer open with globe intact.
- `03-argo-gliders-active-drawer-open.png`: Argo float beacons and glider sawtooth tracks active on globe with drawer open.
- `04-markers-active-drawer-closed.png`: Observation markers active and rendering cleanly after closing drawer.
- `05-gliders-only-drawer-open.png`: Gliders layer active with drawer re-opened.
- `06-argo-only-drawer-open.png`: Argo float layer active with drawer re-opened.

---

## 5. Verification Results

1. **Frontend Lint**:
   - Command: `npm.cmd run lint` (in `frontend/`)
   - Result: **PASSED (0 errors, 0 warnings)**
2. **Frontend Production Build**:
   - Command: `npm.cmd run build` (in `frontend/`)
   - Result: **PASSED (built in 3.33s, 0 errors)**
3. **Globe Regression Tests & New Observation Rendering Test**:
   - Command: `npx playwright test tests/globe-box.spec.js tests/observation-globe-rendering.spec.js` (in `frontend/`)
   - Result: **PASSED (3/3 passed in 23.3s)**
4. **Git Diff Check**:
   - Command: `git diff --check`
   - Result: **PASSED (0 issues)**
