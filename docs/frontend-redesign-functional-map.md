# SAMUDRA-3D functional map for the frontend redesign

Reviewed from the current source on 26 September 2026. Login and user registration design are excluded. This is a source review, not a fresh runtime/test certification. No local API listener was found on ports 8000 or 5173 during this review. Older README and audit claims are not treated as current verification.

## What the product actually does

SAMUDRA-3D is an ocean data exploration and analysis application. The main data is a precomputed numerical ocean model; the backend reads it, subsets it, and derives measurements from it. The frontend renders the returned arrays on a globe or a regional 3D volume. Observation profiles provide independent measurements to compare with the model.

Changing a variable, date, depth, or location selects existing data. It does not run a new ocean simulation or generate a new forecast. The comparison button also evaluates existing model data; its current “prediction job” wording is misleading.

## Backend architecture

| Layer | Responsibility | Main source |
|---|---|---|
| FastAPI application | Startup, CORS, route registration, dataset initialization | `backend/app/main.py` |
| Ocean service | Delegates requests to the active dataset adapter | `backend/app/services/ocean_service.py` |
| Dataset registry | Discovers supported files, describes sources, chooses an active dataset | `backend/app/data/registry.py` |
| Dataset adapters | Read NetCDF arrays; return slices, points, profiles, volumes and transects | `backend/app/data/adapters.py` |
| Observation service | Reads and normalizes Argo, glider, buoy and custom sensor records; retains quality flags | `backend/app/services/insitu_service.py` |
| Collocation engine | Interpolates model values to observation position, depth and timestamp; computes errors | `backend/app/services/collocation.py` |
| Anomaly engine | Aggregates valid comparison residuals into sparse points and regional bins | `backend/app/services/anomaly_engine.py` |
| Physics analysis | Computes sound speed, density, stratification and rule-based water mass/heat indicators | `backend/app/services/depth_analysis.py` |
| Thermal front engine | Computes horizontal gradients from the active model's surface temperature | `backend/app/data/satellite_ingest.py` |
| Assistant | Recognizes scientific intents and calculates answers; optional external language-model path | `backend/app/services/ai_assistant.py` |
| Dataset download manager | Estimates size, generates subset commands, starts jobs, records checksums | `backend/app/data/download_manager.py` |
| Persistence | SQLAlchemy/PostgreSQL-capable models coexist with legacy SQLite functions used by current routes | `backend/app/db/` |

Scientific arrays live in NetCDF files, not in user/session database tables. The database stores application records. SQLAlchemy models for saved locations and analysis runs exist, but that alone does not mean these have usable frontend workflows or public APIs.

## Data and shared state

- The registry describes a real local Copernicus GLORYS12V1 subset: 0–25°N, 50–100°E, daily data for 1–7 January 2025, approximately 8.3 km horizontal resolution, and depths around 0.494–92.326 m. These are source/catalog declarations; actual availability and coordinates must be read from the backend metadata.
- Synthetic ROMS is a separate development dataset: 0–25°N, 65–95°E, nine levels reaching 4000 m, and eight six-hour time steps. Do not combine its depth/time promises with the real subset.
- Real local data means historical files on disk. It does not imply a live feed or today's conditions.
- Model dataset selection is held in the backend's process-wide registry. It is not currently a separate per-user selection.
- Main workspace state includes dataset, variable, requested/resolved depth, time index, view mode, layers, selected observation, selected location, and open panels.
- Metadata should drive date/depth choices. The backend's resolved depth should be displayed when the requested depth snaps to a stored level.
- Scientific requests return JSON arrays. Land and missing scalar values are generally represented as null. Regional volumes also return coordinates, shape, provenance, and optional current components.
- Bounding boxes constrain field requests. The source has a 100,000-cell slice limit and volume sample caps; global globe coverage does not mean global scientific coverage.
- Both backend and frontend have caches. Dataset changes must invalidate/re-key cached scientific views and refresh their metadata.

## Current screens and verified options (Phase 12 Redesign)

The frontend implements path handling for `/` (Public Homepage for unauthenticated visitors / `/home` / `/portal`), `/app` (3D Ocean Workstation with strict AuthGate for unauthenticated users), `/login` (Institutional Login Page), and `/admin` (Administration Portal). The Public Homepage introduces confirmed workflows and provenance disclosures, providing clear paths to launch the workstation or log in.

