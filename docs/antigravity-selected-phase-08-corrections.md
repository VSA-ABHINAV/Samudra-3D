# Antigravity Selected Phase 08 Corrections

Read this file, `docs/antigravity-selected-phase-08-observation-id-search.md`, `docs/antigravity-selected-phase-08-report.md`, and `docs/selected-features-plan.md` completely. Correct only the Phase 08 review findings below, preserve accepted work, run the required verification, update the report, and stop for Codex review. Do not push or deploy.

## Required corrections

1. **Escape must dismiss pending search results.** In `frontend/src/components/Header.jsx`, pressing Escape must abort an in-flight Argo detail request and invalidate its request generation before clearing the dropdown/loading/error state. A response arriving after Escape must not republish results. Add a deterministic browser test that holds the detail request, presses Escape, releases the response, and confirms the dropdown stays closed. Use an explicit route settlement signal; do not use a fixed sleep.

2. **Validate detail responses before rendering/selecting.** Accept an Argo result only when the returned record has `platform_type === 'argo'`, a non-empty string `id`, a non-empty name or safe display fallback, and finite latitude/longitude within geographic bounds. Do not accept arbitrary payloads merely because they contain an `id`. Add tests for a non-Argo payload and invalid/missing coordinates; show a readable error/not-found state and allow a later valid query to recover.

3. **Keep parsing to the selected WMO-ID scope.** `parseArgoQuery` currently accepts arbitrary prefixed tokens such as `ARGO_TEST_QC_OUTLIER`. Restrict it to the agreed 5–7 digit numeric WMO form, with optional `ARGO`, underscore, space, or hyphen prefix and case-insensitive matching. Keep ordinary numbers outside that range and arbitrary text out of the Argo lookup path. Do not add buoy, glider, or other global search behavior.

4. **Make the stale-response test deterministic.** Replace the fixed `page.waitForTimeout(500)` in `frontend/tests/selected-phase-08.spec.js` with explicit request-start and response-release promises, then assert that the stale response cannot replace or select the newer result. Keep the Escape-after-held-request test from item 1 separate.

5. **Correct the phase report evidence.** The listed combined Playwright breakdown adds up to **81**, not 77. Rerun the exact combined suite and record the actual total and per-spec counts. The report says commit `df270f7`, but checked-out HEAD is `368229f0ca12b92584cd1813af07ac4f169c72bb`; confirm the actual Phase 08 commit and correct the report's commit field. Record exact verification commands/results and evidence paths. Do not claim any check that was not rerun.

## Verification and stop condition

Run the six verification gates in the Phase 08 implementation handoff: frontend lint, production build, transition queue unit test, backend anomaly/collocation/probe-transect tests, combined Playwright suite, and `git diff --check`. Rerun all affected checks after fixes. Update the Phase 08 report and plan status to READY FOR CODEX REVIEW only when all pass. Stage only Phase 08 implementation/tests/report/plan files plus this correction instruction if appropriate, create one local commit, and record its full hash. Exclude `.codex-worktrees`, databases, generated artifacts, and unrelated work. Preserve existing unrelated untracked files. Do not start Download progress/cancellation, push, or deploy. Stop for Codex review.
