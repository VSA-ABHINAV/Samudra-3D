# Selected work after Core Phase 03

User decision: 28 September 2026. Implement all eight items from Codex's reviewed remaining-work list except live external feeds and saved locations/analyses. This file supersedes the speculative candidate list in the Phase 03 report. Approval means selected for implementation, not already complete.

| Work | Importance | Simple meaning | Status |
|---|---|---|---|
| Real-data verification | 5/5 | Prove the app works against actual local ocean files, beyond mocked browser responses | Blocked: genuine GLORYS file absent; synthetic local-file integration verified in Phase 04 |
| Deep-physics missing-data handling | 5/5 | Stop replacing missing measurements with invented temperature/salinity inputs | Approved: Phase 04 |
| Independent layer controls | 4/5 | Separate switches for currents and observation markers | Accepted after Codex Phase 05 review |
| Anomaly controls and source separation | 4/5 | Select error variable/threshold and keep real and synthetic observations separate | Accepted after Codex Phase 06 review |
| Ocean cross-section workflow | 4/5 | Choose two coordinates and inspect a vertical cut through the ocean | Accepted after Codex Phase 07 review |
| Observation-ID search | 3/5 | Search an Argo identifier and select/focus its actual platform | Accepted after Codex Phase 08 review |
| Download progress/cancellation | 3/5 | Track dataset downloads through completion/failure and cancel running jobs | Accepted after Codex Phase 09 review |
| Buoy observations | 2/5 | Browse supported buoy measurements using an explicit list/detail contract | Accepted after Codex Phase 10 review |
| Saved locations and analyses | Excluded | Bookmark/reopen locations or analysis sessions | Corrections completed in Phase 11 Correction 01; ready for Codex review |
| Live external feeds | Excluded | Live cyclone tracks, fishing bulletins or telemetry feeds | Corrections completed in Phase 11 Correction 01; ready for Codex review |

Existing synthetic data and glider profiles are not missing features to duplicate. Animated glider travel was not in the selected reviewed list and is not added by this decision. Lovable redesign remains after selected functionality is reviewed.

User-directed cleanup: remove implementation and backend connections/details dedicated to the two excluded features, and update the source feature inventory. Preserve local historical model/observation readers, dataset downloads, authentication, shared database models and scientific analysis computations. Do not delete stored rows or database tables in Phase 11.

Workflow: bounded Antigravity instructions -> implementation/report -> user sends ready for review -> independent Codex review -> next bounded handoff. Maintain statuses here as each phase is accepted. All selected work remains in scope across phases; do not silently defer selected buoy or download work.
