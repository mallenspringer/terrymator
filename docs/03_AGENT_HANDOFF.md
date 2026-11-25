# Collage Studio — Coding-agent handoff and validation plan

**Version:** 0.1 · 2026-11-25  
Read `01_PROJECT_SPEC.md` and `02_TECHNICAL_DESIGN.md` before editing. Implement sequentially with one primary coding agent. This document is the execution plan, not permission to expand product scope. No app code has been written or tested as part of this documentation handoff.

## 1. Working agreement

- Build small end-to-end increments, not all UI panels or infrastructure at once. Finish one gate before starting the next. Maintain a working application at each checkpoint.
- Tests are deliverables, not optional cleanup. Write a failing regression test before fixing a reproducible bug when practical. Never weaken an assertion, skip a test, increase image tolerance or regenerate a golden merely to make CI pass.
- Do not implement deferred features without approval. Choose simple reversible defaults for minor details; record material changes in `DECISIONS.md`. Preserve the approved workflow and data model.
- Do not make a release or completion claim based on compilation alone. Distinguish tests actually run, passed, failed, skipped, unavailable, and manual checks outstanding. No invented benchmark numbers or codec support.
- Use local dependencies and fixtures. No network runtime or telemetry. No real user artwork in checked-in tests. Do not add dependencies for trivial functions. Pin versions; document dependency choices and licenses.
- The agent owns implementation and automated checks. A human reviews creative UX and visual baseline changes and performs real-device/Resolve checks when unavailable to the agent.

## 2. Required repo scaffolding (first increment)

Create a minimal Vite/TypeScript/React project, strict TypeScript, lint/format configuration, lockfile, fixture generator, CI workflow, test harness and scripts. Add root `README.md` with install/run/test instructions, `STATUS.md` with requirement IDs and gates, `DECISIONS.md`, and `BUGS.md` or issue records. Copy these three planning files into `docs/`. Use conventional commits or clear checkpoint commits if a git repository is available. Do not overwrite existing user work.

Required commands (implement aliases if needed):

| Command | Purpose |
|---|---|
| `npm ci` | reproducible install |
| `npm run dev` | local app and dev harness |
| `npm run build` | production build, test bridge excluded |
| `npm run typecheck` | strict TS checks |
| `npm run lint` | static checks |
| `npm run test:unit` | pure domain, math, processing |
| `npm run test:integration` | project commands, blobs, archives, evaluator |
| `npm run test:browser` | real browser rendering/asset/codec integration |
| `npm run test:e2e` | Playwright UI flows |
| `npm run test:replay` | regression command logs and fixture cases |
| `npm run test:bench` | performance and lifecycle benchmark (separate from fast suite) |
| `npm run verify` | lint, types, unit, integration, browser, E2E, replay, build |

Use Vitest for Node tests and Playwright Chromium for browser/render/E2E tests; actual Chrome and Edge channels for release checks when available. Document install for Playwright browsers. CI executes on each commit/PR, in a pinned environment. Preserve test artifacts on failure (screenshots, traces, structured logs, exported sample files, image diffs). Avoid relying on sleep; wait on state or actual completion. Keep tests independent and reset local storage between cases. Use software WebGL in CI only if actually functional; verify real GPU separately. Browser availability failures are visible gate blockers, not passing results. CI must fail on missing mandatory PNG/WebGL tests, and report capability-based video skips as separate not-verified statuses. Production bundle must exclude harness bridge/fixtures and not call external hosts.

## 3. Validation harness (foundational, not a late feature)

Three testing surfaces:

1. **Pure domain runner:** load validated project fixture and blobs (memory implementation), apply command sequence, assert canonical snapshot and evaluated draw list at exact ticks. No DOM/GPU.
2. **Real browser render harness:** mount actual Pixi adapter, fixture assets, explicit camera/time; render and extract PNG/RGBA; query resource counts. No manual clicks needed. Uses real project evaluator and render pipeline.
3. **UI E2E harness:** Playwright interacts with stage, timeline, controls, file picker and downloads, asserts actual saved state and rendered output. Use stable accessible roles/labels or test IDs, not brittle DOM selectors.

