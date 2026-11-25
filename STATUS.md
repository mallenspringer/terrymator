# Project Status — Terrymator

## Gate Checkpoint Report

```text
Gate: G2 (complete)
Requirement IDs completed: CUT-01..06, MAT-01..06, STG-01..03 (partial — shared asset library/stage/layers across Cutting Room & Material Workshop), IO-01, IO-02, IO-04, IO-05
Changed modules and decisions:
- Cutting & materials cores: src/assets/{cutting,materialSynthesis}.ts
- Domain & store: src/domain/{schema,commands,evaluator}.ts, src/application/{blobStore,asyncJobs,store}.ts
- Workspaces UI: src/ui/{App,AssetLibraryPanel,CuttingRoomWorkspace,MaterialWorkshopWorkspace}.tsx
- Harness & bundle check: src/test-harness/{fixtures,harness}.ts, scripts/verify-prod-bundle.mjs

Commands run and results (actual counts and skip reasons):
- npm run lint: PASSED (0 errors)
- npm run typecheck: PASSED (0 errors)
- npm run test:unit: PASSED (11 files, 34 tests)
- npm run test:integration: PASSED (6 files, 12 tests)
- npm run test:browser (Playwright Chromium, SwiftShader Vulkan): PASSED (5 files, 5 tests)
- npm run test:browser:chrome (Desktop Chrome 159, GTX 1660 Ti D3D11): PASSED (5 files, 5 tests)
- npm run test:browser:edge (Desktop Edge 159, GTX 1660 Ti D3D11): PASSED (5 files, 5 tests)
- npm run test:e2e (Playwright Chromium): PASSED (2 files, 2 tests)
- npm run test:replay: PASSED (3 files, 3 tests)
- npm run test:bench: PASSED (1 file, 1 test — eval median 0.021ms / p95 0.050ms; archive roundtrip median 3.52ms / p95 7.01ms)
- npm run build && npm run verify:bundle: PASSED (6 built files verified; zero harness tokens or unexpected external URLs)

Fixtures / regressions added:
- F01 Color islands (tests/unit/cutting.test.ts)
- F02 Hidden torso (src/test-harness/fixtures.ts, tests/unit/cutting.test.ts, tests/browser/g2-cutting-materials.spec.ts, tests/e2e/g2-workspaces.spec.ts)
- F03 Paper recipe (src/test-harness/fixtures.ts, tests/unit/materials.test.ts, tests/browser/g2-cutting-materials.spec.ts)
- F08 Archive roundtrip (src/test-harness/fixtures.ts, tests/integration/archiveF08.test.ts)
- AsyncJobGuard stale-result regression (tests/unit/asyncJobs.test.ts)
- tests/fixtures/replays/g2_assets_replay.json + tests/replay/g2Replay.test.ts

Manual or hardware checks outstanding:
- DaVinci Resolve smoke check on G0 artifacts (artifacts/g0/f09-chrome.mp4, f09-chrome.mov, f09-png-seq-chrome.zip).

Known defects / limitations:
- See BUGS.md.

Next smallest task:
- Begin Gate G3: Rigging, editable pivots, wireframe/joint overlay, preserve-world reparenting, camera stage projection, repeating tiled backgrounds (static), and portable `.collageasset` packages (RIG-01..03, STG-04/05 static, IO-03, F04/F06).
```

## Requirement Tracking Matrix

| ID | Area | Status | Gate |
|---|---|---|---|
| CUT-01 | Local PNG/JPEG/WebP import (preserve bytes) | Complete | G1 |
| CUT-02..06 | Cutting room (wand, lasso, brush, morphology, clone/paint, multi-cutout) | Complete | G2 |
| MAT-01..06 | Material workshop (shapes, booleans, presets, patterns, photo mask) | Complete | G2 |
| STG-01..03 | Stage, asset library & layer list | Partial (shared library, stage drag/transform, layers/groups complete) | G1–G3 |
| STG-04..05 | Camera & repeating layers | G0 spike (render/eval) / UI pending | G3–G4 |
| RIG-01..03 | Rigging & packages | Not started | G3 |
| ANI-01..06 | Timeline & loops | Not started | G4 |
| FX-01..03 | Visual effects | G0 spike (render filters) / UI pending | G5 |
| IO-01 | Save/open `.collage` ZIP archive | Complete | G1 |
| IO-02 | IndexedDB crash recovery (Recover/Discard) | Complete | G1 |
| IO-03 | Portable `.collageasset` packages | Not started | G3 |
| IO-04 | Archive validation & dirty/destructive prompts | Complete | G1 |
| IO-05 | Per-source attribution/URL notes | Complete | G1 |
| EXP-01..05 | Export pipeline | G0 core validated / UI pending | G0, G5 |
