# Antigravity Observation Globe Rendering Fix Report

## Status: READY FOR CODEX REVIEW

Date: October 6, 2026
Branch: `release/reviewed-core-2026-09-29`
Scope: Fix 3D Indian Ocean Globe rendering defect triggered when opening Observations fleet drawer / enabling Argo & Glider layers, strengthen regression test suite with active-state frame assertions, and deterministic 3D marker geometry verification per corrections 02.

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

2. **Added Deterministic 3D Marker Mesh Architecture Assertions (`frontend/tests/test-argo.mjs`, `frontend/tests/observation-globe-rendering.spec.js`)**:
   - Added explicit structural assertions verifying that `createArgoMarker` and `updateMarkerSelectionVisuals` construct bounded 3D geometries (`SphereGeometry`, `CylinderGeometry`, `RingGeometry`) and strictly 0 `THREE.Sprite` objects.

3. **Strengthened Browser Regression Test with Active-State Frame Assertions (`frontend/tests/observation-globe-rendering.spec.js`)**:
   - Intercepts the app's actual in-situ endpoints (`/api/insitu/argo`, `/api/insitu/gliders`, `/api/insitu/status`) with valid schemas.
   - Directly drives visible controls: `data-testid="bottombar-observations-btn"`, `data-testid="bottombar-argo-btn"`, `data-testid="bottombar-gliders-btn"`, filter chips (`[data-testid="filter-argo"]`, `[data-testid="filter-glider"]`, `[data-testid="filter-all"]`), and platform item cards (`.platform-item-card`).
   - Removes conditional `count() > 0` skips so missing controls trigger failure.
   - Asserts exact drawer platform counts (`5` total, `3` Argo, `2` Gliders).
   - Tests all state combinations: Both layers active with drawer open, Both active with drawer closed, Gliders-only, Argo-only, Selected float with halo, and Both-off.
   - Evaluates composited rendered frame pixels during **active marker states** (both layers ON + drawer OPEN, both ON + drawer CLOSED, selected float with halo): verifies active rendering (center brightness > 20) and deep-space background dark levels at viewport corners (brightness < 50), proving absence of viewport-filling rectangular NDC quads.

---

## 3. Touched Files

| File | Change Type | Description |
|---|---|---|
| `frontend/src/utils/argoProfiles.js` | Fix | Replaced unscaled screen-space `Sprite` quads with 3D beacon spheres, stems, and selection halo meshes |
| `frontend/tests/test-argo.mjs` | Test | Added anti-sprite regression and 3D mesh architecture assertions |
| `frontend/tests/observation-globe-rendering.spec.js` | Test | Full regression test driving active in-situ layers and asserting clean 3D rendering with active-state frame checks |
| `docs/antigravity-observation-globe-rendering-fix-report.md` | Report | This root cause and verification report |

---

## 4. Evidence Artifacts

Screenshots captured during test execution in `docs/evidence/observation-globe-fix/`:
- `01-argo-gliders-active-drawer-open.png`: Observation Fleet Drawer open showing 5 active platforms with 3D Argo beacon spheres and Glider transects rendered on globe.
- `02-both-layers-active-drawer-closed.png`: Clean full-globe view with both observation layers active and drawer closed.
- `03-gliders-only-active.png`: Gliders layer active and Argo layer toggled off.
- `04-argo-only-active.png`: Argo float layer active and Gliders layer toggled off.
- `05-selected-float-with-halo-drawer-open.png`: Selected Argo float (WMO 2902145) with bright cyan selection halo ring on globe and selected card in drawer.
- `06-both-off-drawer-open.png`: Both observation layers toggled off with drawer open.

---

## 5. Verification Results

1. **Argo Float Marker Structural Tests**:
   - Command: `node tests/test-argo.mjs` (in `frontend/`)
   - Result: **PASSED (100% - all 5 test suites passed)**
2. **Frontend Lint**:
   - Command: `npm run lint` (in `frontend/`)
   - Result: **PASSED (0 errors, 0 warnings)**
3. **Frontend Production Build**:
   - Command: `npm run build` (in `frontend/`)
   - Result: **PASSED (built in 2.35s, 0 errors)**
4. **Transition Queue Tests**:
   - Command: `node tests/transitionQueue.test.js` (in `frontend/`)
   - Result: **PASSED (2/2 passed)**
5. **Globe Regression Tests & Observation Rendering Test**:
   - Command: `npx playwright test tests/globe-box.spec.js tests/observation-globe-rendering.spec.js` (in `frontend/`)
   - Result: **PASSED (5/5 passed in 59.6s)**
6. **Git Diff Check**:
   - Command: `git diff --check`
   - Result: **PASSED (0 issues)**

---

## 6. Commit Record

- Root cause fix commit: `bbb9006d986793fe23630079746e4d859d633b21`
- Test strengthening commit: `b1464303666d50608bda3dd0afba75db140b0589`
- Corrections 02 commit: `7316377bf49dee7dc516045a2018fcc775400f0d`