Dev/test bridge contract (names illustrative, implement and document):

```ts
interface StudioHarness {
  loadFixture(id: string): Promise<void>;
  loadArchive(bytes: Uint8Array): Promise<void>;
  dispatch(command: Command): Promise<CommandResult>;
  snapshot(): CanonicalProject;
  evaluate(tick: number): EvaluatedScene;
  render(tick: number, options: RenderOptions): Promise<FrameArtifact>;
  exportRange(options: ExportOptions): Promise<ExportArtifact>;
  replay(log: ReplayLog): Promise<ReplayReport>;
  resources(): ResourceCounters;
}
```

Replay format: schema version, fixture ID/hash, PRNG seed if applicable, ordered validated commands with explicit IDs and times, expected outcomes/checkpoints, optional named frame captures. Include minimal environment metadata (app revision, browser, renderer, OS, codec capabilities). Commands must be serializable and not depend on wall time or pointer trajectory except explicit sampled stroke points. Replay uses the same command dispatcher as UI; add a recorded failing case to `tests/fixtures/replays/`. Never collect user projects automatically; diagnostics export is opt-in and local, and uses synthetic fixtures unless user explicitly supplies a file.

### Reference fixtures

| Fixture | Content / reason |
|---|---|
| F01 Color islands | Tiny RGBA grid with same-color disconnected regions, transparent pixels, antialiasing; flood fill/color removal/mask arithmetic |
| F02 Hidden torso | Synthetic striped torso partially covered by arm; independently extracted pieces; clone/restore reconstructs torso |
| F03 Paper recipe | Seeded materials, subtracted ellipse, polygon, imported checker texture; stable anchor, repeatability |
| F04 Jointed puppet | Torso, overlapping limbs, three-level hierarchy, offset pivots, signed scale, independent Z order |
| F05 Walking loop | Outer travelling group, inner repeating rig, arm ping-pong override, stepped head and smooth parent |
| F06 Parallax | Three repeating layers, non-square tiles, negative offset, mirrored repeat and camera zoom |
| F07 Lighting | Overlapping transparent pieces, semitransparent edges, glow/shadow near frame edge, direction override |
| F08 Archive | Multiple source-sharing assets, clone overlays, unique copy, seeded material, rig, loops, camera, all effect settings |
| F09 Export clock | Small colored moving squares and frame-identifying pattern, exact expected frame count/timestamps/alpha |
| F10 Stress scene | Procedurally generated 100 visible pieces/5 rigs, 30 s at 1080p; stretch variant 500/20 at 4K |
| F11 Broken files | Invalid schemas, cycles, missing blobs, wrong hash, future version, bad PNG, traversal and bounded zip bomb simulation |

Use self-authored/synthetic assets, not copyrighted reference images. For tiny fixtures keep expected arrays/coordinates as hand-computed or independent oracle values (never only snapshot the implementation under test). Fix fixture seeds and IDs. Golden images are reviewed outputs, not the sole source of truth. Include a simple authored reference shot as an integration demo after G4.

### Comparison policy

