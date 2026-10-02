# Antigravity Phase Report: Selected Phase 06 — Anomaly Controls & Source Separation

**Date**: 2026-09-30  
**Status**: READY FOR CODEX REVIEW  
**Scope**: Implementation of truthful, configurable 3D residual anomaly controls; race-safe parameter changes and dataset gating; observation source mode separation (`REAL_LOCAL` vs `SYNTHETIC` vs `ALL`) to prevent mixing synthetic data with real in-situ platforms; accurate platform counting (only platforms with >= 1 valid surviving residual); distinct variable threshold states; error retry mechanisms; complete, strict response provenance verification (finite threshold within numeric tolerance, non-empty dataset ID matching confirmed active dataset, exact variable, and exact source mode); request cancellation & layer-off generation invalidation; and full regression validation.

---

## 1. Problem Addressed & Changes Made

### A. Observation Source Mode Selector & Glider Mapping Fix
1. **Source Mode Selector**:
   - Added a visible `<select>` element (`data-testid="source-mode-select"`) in [`BottomControlBar.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/components/BottomControlBar.jsx) allowing explicit switching between:
     - `REAL_LOCAL` ("Real In-Situ Only")
     - `SYNTHETIC` ("Synthetic Demo Only")
     - `ALL` ("Mixed (Real + Synthetic)")
   - Changing source mode updates the state `insituSourceMode` in [`App.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/App.jsx), driving Argo fetches, Glider fetches, Anomaly requests, and the `anomaly-source-badge`.
2. **Glider Mapping Correction**:
   - Fixed the glider transect fetch in [`App.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/App.jsx) to pass `source_mode: insituSourceMode` directly (previously hardcoded to `"ALL"`).
3. **Backend Source Filtering & Cache Partitioning**:
   - [`backend/app/routers/anomaly.py`](file:///d:/Samudra%203D/samudra-3d/backend/app/routers/anomaly.py): Accepts and validates `source_mode` query parameter across `/api/anomaly/field` and `/api/anomaly/summary`.
   - [`backend/app/schemas/anomaly.py`](file:///d:/Samudra%203D/samudra-3d/backend/app/schemas/anomaly.py): Required `dataset_id: str` and `source_mode: str` in `AnomalyFieldResponse`.
   - [`backend/app/services/anomaly_engine.py`](file:///d:/Samudra%203D/samudra-3d/backend/app/services/anomaly_engine.py): Gated `insitu_service.get_all_profiles(source_mode=source_mode)` and `get_glider_transects(source_mode=source_mode)`. Populates `dataset_id = self.active_dataset_id` in response. Cache keys are partitioned by `(active_dataset_id, source_mode)`.

### B. Accurate Contributing Platform Counts & Statistical Metrics
1. **Platform Count Fix**:
   - In [`backend/app/services/anomaly_engine.py`](file:///d:/Samudra%203D/samudra-3d/backend/app/services/anomaly_engine.py), `platform_count` is now computed strictly as `len(contributing_platform_ids)` where platforms only contribute if they have at least one valid comparison pair surviving QC and spatial/depth filtering. Zero-valid platforms now report `platform_count = 0`.
2. **Deterministic Threshold States**:
   - In [`App.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/App.jsx), maintained separate state values for temperature threshold (`tempThreshold`, default 0.5 °C, range 0.1–3.0 °C) and salinity threshold (`salThreshold`, default 0.10 PSU, range 0.02–1.00 PSU). Switching variables automatically selects the corresponding valid threshold and slider bounds without value bleed.

### C. Complete Scientific Identity & Layer-Off Invalidation
1. **Complete Response Provenance Guard**:
   - In [`App.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/App.jsx), removed permissive defaults. A response may publish only when all 4 fields are present and valid:
     - `typeof data.variable === 'string' && data.variable === expectedVar`
     - `typeof data.source_mode === 'string' && data.source_mode === expectedSource`
     - `typeof data.threshold === 'number' && Number.isFinite(data.threshold) && Math.abs(data.threshold - expectedThreshold) < 1e-4`
     - `Boolean(expectedDatasetId && typeof data.dataset_id === 'string' && data.dataset_id.trim() !== '' && data.dataset_id === expectedDatasetId)`
   - On missing or mismatched identity, old anomaly points, coverage, and metrics are cleared and the concise error/retry state is displayed.
2. **Layer-Off & Dataset Invalidation**:
   - When the anomaly layer is toggled off or dataset switched, generation ID is incremented and active requests are aborted so late-arriving responses can never publish.
3. **Loading & Error Recovery UI**:
   - In [`BottomControlBar.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/components/BottomControlBar.jsx), rendered `anomaly-loading-indicator` while fetching, and `anomaly-error-panel` with `anomaly-retry-btn` on failure.

---

## 2. Modified and Created Files

