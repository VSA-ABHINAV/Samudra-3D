# Antigravity Observation Globe Rendering Fix Report

## Status: READY FOR CODEX REVIEW

Date: October 4, 2026
Branch: `release/reviewed-core-2026-09-29`
Scope: Fix 3D Indian Ocean Globe rendering defect triggered when opening Observations fleet drawer / enabling Argo & Glider layers and strengthen regression test per review 01.

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

2. **Corrected and Strengthened Regression Test (`frontend/tests/observation-globe-rendering.spec.js`)**:
   - Intercepts the app's actual in-situ endpoints (`/api/insitu/argo`, `/api/insitu/gliders`, `/api/insitu/status`) with valid schemas.
   - Directly drives visible controls: `data-testid="bottombar-observations-btn"`, `data-testid="bottombar-argo-btn"`, `data-testid="bottombar-gliders-btn"`, filter chips (`[data-testid="filter-argo"]`, `[data-testid="filter-glider"]`, `[data-testid="filter-all"]`), and platform item cards (`.platform-item-card`).
   - Removes conditional `count() > 0` skips so missing controls trigger failure.
   - Asserts exact drawer platform counts (`5` total, `3` Argo, `2` Gliders).
   - Tests all state combinations: Both layers active with drawer open, Both active with drawer closed, Gliders-only, Argo-only, Selected float with halo, and Both-off.
   - Adds canvas corner pixel sampling checking for space background dark levels (`< 50` brightness), proving absence of viewport-filling quad artifacts.

---

## 3. Touched Files

| File | Change Type | Description |
|---|---|---|
| `frontend/src/utils/argoProfiles.js` | Fix | Replaced unscaled screen-space `Sprite` quads with 3D beacon spheres, stems, and selection halo meshes |
| `frontend/tests/observation-globe-rendering.spec.js` | Test | Full regression test driving active in-situ layers and asserting clean 3D rendering |
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

1. **Frontend Lint**:
   - Command: `npm run lint` (in `frontend/`)
   - Result: **PASSED (0 errors, 0 warnings)**
2. **Frontend Production Build**:
   - Command: `npm run build` (in `frontend/`)
   - Result: **PASSED (built in 3.30s, 0 errors)**
3. **Transition Queue Tests**:
   - Command: `node tests/transitionQueue.test.js` (in `frontend/`)
   - Result: **PASSED (2/2 passed)**
4. **Globe Regression Tests & Observation Rendering Test**:
   - Command: `npx playwright test tests/globe-box.spec.js tests/observation-globe-rendering.spec.js` (in `frontend/`)
   - Result: **PASSED (3/3 passed in 52.9s)**
5. **Git Diff Check**:
   - Command: `git diff --check`
   - Result: **PASSED (0 issues)**

