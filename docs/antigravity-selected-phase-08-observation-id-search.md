# Antigravity Selected Phase 08: Argo observation-ID search

Read this file and `docs/selected-features-plan.md` completely. Work in `D:\Samudra 3D\samudra-3d`. Codex accepted Selected Phase 07 in `docs/codex-selected-phase-07-review-04.md`. Implement only the already-selected Observation-ID search feature (importance 3/5): a user can search an Argo WMO/platform ID and select/focus the actual returned platform. Preserve accepted Phases 05-07 and the globe-box fix. Stop for Codex review after a local commit. Do not push or deploy.

## Current implementation to reuse

- `frontend/src/components/Header.jsx` already supports place-name and coordinate search but does not resolve an Argo ID despite its WMO placeholder/comment.
- `frontend/src/services/api.js` exposes `fetchArgoFloatById(floatId)` for `GET /api/insitu/argo/{float_id}`.
- `backend/app/routers/routes_insitu.py` already returns a detailed Argo record or 404; `ArgoProfileDetail` in `backend/app/schemas/insitu.py` includes actual ID, platform type, WMO ID, latitude, longitude, depths, measurements, and QC.
- `frontend/src/App.jsx` has selection/detail loading state and a `FOCUS_PLATFORM` path. Reuse the correct actual ID and returned coordinates; never create a fake coordinate result for an ID lookup.

## Required user behavior

1. Extend the existing global search to accept an Argo WMO ID with or without the `ARGO_` prefix, case-insensitively. Normalize formatting without changing the identifier's meaning.
2. Resolve the exact ID using the existing detail endpoint. Show a clear loading state while searching, a useful not-found/error state on failure, and a selectable result containing the actual platform name/ID and returned coordinates on success.
3. Selecting the result must select the actual Argo profile, enable its marker layer if needed, and focus/probe the returned platform coordinates through existing navigation. The selected profile, marker, coordinates, and profile details must all refer to the API response's actual platform identity.
4. Keep place-name and coordinate search working. Do not reinterpret arbitrary numeric text as an ID unless it matches the supported WMO-ID form. Keep glider IDs, buoy search, and unrelated global search changes out of scope.
5. Prevent stale results: a slower prior ID lookup must not replace a newer query, clear newer results, or select a platform after the user edits/clears the query. Do not show a previous successful result under a new query.
6. Preserve clear keyboard behavior: Enter submits/resolves an exact ID or selects the first existing place/coordinate suggestion; Escape closes suggestions; accessible labels and loading/error status remain readable.

## Tests and evidence

Add `frontend/tests/selected-phase-08.spec.js` with assertions for:

- exact WMO ID and `ARGO_` prefix/case normalization;
- successful detail lookup, rendered actual platform identity/coordinates, selection, marker enablement, and focus/probe behavior;
- 404/invalid response and retry/recovery;
- held old lookup followed by query edit or newer lookup, proving stale results cannot publish/select;
- existing coordinate and place search regressions;
- keyboard submission and dismissal.

Use backend-schema-faithful detail fixtures. Do not assert only that an API request occurred: inspect the rendered selected profile/platform identity and verify the focus/probe request uses the returned coordinates. Capture concise screenshots for the successful ID result and error/retry state in `frontend/test-results` or the existing evidence folder, and list the exact evidence paths in the report.

Avoid arbitrary sleeps. Use observable request, loading, and render states. If backend/API changes prove necessary, add a focused backend contract test; otherwise leave backend files untouched.

## Verification, report, and commit

After final changes:

1. From `frontend`: `npm.cmd run lint`
2. From `frontend`: `npm.cmd run build`
3. From `frontend`: `node --test tests/transitionQueue.test.js`
4. From repo root: `.\.venv\Scripts\python.exe -m unittest backend.tests.test_anomaly backend.tests.test_collocation backend.tests.test_probe_transect`
5. From `frontend`, run one combined Playwright suite with `tests/globe-box.spec.js`, `tests/selected-phase-05.spec.js`, `tests/selected-phase-06.spec.js`, `tests/selected-phase-07.spec.js`, the new `tests/selected-phase-08.spec.js`, and all six Core Phase 01-04 specs including contract and identity review specs.
6. From repo root: `git diff --check`.

Update `docs/selected-features-plan.md` and create `docs/antigravity-selected-phase-08-report.md` with changed files, exact commands/results, test counts, screenshots, and limits. Mark Phase 08 READY FOR CODEX REVIEW, never Accepted. If any check fails, fix it and rerun affected checks plus the combined browser suite. When all checks pass, stage only Phase 08 implementation/tests/report/plan files and create one local Git commit; exclude `.codex-worktrees`, data/database files, generated artifacts, and unrelated files. Record the final commit hash after committing. Do not push, deploy, or begin the download-progress/cancellation feature. Stop and ask the user to send `ready for review`.
