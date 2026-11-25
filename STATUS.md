# Project Status — Terrymator

## Gate Checkpoint Report

```text
Gate: G3 (complete)
Requirement IDs completed: CUT-01..06, MAT-01..06, STG-01..03, STG-04/05 (static portions — shot camera & repeating tile layers; animation pending G4), RIG-01..03, IO-01..05
Changed modules and decisions:
- Pure domain rigging: src/domain/{errors,math,evaluator,commands}.ts (decomposeAffineToTRS, compensatePivotChange, joints, preserve-world pivot/reparent, DUPLICATE_SUBTREE, SET_NODE_TILE_PARAMS, IMPORT_PACKAGE_PAYLOAD)
- Portable packages: src/persistence/assetPackage.ts, src/application/store.ts
- Renderer: src/render/pixiAdapter.ts (optional editor wireframe/joint overlay, never exported)
- Studio UI: src/ui/{App,AssetLibraryPanel,StageViewport,LayersInspectorPanel}.tsx
- Harness & bundle check: src/test-harness/{fixtures,harness}.ts, scripts/verify-prod-bundle.mjs

Commands run and results (actual counts and skip reasons):
- npm run lint: PASSED (0 errors)
- npm run typecheck: PASSED (0 errors)
- npm run test:unit: PASSED (12 files, 39 tests)
- npm run test:integration: PASSED (7 files, 15 tests)
- npm run test:browser (Playwright Chromium, SwiftShader Vulkan): PASSED (7 files, 7 tests)
- npm run test:browser:chrome (Desktop Chrome 159, GTX 1660 Ti D3D11): PASSED (7 files, 7 tests)
- npm run test:browser:edge (Desktop Edge 159, GTX 1660 Ti D3D11): PASSED (7 files, 7 tests)
- npm run test:e2e (Playwright Chromium): PASSED (3 files, 3 tests)
- npm run test:replay: PASSED (4 files, 4 tests)
- npm run test:bench: PASSED (1 file, 1 test — eval median 0.022ms / p95 0.059ms; archive roundtrip median 4.10ms / p95 8.30ms)
- npm run build && npm run verify:bundle: PASSED (6 built files verified; zero harness tokens or unexpected external URLs)

Fixtures / regressions added:
- F04 Jointed puppet (src/test-harness/fixtures.ts, tests/unit/rigging.test.ts, tests/browser/g3-rig-camera-tile.spec.ts)
- F06 Parallax (src/test-harness/fixtures.ts, tests/browser/g3-rig-camera-tile.spec.ts)
- .collageasset package & F04/F06 archive integration (tests/integration/assetPackage.test.ts)
- tests/fixtures/replays/g3_rig_replay.json + tests/replay/g3Replay.test.ts
- tests/e2e/g3-rigging.spec.ts

Manual or hardware checks outstanding:
- DaVinci Resolve smoke check on G0 artifacts (artifacts/g0/f09-chrome.mp4, f09-chrome.mov, f09-png-seq-chrome.zip).

Known defects / limitations:
- See BUGS.md.

Next smallest task:
- Begin Gate G4: Timeline, keyframes, manual/auto-key draft workflow, pose capture, loop clocks/priority, sampling overrides, playback/scrub/range, camera & tile animation (ANI-01..06, STG-04/05 animation, F05/F09).
```

## Requirement Tracking Matrix

| ID | Area | Status | Gate |
|---|---|---|---|
| CUT-01..06 | Cutting room | Complete | G1–G2 |
| MAT-01..06 | Material workshop | Complete | G2 |
| STG-01..03 | Stage, asset library & layer list | Complete | G1–G3 |
| STG-04..05 | Camera & repeating layers | Static complete / Animation pending G4 | G3–G4 |
| RIG-01..03 | Rigging, preserve-world & portable rigs | Complete | G3 |
| ANI-01..06 | Timeline & loops | Not started | G4 |
| FX-01..03 | Visual effects | G0 spike (render filters) / UI pending | G5 |
| IO-01..05 | Persistence, recovery & `.collageasset` packages | Complete | G1, G3 |
| EXP-01..05 | Export pipeline | G0 core validated / UI pending | G0, G5 |