- Domain: exact IDs, ordering, flags, ticks, key counts and hashes; numeric tolerances only for floating-point math (initial ~1e-6 relative/absolute as appropriate). Test matrix composition against independent known points.
- Pixel algorithms: exact RGBA/alpha arrays for synthetic examples with defined rounding; explicit tests for clipping, edge coverage, source sampling, anti-aliased edges and zero alpha. Do not compare hidden RGB under alpha=0 as meaningful visible color unless contract demands it.
- GPU rendering: fixed resolution, device scale factor, browser/renderer, texture sampling and scene; no editor overlays or browser fonts in scene goldens. Begin with pixel tolerance of 3/255 per channel and no more than 0.5% pixels exceeding tolerance for simple scenes; measure and document separately justified tolerances for filters. Use premultiplied or composited comparison consistently. Add targeted alpha/region/landmark/order assertions; a global threshold alone can hide missing small limbs. Pin baseline environment, allow differences in real GPU checks without masking meaningful defects. Human review is required to approve first baselines and changes.
- Exports: inspect file signatures, dimensions, codec/container, PTS/frame count/duration, loop flag and alpha. Decode with independent reader where possible (CI-only ffprobe/ffmpeg or a distinct image/GIF decoder; do not rely solely on same muxer library). Lossy video uses tolerant color/position checks; PNG is lossless. Keep raw reference frames for small fixtures. GIF timing within quantized centisecond policy, not exact video timestamps.

## 4. Sequential implementation gates

Every gate requires relevant tests green, previous gate regressions green, typecheck/lint/build passing, requirement IDs updated, and unresolved items recorded. A gate can be conditionally documented as blocked, but not called complete. Work that does not depend on a failed optional capability may proceed only with a clear provisional plan. Human approvals can be asynchronous to development but remain release blockers.

### G0 — Feasibility and test scaffolding

Build synthetic transparent sprite demo with nested transform, overlapping draw order, tile and drop shadow/glow. Use explicit tick rendering (no screen capture). Probe runtime MP4/H.264, MOV, WebM and PNG alpha; produce short samples for available codecs. Test actual decoded output and compare frame positions to expectations. Prototype GIF and ZIP roundtrip. Establish harness/CI and a basic deterministic fixture, capability manifest, error codes. Confirm dependency compatibility, browser constraints, renderer texture limits, target API. Record actual capabilities/unsupported combinations; if MP4/MOV missing on test platform, verify target Chrome/Edge hardware separately rather than introducing ffmpeg.wasm without approval. PNG sequence is baseline fallback.

**Exit:** real browser renders and exports a deterministic small PNG sequence; supported video/GIF samples validated; unavailable codec status explicitly recorded; test scripts and artifact capture working; no UI complexity yet. Actual target-device video feasibility is an early human check, not something to discover at release.

### G1 — Project model, asset foundation and editor shell

Implement project schema/commands, stable IDs, history, blob store, source import, stage/layer selection and direct transform, canonical serialization and archive load/save. Add IndexedDB recovery and library shell. Basic asset creation via imported alpha image. Tests for references, shared source, duplicate/make unique, transactional load, undo/redo, save/open. Test project switching and resource release.

**Exit:** create shot, import images, place/transform/order pieces, undo, save, close/reopen with same scene. Malformed archive and failed save do not destroy work. Reload/recovery verified. STG-01..03 partial, CUT-01, IO-01/02/04/05.

### G2 — Cutting room and materials

Implement selections, mask edits, clone/color reconstruction, adjustable brush, edge refinement; material shape operations and seeded textures. Update existing studio instances on asset commit; preserve anchor. Add edit-region extension, reuse of source blobs, per-asset overlays, asynchronous stale-result guards. Test F01–F03 and roundtrip F08. E2E separate arm, fill underlying torso, restore mask, place both and move arm to reveal reconstructed torso; undo and reopen. Create textured paper shape and cut a hole; duplicate and edit unique copy. Test exact image results plus small visual references.

**Exit:** CUT-02..06, MAT-01..06 complete; source bytes unchanged, edits survive reopen and do not affect unique sibling assets; no memory blowup for typical source images.

### G3 — Rigging, camera and repeating layers

Implement freeform parent links, editable pivot, wireframe, transform composition, independent global draw order, subtree duplication and portable asset/rig package. Camera stage projection and tiled backgrounds; animate later in G4. Test cycle rejection, signed scales, sheared transforms, preserve-world constraints and overlap ordering. E2E assemble puppet and move arm, inspect hand follows, change drawing order without changing hierarchy, reuse rig in new project. Test camera zoom/pan and tile offset/mirror rendering.

