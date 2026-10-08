# Codex review: Selected Phase 10 accepted

Review date: 8 October 2026.

## Decision

**Selected Phase 10 is accepted.** The three Phase 10 correction commits resolve the review findings:

- Bundled buoy reference profiles are visibly labeled as illustrative, not live; missing timestamps remain unavailable, and unsupported QC is not fabricated.
- Untagged JSON records loaded from configured local files default to `REAL_LOCAL` with `[REAL • LOCAL_FILE]` provenance.
- Missing QC is a distinct unknown state across the depth-profile graph and T-S diagram. It is not counted as good or bad, measurements remain visible with neutral styling, hover text reports QC unavailable, and actual bad/outlier QC remains distinct.

The reviewed implementation and correction commits are `121664da84e618caf3879139372d9e57d716a877`, `b0d0a309a9ee0bfe2dacc7a9e913f5ec51470984`, `749ca5cc07587ecca519625b6a45e00beaabf641`, and `3f1b5d253b1939c06ac5c92215f38133cd3ba3e2`.

## Independent verification

- `python -m unittest discover -s backend/tests -p "test_*.py"`: **104 passed, 2 skipped**.
- `node tests/test-profile-charts.mjs` (frontend): **6 verification sections passed**.
- `npm.cmd run lint` (frontend): **passed**.
- `npm.cmd run build` (frontend): **passed**; Vite emitted the existing large-chunk advisory.
- `npx.cmd playwright test tests/selected-phase-10.spec.js` (frontend): **4/4 passed**.
- `git show --check 3f1b5d253b1939c06ac5c92215f38133cd3ba3e2`: **passed**.

The backend suite was run outside the restricted sandbox because of its Windows temporary-directory and process-tree needs. The tracked SQLite file was checked after testing and is clean. The broad suite passed with two skips; no claim is made that the blocked genuine-GLORYS real-data verification is complete.

## Progress and next authorized work

This completes the eighth listed selected-work item, Buoy observations (importance 2/5). Six other selected items are marked accepted and deep-physics handling is approved; genuine real-data verification remains blocked because no genuine GLORYS file is available. The user also explicitly requested removal of backend connections/details for the two excluded features. Proceed with that bounded cleanup under `docs/antigravity-selected-phase-11-excluded-feature-cleanup.md`, then stop for review before the Lovable frontend redesign.
