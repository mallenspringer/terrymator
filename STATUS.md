# Project Status — Terrymator

## Gate Checkpoint Report

```text
Gate: G5 (complete — MVP Gates G0–G5 complete)
Requirement IDs completed: CUT-01..06, MAT-01..06, STG-01..05, RIG-01..03, ANI-01..06, FX-01..03, IO-01..05, EXP-01..05
Changed modules and decisions:
- Effects commands & filter blending: src/domain/commands.ts (SET_GLOBAL_SHADOW_ANGLE, BATCH_SET_GROUP_EFFECTS), src/render/pixiAdapter.ts (linear tintAmount matrix blending preserving alpha)
- Effects & Production Export UI: src/ui/LayersInspectorPanel.tsx (FX-01..03 controls, Apply FX to Descendants, Global Shadow Angle), src/ui/ExportModal.tsx (capability probing, format/range/res/fps/alpha/matte controls, warnings, dedicated disposable renderer, AbortController cancel, progress, downloadBytes), src/ui/App.tsx (Export button, keyboard shortcuts Space/ArrowLeft/ArrowRight/Delete/Ctrl+E/Escape)
- Fixtures & bundle check: src/test-harness/fixtures.ts (F07_LIGHTING, F10_STRESS_SCENE 100 pieces / 5 rigs / 1920x1080 / 30s), scripts/verify-prod-bundle.mjs

Commands run and results (actual counts and skip reasons):
- npm run lint: PASSED (0 errors)
- npm run typecheck: PASSED (0 errors)
- npm run test:unit: PASSED (14 files, 49 tests)
- npm run test:integration: PASSED (9 files, 18 tests — includes 13 F11 malformed/corrupt/unsafe archive cases)
- npm run test:browser (Playwright Chromium, SwiftShader Vulkan): PASSED (10 files, 10 tests)
- npm run test:browser:chrome (Desktop Chrome, GTX 1660 Ti D3D11): PASSED (10 files, 10 tests)
- npm run test:browser:edge (Desktop Edge, GTX 1660 Ti D3D11): PASSED (10 files, 10 tests)
- npm run test:e2e Pass #1 (Playwright Chromium): PASSED (5 files, 5 tests)
- npm run test:e2e Pass #2 (Playwright Chromium, consecutive): PASSED (5 files, 5 tests)
- npm run test:replay: PASSED (6 files, 6 tests)
- npm run test:bench: PASSED (2 files, 2 tests)
  - G0 Smoke: eval median=0.031ms p95=0.084ms | archive roundtrip median=3.60ms p95=8.26ms
  - F10 Baseline (100 pieces, 5 rigs, 1920x1080): setup=19.59ms | eval(FX) median=0.573ms p95=1.203ms | eval(noFX) median=0.544ms p95=0.917ms | archive write=10.91ms read=36.63ms size=5.6KB
- npm run build && npm run verify:bundle: PASSED (6 built files verified; zero harness tokens or unexpected external URLs)

Fixtures / regressions added:
- F07 Lighting (src/test-harness/fixtures.ts, tests/unit/effectsG5.test.ts, tests/browser/g5-effects-export.spec.ts, tests/fixtures/replays/g5_effects_replay.json, tests/replay/g5Replay.test.ts)
- F10 Stress Scene (src/test-harness/fixtures.ts, tests/browser/g5-effects-export.spec.ts, tests/bench/f10BaselineBench.test.ts)
- F11 Broken Files (tests/integration/f11BrokenFiles.test.ts)
- Full 2-pass Authoring-to-Export E2E (tests/e2e/g5-full-workflow.spec.ts)

Manual or hardware checks outstanding:
- DaVinci Resolve smoke check on G0/G5 exported artifacts (artifacts/g0/f09-chrome.mp4, f09-chrome.mov, f09-png-seq-chrome.zip).
- Interactive desktop smoke walkthrough (open `npm run dev` or `npm run preview` and verify live visual polish).

Known defects / limitations:
- See BUGS.md.

Next smallest task:
- MVP Gates G0–G5 are complete. Perform the manual DaVinci Resolve import check and desktop smoke walkthrough when ready.
```

## Requirement Tracking Matrix

| ID | Area | Status | Gate |
|---|---|---|---|
| CUT-01..06 | Cutting room | Complete | G1–G2 |
| MAT-01..06 | Material workshop | Complete | G2 |
| STG-01..05 | Stage, library, layers, camera & repeating tiles | Complete | G1–G4 |
| RIG-01..03 | Rigging, preserve-world & portable rigs | Complete | G3 |
| ANI-01..06 | Timeline, keyframes, loops & sampling rates | Complete | G4 |
| FX-01..03 | Visual effects (Drop Shadow, Outer Glow, Color Adjust + Global Angle + Batch Group FX) | Complete | G0, G5 |
| IO-01..05 | Persistence, recovery, F11 broken-file resilience & `.collageasset` packages | Complete | G1, G3, G5 |
| EXP-01..05 | Export pipeline & production Export Modal (PNG seq ZIP, PNG still, GIF, MP4, MOV, WebM) | Complete | G0, G5 |
