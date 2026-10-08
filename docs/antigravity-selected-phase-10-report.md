# Antigravity Selected Phase 10 Report: Buoy observations

## 1. Executive Summary

- **Feature**: Selected Phase 10 — Buoy observations (Importance: 2/5).
- **Status**: Ready for Codex review (Phase 10 corrections).
- **Phase 09 Acceptance Commit**: `9d154bd84a01baa898eef3e43ff94b074c432b12` (`docs(phase-09): record Codex Phase 09 acceptance and update plan`).
- **Phase 10 Implementation Commit**: `121664da84e618caf3879139372d9e57d716a877` (`feat(phase-10): implement local buoy observation browsing and station inspection`).
- **Phase 10 Corrections Commit (01)**: `b0d0a309a9ee0bfe2dacc7a9e913f5ec51470984` (`fix(phase-10): classify bundled buoy reference records and eliminate timestamp and qc fabrication`).
- **Phase 10 Corrections Commit (02)**: `749ca5cc07587ecca519625b6a45e00beaabf641` (`fix(phase-10): default local incois json records to real_local provenance and badge`).
- **Phase 10 Corrections Commit (03)**: `3f1b5d253b1939c06ac5c92215f38133cd3ba3e2` (`fix(phase-10): represent absent qc as unknown in profile charts and t-s diagram`).
- **Corrections Summary**: Corrected built-in buoy reference catalog classification to `BUNDLED_REFERENCE` with badge `[REFERENCE • BUNDLED]` and note `"Bundled reference sample · illustrative, not live"`. Eliminated timestamp fabrication (`datetime.now()`), keeping observation times absent (`None`) when missing in source. Removed manufactured all-good QC flags and unverified 100% pass rates, presenting honest `"Unavailable"` and `"QC: Not reported"` states in the Observation Drawer and Profile Modal. Corrected local JSON ingestion so untagged JSON records parsed from `raw/incois/*.json` default to `REAL_LOCAL` with `[REAL • LOCAL_FILE]` badge and local filename provenance notes without falling back to bundled reference badges. Represented absent QC as an explicit `unknown`/`unreported` state distinct from good and bad flags across profile charts, T-S diagram, and tooltips (rendering neutral styling and `QC: Not reported`, never `Good (Flag null)`), while keeping measurements visible and preserving gap behavior for actual bad/outlier QC flags.

---

## 2. Corrections Applied (Phase 10 Remediation)

### A. Honest Provenance & Source Mode Separation
1. **`backend/app/data/incois_ingest.py`**:
   - Updated `INCOIS_REFERENCE_BUOYS`: Assigned `source_mode="BUNDLED_REFERENCE"`, `provenance_badge="[REFERENCE • BUNDLED]"`, and `provenance_note="Bundled reference sample · illustrative, not live"`.
   - Updated `parse_incois_netcdf()`: Parsed actual source time and QC variables if present; otherwise left `timestamp=None` and `qc_flags=None`. Set `source_mode="REAL_LOCAL"` and `provenance_badge="[REAL • LOCAL_FILE]"`.
   - Updated `scan_incois_directory()`: Configured scanned local JSON files to default to `source_mode="REAL_LOCAL"`, `provenance_badge="[REAL • LOCAL_FILE]"`, and provenance note `f"Parsed from local file {json_file.name}"` when not provided in the source file. Removed `datetime.now()` and all-good QC injection for reference catalog items.

2. **`backend/app/schemas/insitu.py`**:
   - `BuoySummary`: Updated `timestamp: Optional[str] = None`, `qc_summary: Optional[QCFlagSummary] = None`, `source_mode: str = "BUNDLED_REFERENCE"`, `provenance_badge: str = "[REFERENCE • BUNDLED]"`, and added `provenance_note: Optional[str] = None`.
   - `BuoyDetail`: Updated `timestamp: Optional[str] = None`, `qc_flags: Optional[List[int]] = None`, `qc_summary: Optional[QCFlagSummary] = None`, `source_mode: str = "BUNDLED_REFERENCE"`, `provenance_badge: str = "[REFERENCE • BUNDLED]"`, and added `provenance_note: Optional[str] = None`.

3. **`backend/app/services/insitu_service.py`**:
   - Updated `normalize_buoy()`: Resolved provenance badge dynamically based on `source_mode` (`[REAL • LOCAL_FILE]` for `REAL_LOCAL`, `[REFERENCE • BUNDLED]` for `BUNDLED_REFERENCE`). Attached appropriate provenance notes naming local files. Preserved `raw.get("timestamp")` without substituting `datetime.now()`. Computed `qc_summary` only if source `qc_flags` is present, otherwise kept `qc_summary=None`.
   - Updated `get_buoy_stations()`: Supported explicit source modes (`BUNDLED_REFERENCE`, `REAL_LOCAL`, `ALL`), cleanly returned `[]` on `SYNTHETIC`, and safely checked `qc_summary` before evaluating `qc_filter`.
   - Updated `load_observations()`: Categorized reference buoys as `BUNDLED_REFERENCE` and disk-parsed NetCDF/JSON buoys as `REAL_LOCAL`.