- [`backend/app/schemas/anomaly.py`](file:///d:/Samudra%203D/samudra-3d/backend/app/schemas/anomaly.py): Required `dataset_id: str` and `source_mode: str` in `AnomalyFieldResponse`.
- [`backend/app/routers/anomaly.py`](file:///d:/Samudra%203D/samudra-3d/backend/app/routers/anomaly.py): Validated and passed `source_mode` to anomaly endpoints.
- [`backend/app/services/anomaly_engine.py`](file:///d:/Samudra%203D/samudra-3d/backend/app/services/anomaly_engine.py): Partitioned cache by source mode, filtered platforms by valid point contribution, populated `dataset_id`, and propagated source mode.
- [`backend/tests/test_anomaly.py`](file:///d:/Samudra%203D/samudra-3d/backend/tests/test_anomaly.py): Unit tests 09–13 for source mode filtering, zero-valid platform counting, invalid source mode rejection, summary cache partitioning, and dataset ID provenance.
- [`frontend/src/services/api.js`](file:///d:/Samudra%203D/samudra-3d/frontend/src/services/api.js): Updated `fetchAnomalyField` and `fetchAnomalySummary` to send `source_mode`.
- [`frontend/src/App.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/App.jsx): Added source mode state, independent temperature/salinity thresholds, request identity guard, abort controller, complete response provenance verification, layer-off invalidation, and error/retry handler.
- [`frontend/src/components/BottomControlBar.jsx`](file:///d:/Samudra%203D/samudra-3d/frontend/src/components/BottomControlBar.jsx): Mounted `source-mode-select`, separate variable threshold ranges, loading indicator, error retry panel, coverage badge, source badge, and metrics summary.
- [`frontend/tests/selected-phase-06.spec.js`](file:///d:/Samudra%203D/samudra-3d/frontend/tests/selected-phase-06.spec.js): 7 comprehensive tests (`TC-P06-01` to `TC-P06-07`) verifying source mode switching, variable/threshold resetting, held/out-of-order race safety, error recovery, wrong/missing threshold, wrong/missing dataset ID, wrong source, wrong variable rejection, and layer-off invalidation.
- [`docs/selected-features-plan.md`](file:///d:/Samudra%203D/samudra-3d/docs/selected-features-plan.md): Plan updated.
- [`docs/antigravity-selected-phase-06-report.md`](file:///d:/Samudra%203D/samudra-3d/docs/antigravity-selected-phase-06-report.md): This report.

---

## 3. Verification Results

### A. Backend Unit Tests
Command executed:
```bash
.\.venv\Scripts\python.exe -m unittest backend.tests.test_anomaly backend.tests.test_collocation backend.tests.test_probe_transect
```
**Results**: **28 passed / 28 total (100% pass rate)** in 1.362s.

### B. Frontend Lint, Unit Tests, and Build
- `npm.cmd run lint` (in `frontend`): **0 errors, 0 warnings (Pass)**
- `npm.cmd run build` (in `frontend`): **Vite production build succeeded (Pass)**
- `node --test tests/transitionQueue.test.js`: **2 tests passed (Pass)**

### C. Full Required Combined Browser Regression Suite
Command executed:
```bash
npx.cmd playwright test tests/globe-box.spec.js tests/selected-phase-05.spec.js tests/selected-phase-06.spec.js tests/selected-phase-07.spec.js tests/core-phase-01.spec.js tests/core-phase-01-contract-review.spec.js tests/core-phase-02.spec.js tests/core-phase-02-identity-review.spec.js tests/core-phase-03.spec.js tests/core-phase-04.spec.js --reporter=list
```

**Results**: **69 passed / 69 total (100% pass rate)**:
- `tests/selected-phase-06.spec.js`: 7/7 passed
  - TC-P06-01: Toggling ANOMALIES enables/disables anomaly field and controls strip (Pass)
  - TC-P06-02: User switches source mode across REAL_LOCAL, SYNTHETIC, and ALL with instant metric updates (Pass)
  - TC-P06-03: Variable switch resets threshold to respective defaults and updates slider bounds (Pass)
  - TC-P06-04: Out-of-order and held responses do not overwrite newer user selection (Pass)
  - TC-P06-05: Anomaly error panel renders retry action and recovers cleanly (Pass)
  - TC-P06-06: Mismatched provenance (wrong/missing threshold, wrong/missing dataset ID, wrong source, wrong variable) is rejected (Pass)
  - TC-P06-07: Turning anomaly layer off invalidates pending requests and late response cannot publish (Pass)
- `tests/globe-box.spec.js`: 2/2 passed
- `tests/selected-phase-05.spec.js`: 7/7 passed
- `tests/selected-phase-07.spec.js`: 8/8 passed
- `tests/core-phase-01.spec.js`: 16/16 passed
- `tests/core-phase-01-contract-review.spec.js`: 1/1 passed
- `tests/core-phase-02.spec.js`: 10/10 passed
- `tests/core-phase-02-identity-review.spec.js`: 6/6 passed (including deterministic TC-ID-06)
- `tests/core-phase-03.spec.js`: 7/7 passed
- `tests/core-phase-04.spec.js`: 5/5 passed

---

## 4. Unverified Real-Data Behavior & Remaining Limits

1. **GLORYS Real-Data Blocker**: Remains blocked as documented in [`docs/selected-features-plan.md`](file:///d:/Samudra%203D/samudra-3d/docs/selected-features-plan.md) until genuine local GLORYS NetCDF file is placed on disk.
2. **Excluded Features**: Saved locations/analyses and live feeds remain excluded.
3. **Subsequent Selected Features**: Observation-ID search, download progress/cancellation, and buoy observations remain scheduled for subsequent reviewed phases.

---

## 5. Status & Next Steps

Phase 06 is fully corrected, strictly verified, and marked as **READY FOR CODEX REVIEW**.
Local Git commit: `ec8ce1e` (`feat(selected): implement independent layers, anomaly controls, and ocean cross-sections`).