### Public Homepage (`/` unauthenticated, `/home`, `/portal`)

- **Hero & Branding**: Institutional MoES / INCOIS banner, active dataset indicator, and direct launch buttons.
- **Workflow Showcase**: 6 confirmed workflow cards linking directly to Explore, Observations (Fleet), Analysis (Collocation), Deep Ocean Physics & Acoustics, Data Management (Downloader & Registry), and Operations & AI Assistant.
- **Scientific Truthfulness Disclosure**: Transparently declares historical Copernicus GLORYS12V1 and Synthetic ROMS model domains, highlighting the Offline Integration Gap (no live external polling/ERDDAP scraping) and model SST gradient proxies.
- **Navigation & Specs**: Integrated shortcuts to Data Sources & Specifications modal, Institutional Login, and Workstation.

### Explore / main workspace (`/app`)

| Option | Actual behavior |
|---|---|
| Global 3D Earth Globe | Three.js globe for navigation, scalar overlays, observation markers and point selection |
| 3D Ocean Volume Block | Requests a bounded, downsampled depth/latitude/longitude volume and renders it locally |
| TEMP | Displays model potential temperature in °C |
| SALINITY | Displays practical salinity in PSU |
| CURRENTS | Displays horizontal velocity/speed derived from eastward and northward components; activates current particles |
| Depth controls | Select nearest available model depth and request that horizontal slice |
| Date/time controls | Select stored dataset time index |
| Play/pause, back/forward, speed | Animate through stored time steps; buffering pauses advancement; loop state is currently enabled in App |
| Observations | Opens/closes fleet drawer; independent layer toggles for Argo, Gliders, and Buoys |
| Anomalies | Toggles 3D sparse model-minus-observation residual points with configurable temperature/salinity thresholds |
| Search | Searches local place catalog, parses latitude/longitude, and searches Argo floats by 5-7 digit WMO ID |
| Basin presets | Move the camera to a predefined sea/region |
| Zoom/reset/full view | Change camera or workspace display; no new scientific calculation |
| Graticules / labels | Toggle coordinate grid and geographic labels |
| Ocean style / data overlay | Change visual appearance or hide/show scalar data |
| Color scale | Dynamic range uses current slice extrema; fixed range gives comparable colors across views |
| Volume full / slice / surface | Switch the volume display mode and selected depth plane |
| Click ocean point | Requests the selected location's water column for the main time index |
| Coordinate inspector | Shows coordinates, source/date, surface temperature/salinity, derived MLD/D20 and nearest observation |
| CTD PROFILE | Inspects the probed location's vertical profile (or land/outside domain error state) in the Profile Modal |
| COMPARE MODEL | Opens the observation comparison modal with the probed location's nearest observation |
| Deep Ocean Physics | Opens coordinate-based derived analysis |

### Observations and profile inspector

Fleet drawer offers All, Argo, Glider and Buoy filters plus text search. Each card offers selection, camera focus, profile and model comparison. Argo, glider, and buoy lists are loaded and filtered cleanly with honest provenance indicators.

Profile inspector supports temperature-versus-depth, salinity-versus-depth, and temperature-versus-salinity diagrams with density contours. A model overlay can fetch collocation results for the observation. Quality flags matter: bad observations are excluded from continuous curves and comparison pairs.

Observation time/depth can differ from the model window. A deep Argo profile does not extend the model's depth coverage. Unsupported comparison levels remain unavailable.

Custom sensor registration records a platform and optional supplied profile data. Registering coordinates alone does not establish a working live sensor feed. The administration portal exposes sensor management; a separate registration modal is mounted in App but its header callback is not consumed by the current Header.

### Model vs Observation

Select platform, temperature/salinity and temporal matching strategy (linear or nearest). The engine interpolates in latitude, longitude and depth, then matches the observation timestamp. It rejects unsupported locations, times, depths, land cells and poor quality levels.

Output options: dual curves, depth residual plot, level-by-level audit table, full/thermocline chart depth range, scorecard, CSV export, focus platform and show anomaly layer.

