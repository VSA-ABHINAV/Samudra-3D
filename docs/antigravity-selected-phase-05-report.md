# Antigravity Phase Report: Selected Phase 05 — Independent Map Layer Controls

**Date**: 2026-09-30  
**Status**: COMPLETE — READY FOR CODEX REVIEW  
**Scope**: Implementation of independent, truthful, discoverable on/off controls for map overlays (Current Streamlines, Argo markers, and Glider markers); decoupling fleet drawer state from marker visibility; dataset capability reconciliation (`currents` or both `u`/`uo` and `v`/`vo`); user-driven layer switching; and full regression validation across all core and selected test suites without conditional escapes.

---

## 1. Problem Addressed & Changes Made

### A. Independent Overlay Lifecycle & Decoupling
1. **Scalar Variable vs. Streamline Vector Vectors**:
   - Selecting the scalar `currents` field (`setSelectedVariable('currents')`) in [`App.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/App.jsx) no longer silently forces `showCurrents` to `true`. The scalar field can be viewed without rendering streamlines, and streamlines can be turned on/off regardless of which scalar field is active.
   - In [`OceanCanvas.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/components/OceanCanvas.jsx), the particle streamline system lifecycle is strictly gated by `showCurrents && !isDatasetBlocked`, ensuring particle systems are properly disposed when disabled or during dataset blocking.
2. **Observation Fleet Drawer Decoupling**:
   - In [`Header.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/components/Header.jsx) and [`BottomControlBar.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/components/BottomControlBar.jsx), opening or closing the observation drawer (`isObservationDrawerOpen`) toggles the drawer panel itself and strictly does NOT alter `showArgo` or `showGliders` marker layer visibility.
   - The button in [`BottomControlBar.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/components/BottomControlBar.jsx) (`bottombar-observations-btn`, labeled "FLEET DRAWER") uses `aria-pressed` and `aria-expanded` reflecting the drawer state.
   - In [`App.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/App.jsx), Argo floats and glider transects are fetched when either their map marker layer is active OR when the observation drawer is open (`showArgo || isObservationDrawerOpen` / `showGliders || isObservationDrawerOpen`), ensuring the fleet drawer list receives platform data without forcing map markers on.
3. **Discoverable, Visible Bottom Bar Map Controls**:
   - Added dedicated, accessible buttons in [`BottomControlBar.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/components/BottomControlBar.jsx):
     - `data-testid="bottombar-argo-btn"` (`aria-pressed={showArgo}`): toggles Argo marker overlay.
     - `data-testid="bottombar-gliders-btn"` (`aria-pressed={showGliders}`): toggles Glider marker overlay.
     - `data-testid="bottombar-streamlines-btn"` (`aria-pressed={showCurrents}`): toggles particle streamlines with explicit disabled/unavailable state when dataset lacks velocity vectors.
4. **Dataset Capability Reconciliation & Stale Vector Suppression**:
   - Streamline capability `hasCurrents` in [`App.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/App.jsx) is strictly derived from verified dataset metadata requiring either `currents` or both `u`/`uo` and `v`/`vo` vector components. A dataset with only a single component does not falsely advertise streamline availability.
   - When switching to a dataset lacking vector capability, `showCurrents` is automatically disabled, the bottom bar and sidebar switches are disabled with explanatory tooltips, and any active particle system is disposed.
   - User cannot toggle streamlines on while dataset capability is absent or while dataset metadata is unconfirmed.

---

## 2. Modified and Created Files

