# Project Status — Terrymator

## Gate Checkpoint Report

```text
Gate: G1 (complete)
Requirement IDs completed: CUT-01, STG-01..03 (partial — asset library, stage pan/zoom/drag/transform/visibility/lock, layer order/grouping/collapse/selection), IO-01, IO-02, IO-04, IO-05
Changed modules and decisions:
- Pure domain: src/domain/{errors,ids,hash,schema,evaluator,hitTest,commands}.ts
- Assets & store: src/assets/sourceImport.ts, src/application/{blobStore,history,store}.ts
- Persistence & recovery: src/persistence/{zip,recovery,fileIO}.ts
- Renderer: src/render/pixiAdapter.ts (editor viewport transform, shot/selection guides, clearTextures)
- Editor UI: src/ui/{App,AssetLibraryPanel,StageViewport,LayersInspectorPanel}.tsx, src/ui/styles.css
- Test harness & bundle check: src/test-harness/{fixtures,harness}.ts, scripts/verify-prod-bundle.mjs

Commands run and results (actual counts and skip reasons):
- npm run lint: PASSED (0 errors)
- npm run typecheck: PASSED (0 errors)
- npm run test:unit: PASSED (8 files, 25 tests)
- npm run test:integration: PASSED (5 files, 11 tests)
- npm run test:browser (Playwright Chromium, SwiftShader Vulkan): PASSED (3 files, 3 tests)
- npm run test:browser:chrome (Desktop Chrome 159, GTX 1660 Ti D3D11): PASSED (3 files, 3 tests)
- npm run test:browser:edge (Desktop Edge 159, GTX 1660 Ti D3D11): PASSED (3 files, 3 tests)
- npm run test:e2e (Playwright Chromium): PASSED (1 file, 1 test)
- npm run test:replay: PASSED (2 files, 2 tests)
- npm run test:bench: PASSED (1 file, 1 test — eval median 0.025ms / p95 0.064ms; archive roundtrip median 3.68ms / p95 9.71ms)
- npm run build && npm run verify:bundle: PASSED (6 built files verified; zero harness tokens or unexpected external URLs)

Fixtures / regressions added:
- tests/unit/{sourceImport,history,hitTest,commandsG1}.test.ts
- tests/integration/{archiveG1,recovery,blobLifecycle}.test.ts
- tests/fixtures/replays/g1_editor_replay.json + tests/replay/g1Replay.test.ts
- tests/browser/g1-lifecycle.spec.ts
- tests/e2e/g1-editor.spec.ts

Manual or hardware checks outstanding:
- DaVinci Resolve smoke check on G0 artifacts (artifacts/g0/f09-chrome.mp4, f09-chrome.mov, f09-png-seq-chrome.zip).

Known defects / limitations:
- See BUGS.md.

Next smallest task:
- Begin Gate G2: Cutting room (CUT-02..06: magic wand, lasso, alpha brush, morphology/feather, clone/color reconstruction, edit-rect extension) and Material workshop (MAT-01..06).
```

## Requirement Tracking Matrix

| ID | Area | Status | Gate |
|---|---|---|---|
| CUT-01 | Local PNG/JPEG/WebP import (preserve bytes) | Complete | G1 |
| CUT-02..06 | Cutting room (wand, lasso, brush, clone) | Not started | G2 |
| MAT-01..06 | Material workshop | Not started | G2 |
| STG-01..03 | Stage, asset library & layer list | Partial (core library, stage drag/transform, layers/groups complete; Cutting/Mat workspaces pending) | G1–G3 |
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