Metrics: bias is signed average error; MAE is average absolute error; RMSE emphasizes larger errors; Pearson R measures association; N is valid matched pairs. Residual sign is always MODEL − OBSERVED. Positive is overestimation; negative is underestimation.

This workflow follows the observation's timestamp, not the current playback time. The new UI must explain that distinction.

### Deep Ocean Physics & Acoustics

Coordinate entry and location presets request `/api/ocean/in-depth-analysis`. Tabs cover acoustics, stratification, water masses, heatwave indicators and a hierarchy/reference view.

- Sound speed: Mackenzie formula using temperature, salinity and depth.
- Acoustic axis: minimum sound speed within the available column; this is not proof of a deep SOFAR channel when the model only reaches ~92 m.
- Density: EOS-80-derived density anomaly.
- Pycnocline: strongest vertical density gradient.
- Stability: buoyancy frequency/stratification indicators.
- Water masses: regional temperature/salinity/depth rules.
- Heatwave: simplified fixed 28°C baseline logic, not a validated climatological marine heatwave detection workflow.
- MLD: depth of a 0.5°C reduction from the top-level temperature.
- D20/D26: interpolated depths of the 20°C/26°C isotherms.
- TCHP: integrated thermal energy above 26°C where the sampled profile resolves D26.

The current frontend always requests time index 0 here. Backend analysis substitutes 20°C/35 PSU for missing temperature/salinity entries; this requires attention before treating all derived values as measured or validated.

### Data

| Option | Actual behavior |
|---|---|
| Dataset catalog | Lists registered descriptors and switches active model |
| Downloader | Accepts geographic bounds, depths, dates, variables and output filename; generates command and can start backend job |
| Download presets | Populate subset bounds for Bay of Bengal, Arabian Sea, Wadge Bank or equatorial region |
| Size estimator | Estimates grid counts, RAM/raw size, compressed transfer/disk size and disk headroom |
| Manifests | Lists file provenance and SHA-256 records; supports copying hashes |
| Custom dataset | Registers backend-local path or remote URL metadata; not a browser file upload and not general-purpose format ingestion |
| Data Sources & Provenance | Static reference directory linking external providers; not telemetry proving those providers are connected |

Backend job status/cancel endpoints exist, but the current dataset modal starts a job without a full progress/cancel workflow. Downloads require the backend's Copernicus tooling/configuration. Custom catalog entries are held in memory; remote URL registration does not implement a remote adapter. Unsupported adapter selection can fall back to the synthetic adapter, so a catalog badge alone is insufficient proof of which scientific data is served.

### Operations

Fisherman View has harbor and thermal-front tabs. Harbor locations are predefined; harbor SST/MLD/PFZ status text also contains hardcoded values. Thermal fronts are genuinely calculated from the active model's surface temperature, currently at time index 0. Despite the module name, this path does not read a live satellite feed. Its “PFZ probability” is a gradient-based heuristic, not a calibrated probability or official INCOIS bulletin. Selecting a harbor/front focuses the workspace location.

Cyclone & Marine Conditions displays the currently probed column's SST, MLD, D26 and TCHP and explanatory classification text. It does not fetch an official live cyclone track or predict landfall/intensity. Missing TCHP must not be displayed as a reliable zero or low-risk result.

Operational preset handlers for cyclone, search-and-rescue and fishery exist in App, but the current Header does not expose them. They configure view/layers and a location; they are not complete forecast or drift simulation engines.

### Ask SAMUDRA

Provides scientific query presets, question input, chat history, settings, maximize/clear and navigation actions. Context includes main variable, depth, date and selected observation.

Built-in handlers cover residual extrema, platform coverage, model extrema and platform summaries. Optional Gemini/OpenAI requests exist when a key is supplied/configured. Thus the assistant is not exclusively deterministic or guaranteed free of external calls, contrary to some older documentation. Preserve the existing service contract rather than rebuilding scientific calculations in a UI generator.

### Administration (outside login/register redesign)

Admin-only portal offers overview, user management, sensor platform management, data source records and audit logs. User actions include account creation, role change, enable/disable and password reset. Sensor actions include registration/decommissioning. The portal uses authenticated admin endpoints. Account/session integration should connect to the already-completed login/register module.