- [`frontend/src/App.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/App.jsx): Decoupled scalar variable selection and drawer opening from overlay visibility flags; derived strict `hasCurrents` capability; reconciled dataset switch currents availability; updated Argo/Glider data fetch triggers.
- [`frontend/src/components/BottomControlBar.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/components/BottomControlBar.jsx): Exposed discoverable, keyboard-accessible `STREAMLINES`, `ARGO`, `GLIDERS`, and `FLEET DRAWER` buttons with accurate ARIA states and tooltips.
- [`frontend/src/components/OceanCanvas.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/components/OceanCanvas.jsx): Gated particle streamlines strictly on `showCurrents && !isDatasetBlocked`.
- [`frontend/tests/selected-phase-05.spec.js`](file:///d:/Samudra%203D/samudra-3d/frontend/tests/selected-phase-05.spec.js): Replaced conditional escapes with 7 fully user-driven Playwright tests (`TC-P05-01` to `TC-P05-07`) asserting rendered/HUD state across independent overlay permutations, fleet drawer operations, dataset switches, and metadata error recovery.
- [`docs/selected-features-plan.md`](file:///d:/Samudra%203D/samudra-3d/docs/selected-features-plan.md): Plan updated.
- [`docs/antigravity-selected-phase-05-report.md`](file:///d:/Samudra%203D/samudra-3d/docs/antigravity-selected-phase-05-report.md): This report.

---

## 3. Verification Results

### A. Linting, Unit Tests, and Build
- `npm.cmd run lint` (in `frontend`): **0 errors, 0 warnings (Pass)**
- `npm.cmd run build` (in `frontend`): **Vite production build succeeded (Pass)**
- `node --test tests/transitionQueue.test.js`: **2 tests passed (Pass)**

### B. Full Browser Acceptance & Regression Suite
Command executed:
```bash
npx.cmd playwright test tests/selected-phase-05.spec.js tests/selected-phase-06.spec.js tests/core-phase-01.spec.js tests/core-phase-01-contract-review.spec.js tests/core-phase-02.spec.js tests/core-phase-02-identity-review.spec.js tests/core-phase-03.spec.js tests/core-phase-04.spec.js --reporter=list
```

**Results**: **57 passed / 57 total (100% pass rate)** across all 8 test files:
- `tests/selected-phase-05.spec.js`: 7/7 passed
  - TC-P05-01: Selecting currents scalar variable does NOT silently enable streamlines (Pass)
  - TC-P05-02: Streamlines toggle turns vectors on and off independently of scalar variable (Pass)
  - TC-P05-03: Opening observation fleet drawer does NOT change Argo or glider marker visibility (Pass)
  - TC-P05-04: Visible ARGO and GLIDERS buttons toggle marker overlays with HUD synchronization (Pass)
  - TC-P05-05: Switching to dataset without currents disables streamlines button and clears vectors (Pass)
  - TC-P05-06: Failed metadata fetch leaves controls blocked; retry recovery restores them (Pass)
  - TC-P05-07: Argo-only, glider-only, both, and off states are fully user-driven and preserved across drawer operations (Pass)
- `tests/selected-phase-06.spec.js`: 5/5 passed
- `tests/core-phase-01.spec.js`: 16/16 passed
- `tests/core-phase-01-contract-review.spec.js`: 1/1 passed
- `tests/core-phase-02.spec.js`: 10/10 passed
- `tests/core-phase-02-identity-review.spec.js`: 6/6 passed
- `tests/core-phase-03.spec.js`: 7/7 passed
- `tests/core-phase-04.spec.js`: 5/5 passed

---

## 4. Unverified Browser / Real-Data Behavior & Remaining Risks

1. **GLORYS Real-Data Blocker**: Remains blocked as documented in [`docs/selected-features-plan.md`](file:///d:/Samudra%203D/samudra-3d/docs/selected-features-plan.md) until the genuine local GLORYS NetCDF file is placed on the filesystem.
2. **Excluded Features Removal Scope**: Backend routes and UI placeholders for Saved Locations/Analyses and Live Cyclone/Telemetry feeds are left untouched per instructions pending explicit removal scope decision.
3. **Subsequent Selected Features**: Ocean cross-section workflow, Observation-ID search, Download progress/cancellation, and Buoy observations remain scheduled for subsequent phases.

---

## 5. Status & Next Steps

Phase 05 corrections and verification are complete. Ready for Codex review.
