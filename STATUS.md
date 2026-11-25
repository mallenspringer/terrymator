# Project Status — Terrymator

## Gate Checkpoint Report

```text
Gate: G0 (complete — pending human DaVinci Resolve smoke check on artifacts/g0/)
Requirement IDs completed: Foundation only (G0 feasibility, harness, CI, deterministic evaluator/renderer/export spike; no full-editor MVP requirement IDs claimed complete yet)
Changed modules and decisions:
- Scaffolding & tooling: package.json, package-lock.json, tsconfig.json, eslint.config.js, vite.config.ts, vitest.config.ts, playwright.config.ts, .github/workflows/ci.yml, scripts/verify-prod-bundle.mjs
- Pure domain: src/domain/{errors,time,math,schema,evaluator,commands}.ts
- Assets & persistence: src/assets/{pngCodec,synthetic}.ts, src/persistence/zip.ts, src/application/store.ts
- Renderer & export: src/render/{capabilities,pixiAdapter}.ts, src/export/{types,capabilities,gifEncoder,pngEncoder,videoEncoder,pipeline}.ts
- Harness & G0 shell: src/test-harness/{fixtures,harness}.ts, src/ui/App.tsx, src/main.tsx
- Docs: docs/{01_PROJECT_SPEC,02_TECHNICAL_DESIGN,03_AGENT_HANDOFF}.md, README.md, DECISIONS.md, BUGS.md, STATUS.md

Commands run and results (actual counts and skip reasons):
- npm run lint: PASSED (0 errors)
- npm run typecheck: PASSED (0 errors)
- npm run test:unit: PASSED (4 files, 16 tests)
- npm run test:integration: PASSED (2 files, 6 tests)
- npm run test:browser (Playwright Chromium, SwiftShader Vulkan): PASSED (2 files, 2 tests)
- npm run test:browser:chrome (Desktop Chrome 159, GTX 1660 Ti D3D11): PASSED (2 files, 2 tests)
- npm run test:browser:edge (Desktop Edge 159, GTX 1660 Ti D3D11): PASSED (2 files, 2 tests)
- npm run test:e2e (Playwright Chromium): PASSED (1 file, 1 test)
- npm run test:replay: PASSED (1 file, 1 test)
- npm run test:bench: PASSED (1 file, 1 test — eval median 0.022ms / p95 0.055ms; archive roundtrip median 3.36ms / p95 7.30ms)
- npm run build && npm run verify:bundle: PASSED (5 built files verified; zero harness tokens/unexpected URLs)
- Independent decoder verification: ffprobe/ffmpeg 8.1.1 verified MP4 (H.264), MOV (H.264), WebM (VP9), and GIF streams across Chromium, Chrome, and Edge; pngjs verified all 12 PNG sequence frames.

Fixtures / regressions added:
- G0_DEMO (3-level articulated hierarchy, independent global drawOrder, negative-offset mirrored tile, semitransparent border, rotated stage-relative drop shadow + outer glow)
- F09_EXPORT_CLOCK (320x180 @ 24fps, 12 frames, exact moving yellow square + semitransparent square + RGB calibration blocks)
- tests/fixtures/replays/g0_basic_replay.json

Manual or hardware checks outstanding:
- Import artifacts/g0/f09-chrome.mp4, f09-chrome.mov, and f09-frames-chrome/ (or f09-png-seq-chrome.zip) into DaVinci Resolve on target desktop and confirm frame rate (24 fps), dimensions (320x180), duration (0.5s), colors, and PNG transparency.

Known defects / limitations:
- See BUGS.md (H.264 MP4/MOV have no alpha channel; GIF alpha is 1-bit binary).

Next smallest task:
- After human Resolve smoke check of artifacts/g0/, begin Gate G1 (project schema expansion, undo/redo history stack, local image import, IndexedDB recovery, and stage/library shell).
```

## Requirement Tracking Matrix

| ID | Area | Status | Gate |
|---|---|---|---|
| CUT-01..06 | Cutting room | Not started | G1–G2 |
| MAT-01..06 | Material workshop | Not started | G2 |
| STG-01..03 | Stage & library | Not started | G1 |
| STG-04..05 | Camera & repeating layers | G0 spike (render/eval) / UI pending | G3–G4 |
| RIG-01..03 | Rigging & packages | Not started | G3 |
| ANI-01..06 | Timeline & loops | Not started | G4 |
| FX-01..03 | Visual effects | G0 spike (render filters) / UI pending | G5 |
| IO-01..05 | Persistence & recovery | G0 ZIP/hash core / full IO pending | G1, G3 |
| EXP-01..05 | Export pipeline | G0 core validated / UI pending | G0, G5 |