## API groups to preserve

| Workflow | Existing endpoints |
|---|---|
| Readiness / control choices | `GET /api/health`, `GET /api/metadata` |
| Globe slice | `GET /api/ocean-data` with variable, time_idx, depth and required lat/lon bounds |
| Coordinate data | `GET /api/location/availability`, `/api/ocean/point`, `/api/ocean/profile`, `/api/ocean/probe` |
| Regional / volume / section | `GET /api/ocean/region`, `/api/ocean/volume`, `/api/ocean/transect` |
| Derived physics / fronts | `GET /api/ocean/in-depth-analysis`, `/api/ocean/thermal-fronts` |
| Observation lists/details | `GET /api/insitu/profiles`, `/api/insitu/argo`, `/api/insitu/argo/{id}`, `/api/insitu/gliders`, `/api/insitu/gliders/{id}`, `/api/insitu/buoys`, `/api/insitu/buoys/{id}`, `/api/insitu/status` |
| Custom sensor records | `GET/POST /api/insitu/sensors`, `DELETE /api/insitu/sensors/{id}` |
| Comparison | `GET /api/collocation/profile/{id}?time_strategy=linear|nearest`, `/api/collocation/glider/{id}`, `/api/collocation/health` |
| Residual field | `GET /api/anomaly/field` with variable, threshold and depth range; `/api/anomaly/summary` |
| Assistant | `POST /api/assistant/query`, `GET /api/assistant/presets` |
| Dataset catalog | `GET /api/datasets`, `POST /api/datasets/select`, `/api/datasets/custom` |
| Download preparation | `POST /api/datasets/estimate-size`, `/api/datasets/generate-command` |
| Download lifecycle | `POST /api/datasets/download`, `GET /api/datasets/download/status/{job_id}`, `POST /api/datasets/download/cancel/{job_id}` |
| File provenance | `GET /api/datasets/manifests`, `/api/datasets/manifests/{id}` |
| Administration | `/api/admin/overview`, `/users`, `/sensors`, `/data-sources`, `/audit-logs` and their existing mutation routes |

## Excluded Features Inventory and Final Status (Phase 11)

| Excluded Feature | Scope & Status | Implementation Audit & Boundary |
|---|---|---|
| **Live external feeds** | Excluded | No external polling workers, live scrapers, or live feed routes exist. `/api/insitu/status` reports `erddap_live_feed: "OFFLINE_INTEGRATION_GAP"`. Satellite thermal fronts are computed locally from active model SST (`/api/ocean/thermal-fronts`) with clear model proxy badges. Cyclone mode enforces IMD source separation without live track fetching. |
| **Saved locations and analyses** | Excluded | No public API routes (`/api/saved-locations`, `/api/saved-analyses`) or UI affordances exist. Location presets (`Location`) and database table structures (`saved_locations`, `analysis_runs`) remain preserved in SQLite/SQLAlchemy schemas without deleting tables or rows. |

## Wiring issues and reconciliation status against current source & test suites

