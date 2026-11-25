# Project Status — Terrymator

## Gate Checkpoint Report

```text
Gate: G4 (complete)
Requirement IDs completed: CUT-01..06, MAT-01..06, STG-01..05, RIG-01..03, ANI-01..06, IO-01..05
Changed modules and decisions:
- Pure timeline & loops: src/domain/{clock,schema,evaluator,commands,errors}.ts (quantizeTickToFps, resolveNodeSampling, resolveApplicableLoop, evaluateLoopTick, DELETE_KEY/MOVE_KEY/DUPLICATE_KEY/SET_KEY_INTERPOLATION/CAPTURE_POSE_KEYS/UPSERT_LOOP_SCOPE/DELETE_LOOP_SCOPE/SET_NODE_SAMPLING/SET_SHOT_TIMING)
- Draft & timeline UI: src/ui/{draftState,TimelinePanel,LayersInspectorPanel,App}.tsx, src/ui/styles.css
- Harness & bundle check: src/test-harness/fixtures.ts (F05_WALKING_LOOP), scripts/verify-prod-bundle.mjs

Commands run and results (actual counts and skip reasons):
- npm run lint: PASSED (0 errors)
- npm run typecheck: PASSED (0 errors)
- npm run test:unit: PASSED (13 files, 46 tests)
- npm run test:integration: PASSED (8 files, 17 tests)
- npm run test:browser (Playwright Chromium, SwiftShader Vulkan): PASSED (8 files, 8 tests)
- npm run test:browser:chrome (Desktop Chrome 159, GTX 1660 Ti D3D11): PASSED (8 files, 8 tests)
- npm run test:browser:edge (Desktop Edge 159, GTX 1660 Ti D3D11): PASSED (8 files, 8 tests)
- npm run test:e2e (Playwright Chromium): PASSED (4 files, 4 tests)
- npm run test:replay: PASSED (5 files, 5 tests)
- npm run test:bench: PASSED (1 file, 1 test — eval median 0.027ms / p95 0.069ms; archive roundtrip median 3.30ms / p95 6.80ms)
- npm run build && npm run verify:bundle: PASSED (6 built files verified; zero harness tokens or unexpected external URLs)

Fixtures / regressions added:
- F05 Walking loop (src/test-harness/fixtures.ts, tests/unit/clockLoops.test.ts, tests/integration/timelineG4.test.ts, tests/browser/g4-timeline-loops.spec.ts)
- tests/fixtures/replays/g4_timeline_replay.json + tests/replay/g4Replay.test.ts
- tests/e2e/g4-timeline.spec.ts

Manual or hardware checks outstanding:
- DaVinci Resolve smoke check on G0 artifacts (artifacts/g0/f09-chrome.mp4, f09-chrome.mov, f09-png-seq-chrome.zip).

Known defects / limitations:
- See BUGS.md.

Next smallest task:
- Begin Gate G5: Effects controls (FX-01..03), full Export UI & production pipeline (EXP-01..05), F07/F10/F11 benchmarks & negative cases, keyboard/accessibility polish, and final verification.
```

## Requirement Tracking Matrix

| ID | Area | Status | Gate |
|---|---|---|---|
| CUT-01..06 | Cutting room | Complete | G1–G2 |
| MAT-01..06 | Material workshop | Complete | G2 |
| STG-01..05 | Stage, library, layers, camera & repeating tiles | Complete | G1–G4 |
| RIG-01..03 | Rigging, preserve-world & portable rigs | Complete | G3 |
| ANI-01..06 | Timeline, keyframes, loops & sampling rates | Complete | G4 |
| FX-01..03 | Visual effects | G0 spike (render filters) / UI pending | G5 |
| IO-01..05 | Persistence, recovery & `.collageasset` packages | Complete | G1, G3 |
| EXP-01..05 | Export pipeline | G0 core validated / UI pending | G0, G5 |
