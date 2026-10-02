# Selected work after Core Phase 03

User decision: 28 September 2026. Implement all eight items from Codex's reviewed remaining-work list except live external feeds and saved locations/analyses. This file supersedes the speculative candidate list in the Phase 03 report. Approval means selected for implementation, not already complete.

| Work | Importance | Simple meaning | Status |
|---|---|---|---|
| Real-data verification | 5/5 | Prove the app works against actual local ocean files, beyond mocked browser responses | Blocked: genuine GLORYS file absent; synthetic local-file integration verified in Phase 04 |
| Deep-physics missing-data handling | 5/5 | Stop replacing missing measurements with invented temperature/salinity inputs | Approved: Phase 04 |
| Independent layer controls | 4/5 | Separate switches for currents and observation markers | Accepted after Codex Phase 05 review |
| Anomaly controls and source separation | 4/5 | Select error variable/threshold and keep real and synthetic observations separate | Accepted after Codex Phase 06 review |
| Ocean cross-section workflow | 4/5 | Choose two coordinates and inspect a vertical cut through the ocean | Corrections required after Codex review: assert exact physical scaling, remove minimum-height distortion, and make pending-request tests deterministic |
| Observation-ID search | 3/5 | Search an Argo identifier and select/focus its actual platform | Selected: subsequent reviewed phase |
| Download progress/cancellation | 3/5 | Track dataset downloads through completion/failure and cancel running jobs | Selected: subsequent reviewed phase |
| Buoy observations | 2/5 | Browse supported buoy measurements using an explicit list/detail contract | Selected: subsequent reviewed phase |
| Saved locations and analyses | Excluded | Bookmark/reopen locations or analysis sessions | Do not implement; removal scope awaiting clarification |
| Live external feeds | Excluded | Live cyclone tracks, fishing bulletins or telemetry feeds | Do not implement; removal scope awaiting clarification |

Existing synthetic data and glider profiles are not missing features to duplicate. Animated glider travel was not in the selected reviewed list and is not added by this decision. Lovable redesign remains after selected functionality is reviewed.

Removal question pending: remove unused backend implementation/routes/models plus UI references for the two excluded features, or remove only their UI/feature-list references? Do not delete either category's backend code until clarified. Preserve local historical model/observation readers, dataset downloads, authentication, required shared database models and scientific analysis computations. No database row/table deletion is authorized by this plan.

Workflow: bounded Antigravity instructions -> implementation/report -> user sends ready for review -> independent Codex review -> next bounded handoff. Maintain statuses here as each phase is accepted. All selected work remains in scope across phases; do not silently defer selected buoy or download work.