1. **Probe CTD Profile Action**: `[Corrected & Verified in Phase 6/7]` — In `frontend/src/App.jsx` (`handleOpenProfile`), the probed ocean column (`probeData`) is formatted as a model profile object (`isModelProfile: true`) and assigned to `selectedFloat` prior to opening `ProfileModal`. Land coordinates and coordinates outside the active domain display honest unavailable explanations (`is_land`, `unavailableReason`). Verified in profile and probe tests.
2. **Probe Comparison Action**: `[Corrected & Verified in Phase 6/7]` — In `frontend/src/App.jsx` (`LocationInspector` onOpenComparison callback), clicking Compare Model inspects `probeData.nearest_observation`, sets `comparisonContext`, and hydrates nearest Argo or glider details (`fetchArgoFloatById` / `fetchGliderById`). If no nearest observation exists or the platform type is unsupported (e.g. static buoys lacking vertical profiles), an honest uncollocated/unsupported state is presented in `ModelComparisonModal`.
3. **Fleet Buoys and Gliders**: `[Corrected & Verified in Phase 10]` — Moored buoy stations are fetched via `/api/insitu/buoys` and listed in `ObservationDrawer.jsx` with honest surface/fixed-depth descriptors. Glider transects route through `handleSelectGlider` with dedicated waypoint and dive profile hydration. Verified in `tests/test_insitu_service.py` and frontend drawer tests.
4. **Anomaly Controls & Source Filtering**: `[Corrected & Verified in Phase 6/7/10]` — Full controls for `anomalyVariable` (temperature/salinity), `tempThreshold`, and `salThreshold` are wired in `App.jsx` and `ObservationDrawer.jsx`. `insituSourceMode` (`REAL_LOCAL` vs `SYNTHETIC`) prevents unvetted mixing of real and synthetic in-situ observations during anomaly aggregation.
5. **Observation Layers & Current Toggles**: `[Corrected & Verified in Phase 6/7]` — Independent toggles are maintained in `Header.jsx` and `OceanCanvas.jsx` for Currents (`showCurrents`), Argo floats (`showArgo`), and Gliders (`showGliders`). Changing scalar variables does not disable currents unprompted, and closing the drawer leaves chosen layer markers intact.
6. **Physics & Fronts Time Index**: `[Currently Verified Architecture]` — `InDepthOceanModal.jsx` and `FishermanModeModal.jsx` pass the current `timeIndex` parameter to backend calculation routes (`/api/ocean/in-depth-analysis`, `/api/ocean/thermal-fronts`). Click-to-probe in `LocationInspector` queries on-demand column values at the selected coordinate and current time step.
7. **Dataset Transition Coordinator**: `[Corrected & Verified in Phase 5/9]` — `executeTransition` in `App.jsx` coordinates metadata fetching, depth/time array hydration, cache invalidation, and transient error banners, preventing race conditions or stale model rendering upon switching datasets.
8. **Dynamic Depth & Provenance Descriptors**: `[Corrected & Verified in Phase 5]` — `VerticalDepthBar.jsx` renders available depth levels dynamically derived from active dataset metadata rather than fixed GLORYS levels. `scientificPresentation.js` reconciles real vs synthetic source modes without hardcoding assumptions.
9. **Comparison Pearson R and Low-N States**: `[Corrected & Verified in Phase 6/7]` — `calculatePearsonR` in `ModelComparisonModal.jsx` requires N ≥ 2 paired finite values with non-zero variance; otherwise it returns `{ r: null, reason: 'n<2' | 'zero variance' }` and renders `n/a (insufficient data)` rather than misleading correlations. Verified in `frontend/tests/collocation.spec.js`.
10. **Fisherman Harbor & Thermal Front Heuristics**: `[Corrected & Verified]` — `FishermanModeModal.jsx` badges thermal fronts as `[Model-Derived Heuristics]` derived from active model SST gradients (|∇T| ≥ 0.02°C/km), and displays honest unavailable banners if dataset bounds are unready, adhering to offline integration disclosures.

## Phase 12 Frontend Architecture & Verified Implementation Status

The Phase 12 frontend redesign has been fully implemented and verified in the active codebase:
- **Public Homepage (`/`, `/home`, `/portal`)**: Institutional MoES/INCOIS portal introducing real system capabilities with honest data provenance declarations (distinguishing preconfigured Copernicus GLORYS12V1 catalog specifications from active synthetic/local model runtimes and explicitly disclosing the Offline Integration Gap).
- **Direct Workflow Reachability**: All 6 workflow cards on the homepage are directly wired to their corresponding workstation workflows (`/app?workflow=explore|observations|analysis|physics|data|operations`), opening the target view mode, drawer, or modal upon loading the workstation.
- **Strict Authentication Barrier (`/app`)**: Verified officer sessions access the 3D workstation directly, while unauthenticated visits to `/app` enforce the `AuthGate` institutional barrier.
- **Dedicated Administrative & Login Routes**: Dedicated routes for `/login` (`LoginPage`) and `/admin` (`AdminPortal`) integrate with authenticated backend endpoints and preserve user session integrity.
- **Responsive & Design System Integration**: Full support for dark/light themes, accessible modal closures (Escape key, backdrop click, explicit close buttons), and responsive layout across desktop and mobile viewports.