**Exit:** RIG-01..03, STG-04/05 static portions, IO-03; F04/F06 goldens plus independent geometry assertions; archive preserves rigs and layer orders.

### G4 — Timeline, looping and shot authoring

Implement pure track evaluator, keyframes/interpolation, manual/auto-key draft workflow, pose capture, loop clocks/priority, sampling overrides, play/scrub/range/step, camera and tile animation. Implement timeline editing with undoable key movement and duplicate/replace semantics. Test F05/F09 and deterministic seek vs playback, loop endpoints and negative offsets. E2E animate puppet across parallax background, repeat limbs independently of travel, select export range and save/reopen mid-shot.

**Exit:** ANI-01..06 and STG-04/05 animation complete. Same scene at tick T regardless of evaluation history or preview FPS. Loop/range semantics tested. Authored demo fixture complete and reviewable.

### G5 — Effects, production export and polish

Implement complete effect controls, export format/range/resolution/FPS/alpha UI, progress/cancel, encoding backpressure, output paths, capability warnings, error handling, resource cleanup. Add keyboard shortcuts, useful errors, dirty-state and accessibility for common controls. Run F07/F09, format independent validation, F10 baseline and F11 negative cases, network-offline check after assets load if offline support implemented. Run full E2E workflow twice (including reopen and changed export settings). Record exact browser/OS/GPU/driver/codec details and benchmarks. Do manual UX and Resolve import checks before calling release ready.

**Exit:** FX-01..03, EXP-01..05, remaining IO/STG polish; full verification passes; baseline reports and outstanding human/codec checks explicit; no unreviewed data-loss or export defects.

## 5. Regression matrix (minimum, extend as failures arise)

| Area | Required cases | Layer / fixture |
|---|---|---|
| Source & alpha | decode/orientation, original hash unchanged, disconnected wand regions, lasso holes, grow/shrink/feather, semitransparent pixels, zero-alpha brush boundary | unit + browser F01 |
| Reconstruction | sampled offset, stable pre-stroke source, soft stroke, extended rect, restore mask exposes overlay, undo/redo, no source mutation | unit + E2E F02 |
| Materials | same seed/recipe -> same raster, changed seed -> different texture, boolean holes, imported photo mask, anchor stays fixed | unit/browser F03 |
| Graph | nested rotation/scale/pivot, negative scale, singular transform rejected, cycle rejected, missing parent, stable equal-Z ordering, shear limitation | unit/browser F04 |
| Reuse | duplicate shares art; make unique isolates edits; clone subtree IDs remapped; package import missing deps handled; undo reference integrity | integration/E2E F04/F08 |
| Timing | empty/nonempty track before/after keys, hold/linear/ease, 0→360 rotation, discrete visibility/order, duplicate keys, subframe sampling | unit F05/F09 |
| Loops | exact boundary, negative phase, fractional speed, ping-pong, once hold, offset, activation, scope priority, external travel, sampling inheritance | unit + browser F05 |
| Timeline UI | auto/manual keys, pending draft resolution, pose capture, key move/duplicate/delete, undo, scrub/step/range selection | E2E F05 |
| Determinism | random seek order vs monotonic playback, repeated renders, fixed seed, project reopen, undo-redo replay | unit + browser + replay F03/F05/F08 |
| Camera/tiles | center/zoom, aspect ratio, X/Y/both, negative wrap, mirror, scrolling offset, independent speed, viewport not exported | unit/browser F06 |
| Effects | shadow direction, override, opacity, padding, alpha fringe, glow, tint, effect disable, no frame accumulation | browser F07 |
| Archives | deep roundtrip equality, blob byte hashes, shared source dedup, malformed schema, future version, missing refs, path traversal, oversized archive, transactional refusal | integration/browser F08/F11 |
| Recovery | simulated quota/write failures, prior committed generation intact, reload/recovery/discard, stale saves, dirty flag | integration/E2E F08/F11 |
| Export | first/last frame, nonzero start, short range, FPS, PTS, dimensions, alpha/matte, no overlays, codec unavailable, cancel/failure, retry | unit/browser/E2E F09 |
| Memory | bounded frame queue, repeated project open/close, export cancel, stale workers, disposed textures and object URLs | browser + bench F10 |
| Privacy | production bridge absent, no external requests for local workflow, no source data in error logs | build + E2E |