### B. Frontend UI & Scientific Chart Three-State QC Presentation
1. **`frontend/src/utils/profileCharts.js`**:
   - Updated `cleanProfileData()` to represent missing/absent QC as `unknown`/`unreported` (`qcStatus: 'unknown'`, `isUnknown: true`, `isGood: false`, `isBad: false`).
   - Prevented absent QC points from inflating `goodCount` or `badCount`; tracked `unknownCount`.
   - Updated `generateProfileSvgPaths()` to keep unknown QC points connected along the curve while breaking gaps strictly across bad/outlier QC flags (flags 3, 4).

2. **`frontend/src/components/ObservationDrawer.jsx`**:
   - Displayed `[REFERENCE • BUNDLED]` badge styling for bundled reference buoys.
   - Removed generic fallback date strings; rendered `"Time: Unavailable"` when `timestamp` is absent.
   - Rendered `"QC: Not reported"` when `qc_summary` is absent.

3. **`frontend/src/components/ProfileModal.jsx`**:
   - Displayed `[REFERENCE • BUNDLED]` badge and prominent provenance note `"Bundled reference sample · illustrative, not live"` when viewing reference buoys.
   - Displayed `"QC: Not reported"` badge in header when source QC is absent.
   - Updated tooltip hover readout to render `QC: Not reported` (with neutral muted color) when QC is absent, never claiming `Good (Flag null)`.
   - Rendered unknown QC depth points with neutral slate styling (`#94a3b8`) and `data-testid="qc-unknown-point"`.
   - Updated `TSDiagramSvgChart` to apply identical three-state QC semantics, neutral point styling (`data-testid="ts-qc-unknown-point"`), and `QC: Not reported` hover tooltip.

---

## 3. Test Suites & Verification Results

| Suite / Gate | Command | Result / Exact Counts |
|---|---|---|
| Backend Test Suite | `python -m unittest discover -s backend/tests -p "test_*.py"` | **104 passed, 2 skipped (0 failures)** |
| Backend Buoy Contract Tests | `python backend/tests/test_buoys.py` | **100% passed (includes bare local JSON test)** |
| Backend Real Ingest Suite | `python -m unittest backend/tests/test_insitu_real_ingest.py` | **8 passed (0 failures)** |
| Scientific Profile Charts Unit Tests | `node tests/test-profile-charts.mjs` (in `frontend/`) | **100% passed (6 verification sections)** |
| Frontend Lint | `npm run lint` (in `frontend/`) | **0 warnings, 0 errors (Clean)** |
| Frontend Build | `npm run build` (in `frontend/`) | **Built successfully in 8.99s** |
| Transition Queue Unit Tests | `node tests/transitionQueue.test.js` (in `frontend/`) | **2 passed, 0 failed** |
| Playwright Phase 10 Suite | `npx playwright test tests/selected-phase-10.spec.js` | **4 passed (9.5s)** |
| Playwright Regression Suite | `npx playwright test tests/selected-phase-08.spec.js tests/selected-phase-09.spec.js tests/selected-phase-10.spec.js` | **20 passed (37.7s)** |
| Git Diff Check | `git diff --check` | **0 issues (clean)** |

---

## 4. Evidence Artifacts

The following visual evidence was captured during deterministic end-to-end browser test execution:
- `docs/evidence/selected-phase-10/01_buoy_drawer_station_list.png`: Observation Drawer listing bundled reference buoys with `[REFERENCE • BUNDLED]` badge, `QC: Not reported`, and `Time: Unavailable`, alongside a real local-file buoy with `[REAL • LOCAL_FILE]`.
- `docs/evidence/selected-phase-10/02_buoy_profile_modal_inspection.png`: Profile Modal displaying `[REFERENCE • BUNDLED]` badge, `"Bundled reference sample · illustrative, not live"` provenance notice, `QC: Not reported`, and `Unavailable` timestamp.
- `docs/evidence/selected-phase-10/03_buoy_model_comparison_modal.png`: Model comparison modal launched for buoy station.
- `docs/evidence/selected-phase-10/04_buoy_drawer_search_and_empty.png`: Search filtering and clean empty state in Observation Drawer.

---

## 5. Scope Boundary Confirmation

- **Live external feeds**: NOT implemented. No external network polling, live cyclone tracks, or unverified live streams were added.
- **Saved locations/analyses**: NOT implemented. Excluded features were left untouched.
- **No later phases started**: Stopped immediately after Phase 10 corrections verification.
- **No push/deploy**: Implementation is staged and committed locally only.