Add property-based tests (fast-check or seeded custom generators) for acyclic graphs, reparent invariants within representable transforms, positive modulo/loop bounds, command undo/redo identity and archive roundtrip. Log failing random seed and shrink reproductions where practical. Include explicit invalid input and fault injection at filesystem/blob/encoder boundaries. Tests must assert negative behavior, not just absence of crashes.

## 6. Performance and manual acceptance

Benchmark F10 with baseline and stretch separately. Record browser version, OS, CPU, GPU, RAM, renderer backend, scene dimensions, decoded asset size, filter count, frame count and encoder. Measure stage load, median/p95 render/evaluate frame time, dropped preview frames, mask stroke latency, archive write/read time and sizes, export frames/sec, maximum observed queue depth, approximate memory where instrumentation permits. Benchmark with and without effects. Include repeated 3× load/export/dispose and cancellation. Assert bounded queue and zero unreleased owned handles after disposal; do not claim exact GPU heap from JS counters. No strict elapsed-time CI thresholds until a reference machine is established. Baseline target is usable authoring and reliable full export on that machine, not promised 30 fps on all hardware. Stretch reports optional; never silently scale down source assets.

Human smoke checklist (actual target desktop):
- Current Chrome and Edge: open app, no unexpected network requests, import local scan and transparent PNG, isolate limb, reconstruct torso, create paper prop, assemble articulated rig, animate pose/loop/travel, set parallax and shadows.
- Save, close, reopen, verify source/edit/animation state. Recover unsaved work after intentional reload; undo and redo a stroke and keyframe edit.
- Scrub and preview selected range, export MP4, MOV, WebM if supported, GIF, PNG still/sequence; confirm no editor guides, compare frames to preview; cancel a longer export then retry.
- Import MP4 and MOV samples (where supported) and PNG sequence into Resolve; check frame rate, dimensions, expected duration, visible colors, transparency for PNG and any explicitly supported alpha-video option. Document Resolve version and OS. No ProRes guarantee.
- Review usability: stage interaction, pivot/rig workflow, timeline discoverability, keyboard navigation, understandable errors and no surprising data loss. Human approves visual goldens and representative demo shot.

## 7. Agent checkpoint report format

At end of each increment update `STATUS.md`:

```text
Gate: Gx (complete / partial / blocked)
Requirement IDs completed:
Changed modules and decisions:
Commands run and results (actual counts and skip reasons):
Fixtures / regressions added:
Manual or hardware checks outstanding:
Known defects / limitations:
Next smallest task:
```

If a test fails: preserve failing seed/fixture/log, reproduce smallest case, fix root cause, run targeted tests then relevant full suite, update issue status. If codec/hardware unavailable: provide precise reason and fallback, do not pretend success. If time/context is exhausted: stop at a safe checkpoint with working build or explicitly documented broken state; do not start an untested subsystem. Keep diffs bounded and easy to review.

## 8. First instruction to the coding agent

Read the three documents. Inspect the repo; preserve any existing work. Implement **G0 only** first, including the automated validation harness and CI scripts. Produce actual rendered and encoded test artifacts using synthetic assets, run the tests available in the environment, and record the capability matrix and blockers. Do not build the full editor until the rendering and export foundation is validated. Then proceed gate-by-gate, with regression tests maintained continuously. The product is a shot-maker, and the creative workflow takes priority over broad feature parity with professional editing software.
