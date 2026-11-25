# Collage Studio — Technical design

**Version:** 0.1 · 2026-11-25  
**Companions:** `01_PROJECT_SPEC.md` (scope), `03_AGENT_HANDOFF.md` (execution and tests). The product spec governs scope; this document defines implementation contracts. Changes to these contracts require documented rationale and regression coverage.

## 1. Stack and constraints

TypeScript in strict mode; Vite; React with ordinary HTML/CSS for docked panels (proposed implementation default, not a product constraint); PixiJS v8 WebGL renderer; Canvas 2D/typed arrays for masks and materials; fflate for archives; IndexedDB for recovery; Mediabunny for video; gifenc for GIF. Vitest for pure unit/integration tests, Playwright for real-browser integration and end-to-end tests. Use npm and commit the lockfile. Choose compatible stable versions in the feasibility spike, pin them, record versions and licenses. Bundle all runtime assets and dependencies locally; no CDN requirement or service calls. No heavy ML, native install, server, or ffmpeg.wasm dependency in MVP. Node/FFmpeg tooling may be used in development CI only.

Primary references (verify actual pinned APIs in spike):
- https://pixijs.com/8.x/guides/components/renderers
- https://pixijs.com/8.x/guides/components/filters
- https://pixijs.com/8.x/guides/components/textures
- https://pixijs.download/v8.22.0/docs/scene.TilingSprite.html
- https://mediabunny.dev/guide/supported-formats-and-codecs
- https://mediabunny.dev/guide/media-sources
- https://mediabunny.dev/guide/writing-media-files
- https://github.com/mattdesl/gifenc
- https://github.com/101arrowz/fflate
- https://playwright.dev/docs/test-snapshots
- https://vitest.dev/guide/

Documentation supports the proposed APIs; no implementation or target-machine benchmark has been performed yet. Do not claim hardware encoder support until probed.

## 2. Architecture

```text
UI (cutting, workshop, studio, timeline, export)
    -> application commands / queries -> project store + history
                                      -> asset processing / blob store
project snapshot + frame time -> pure evaluator -> evaluated draw list
                                                    -> Pixi adapter -> canvas
                                                    -> same render path -> encoders
project snapshot + blobs <-> archive / recovery adapters
fixture + command log -> headless domain runner / browser harness
```

Suggested modules (not mandatory file-per-class):

```text
src/domain/        # schemas, identifiers, graph, tracks, clocks, matrix math
src/application/   # command bus, state, history, use cases, validation
src/assets/        # source import, mask algorithms, clone, recipe rendering
src/render/        # Pixi adapter, textures, effects, overlay renderer
src/persistence/   # archive, migrations, recovery, blob store
src/export/        # frame plans, codec capability, encoders, targets
src/ui/            # workspace panels, stage controls, timeline
src/workers/       # costly pure processing/encoding where supported
src/test-harness/  # dev/test-only bridge, fixture loading and replay
 tests/{unit,integration,browser,e2e,fixtures,goldens,benchmarks}/
```

Domain is independent of DOM, React, Pixi, wall-clock time, GPU and browser storage. Commands validate invariants before commit. Store contains canonical project data, not mutable Pixi objects. UI selection, view pan/zoom, hover and tool mode are transient and separately stored. Export takes an immutable committed snapshot and asset revision map; it cannot accidentally include editor drafts. A renderer is a projection and can be disposed/rebuilt from a snapshot. No direct renderer mutations may become the sole record of a user edit.

## 3. Domain model

Use stable IDs (UUIDs in app, fixed IDs in fixtures). IDs do not encode ordering or filenames. Schema validation at untrusted load boundaries (e.g. Zod or equivalent). Prefer plain JSON data plus binary blobs. Persist numbers only if finite. Canonical serialization sorts map keys; explicit arrays preserve semantic order. Use integer revision values for cache invalidation; do not persist GPU resources.

| Record | Essential fields |
|---|---|
| Project | id, name, schemaVersion, shot, source map, asset map, node map, tracks, loop scopes, library metadata |
| Shot | width, height, fps, durationTicks, defaultMotionRate, background, camera, globalShadowAngle |
| Source | id, original blob key, media type, decoded dimensions/orientation, optional attribution/source URL |
| CutoutAsset | id, sourceId, editRect (source pixel coords; may extend beyond source), maskBlob, overlayBlob, anchor, revision |
| MaterialAsset | id, recipe (shape ops, material, seed, image reference if any), stable canvas rect/anchor, revision |
| Node | id, kind group/sprite/tile, parentId or null, assetId if rendered, transform, opacity, visible, locked, drawOrder, sampling override, effects, tile parameters |
| Transform | x, y, angle (degrees, unwrapped), sx, sy, pivotX, pivotY |
| Track | id, target (node/camera/shot), property path from registry, keys sorted by tick |
| Key | tick, typed value, interpolation to next key |
| LoopScope | id, target selector (group/object/property), startTick, endTick, activationStartTick, speed, offsetTicks, mode |
| Asset package | type, version, selected asset or rig subtree, dependencies and optional animation tracks/loops |

Track properties have a registry with type, range, interpolation eligibility, applicable targets and default. Allow signed nonzero scale for flipping; disallow singular/near-zero transforms; interpolating opposite signs is a discrete flip at the endpoint, not a zero crossing. Reject duplicate keys at one target/property/tick except explicit replace. Validate parent acyclicity, target/asset references, loop bounds, valid camera zoom and rate. No NaN/Infinity; set practical resource limits in the IO layer.

Undo/redo uses reversible commands or patches plus blob references; never take full image copies for every mouse move. Coalesce one drag or brush stroke into one transaction. Store changed raster tiles or before/after region patches for strokes. Bound history by a configurable byte budget (initial 128 MiB) and count (initial 100 transactions); evict oldest complete transactions with UI disclosure if limit reached. Keep referenced blobs until no active project, undo/redo, or recovery reference remains. Undo history itself is session-local, not required in project archive.

## 4. Geometry and rendering

Coordinates: +x right, +y down, angles positive clockwise. Local transform M = T(x,y) R(angle) S(sx,sy) T(-pivotX,-pivotY); world M = parentWorld × M. Asset coordinates are stable; if an edit expands its raster bounds, adjust the texture origin relative to the asset anchor, not the animated node. Camera world position is stage center by default; projection maps camera center to output center with uniform positive zoom. Editor viewport transform is separate. Export resolution scales the logical stage; preserve aspect ratio using letterbox/pillarbox if needed, never stretch by default.

Compute hierarchy in topological order, then flatten rendered nodes into a global draw list sorted by drawOrder and stable ID tie-break. Effective opacity multiplies ancestor opacity, visibility is inherited. Group nodes have no image. Avoid relying on Pixi container sibling order to represent the rig. Apply the full evaluated affine matrix to each rendered item; nonuniform nested transforms can produce shear. A setup-mode reparent that cannot be represented by TRS without loss (e.g. shear) must be refused with explanation, not silently approximate. Reparenting an animated rig or moving animated pivots can change all poses; MVP restricts preserve-world reparent/pivot operations to unanimated affected transforms (or requires an explicit warning/acceptance of setup changes). Setup pivot change compensates position to preserve visible artwork. Never generate cycles. Selection/hit testing uses reverse draw order and inverse world transform, with optional alpha hit check; locked nodes not selected by canvas unless explicitly unlocked.

Render effects from source textures, never from last frame. Effects order: tint/brightness/contrast, outer glow, then drop shadow composed behind the original (shadow derives from cutout silhouette). Direction is stage/world-relative and projected consistently through camera; distance in logical stage pixels. Define padding for filters so edges do not clip except at shot boundary. Reuse textures/filters keyed by asset revision, dispose stale GPU objects and object URLs. Avoid synchronous pixel readback during normal preview. Use extraction only for explicit export or tests. Stage and export share renderer configuration and drawing logic; separate canvas or target for export. Disable renderer ticker for deterministic explicit rendering. Wait for assets/textures to be ready before each render job starts.

Tiling: explicit rectangle extent in local space, tile scale positive, X/Y/both repeat; nonrepeat axes render only a single tile. Mirroring can use a prebuilt mirrored tile texture. Offset = keyed offset + scrollRate × effective time (seconds); wrap negative values with positive modulo, not JS remainder. Scroll default samples at full output rate; repeated texture movement not automatically seamless if the source edges differ. Expose tile preview/seam warning as practical.

## 5. Time, keyframes and loop semantics

Use integer timeline ticks, 120,000 ticks/sec (chosen to represent common integer frame rates and 23.976/29.97/59.94 rational rates). Store output fps as rational numerator/denominator; initially expose integer fps 8, 12, 15, 24, 25, 30, 60. An export uses frame index, not accumulated floating deltas. Supported integer rates divide tick base; if future rate is not integral, compute each timestamp rationally and round independently. Tick zero is shot start; shot interval [0,durationTicks). Keys may exist at the terminal tick to establish end interpolation. At a nonempty track, before first key hold first value and after last hold last value. Empty track uses base value. Interpolation: hold, linear, smoothstep u²(3−2u); rotations are authored unwrapped so 0→360 performs a full turn. Visibility/draw order discrete, no interpolation. Opacity clamped [0,1].

Evaluator inputs: committed project, exact shot tick, optional output frame rate context for full-rate sampling. Return typed evaluated camera + flattened draw list, plus optional joint poses for editor. Never call Date.now(), random, requestAnimationFrame, or previous frame state inside evaluator. Seeded material generation is deterministic for a given recipe and algorithm version.

Clock rules:
1. Choose sampling rate from nearest node/ancestor override; else shot default. Full-rate means evaluate at the incoming requested frame timestamp. Camera uses full-rate; tile scrolling defaults full-rate, other tile properties use normal node rate. Quantize sampled master time down to nearest sampling tick; parent and child can sample at different rates. During scrub, incoming tick may be any tick, not just export frames.
2. For each property choose at most one applicable loop: explicit property loop > object loop > nearest ancestor group loop. Group scope covers transforms/properties of descendants and its own node. More specific scope replaces rather than nests clocks; same-selector duplicate loops invalid. Unlooped properties use sampled shot time. To independently translate a repeating walk cycle, put the looping rig inside an unlooped parent group and animate outer group x/y.
3. Before activationStartTick, use ordinary shot time. On/after activation: phase = (sampledTick − activationStartTick) × speed + offsetTicks; speed strictly positive, finite; offset may be negative. Loop source bounds [a,b], L=b−a > 0; repeat maps to a+mod(phase,L) (exclusive b); ping-pong maps to a+L−abs(mod(phase,2L)−L) (includes endpoints); once-and-hold maps to a+clamp(phase,0,L). Use deterministic rounding for fractional ticks. Loop phase and source range controls are separate; source keys remain on master timeline. An inherited loop affects all applicable keyed properties in that scope; tracks without keys use base values. No clip blending. Group loops on a subtree are opt-in, not implicitly created by parenting.
4. Evaluate each local property at its resolved time. Compose hierarchy using resulting local transforms, then draw. Camera has no group loops; property loops may be supported if registry permits, otherwise explicitly disabled in UI.

Test repeat boundary a,b−1,b; negative phase; ping-pong turnaround; once hold; nested override priority; loop activation boundary; stepped parent and smooth child; static group locomotion outside looping rig. Timeline playback uses elapsed wall-clock to pick master time but never integrates transforms; seeking must equal playback. Export range is half-open; start at requested in tick, sample at start+n/fps, exclude any frame at or after out tick. For subframe-aligned range, final full frame may extend past requested out by less than one frame; disclose frame count/duration. Video PTS starts at zero, monotonically increases. Preview looping uses same range definition.

## 6. Editing assets

Import via file input/drop, MIME plus magic/decode check; preserve source bytes and decode normalized orientation consistently. Source coordinates refer to normalized decoded pixels. Only local files in MVP; no remote URL fetch or arbitrary SVG execution. Masks are 8-bit alpha coverage; PNG storage is lossless. Crop edit rectangle is independent of cutout bounds and may extend beyond original pixels for reconstruction. Composite source plus per-asset RGBA reconstruction overlay, then multiply by mask alpha. Explicit sampling source (source+overlay snapshot), brush center/offset, opacity/hardness; clone and color strokes may fill transparent holes or extend outside initial cutout. Define brush blending in premultiplied math or verified consistent straight-alpha math; prevent dark fringe. Store overlay separately from mask. Restore mask separately to expose painted pixels. Lasso fill rule fixed (even-odd); threshold color distance deterministic (e.g. squared RGB distance; document tolerance). Magic wand flood fill 4-connected, no recursion stack overflow; color removal within region or whole edit rect; selection operations separate from mask commit. Morphology grow/shrink on alpha; feather bounded blur with edge handling. Fixtures include transparent edges and anti-aliased pixels.

Material recipe: ordered operations on raster mask (union=max, intersection=min, subtraction=max(0,a−b) for coverage; document and test anti-aliased results), base color and seeded texture generation. Use fixed PRNG and algorithm version; material-fixed noise and repeated pattern coordinates; regenerate only on recipe changes. Reuse imported source immutable bytes when using photo material. Cache raster results by recipe/revision; store generated PNG cache in archive for portability across versions. Keep seed explicit; no Math.random in material synthesis. No global source edits.

Heavy flood fill, morphology and recipe raster work may use workers with typed buffers; provide pure core functions testable in Node. For async edits attach asset revision/request token; ignore stale results after undo, project close, or newer edit. Cancel or coalesce jobs, transfer buffers carefully (do not detach store-owned buffers). Never commit a partial stroke on failure.

## 7. Persistence and resource lifecycle

```text
shot.collage (ZIP)
  manifest.json   # kind, formatVersion, appVersion, projectPath, blob index
  project.json    # canonical project
  sources/<blobId>.<ext>
  masks/<blobId>.png
  overlays/<blobId>.png
  assets/<blobId>.png  # generated raster cache / optional derived cutout cache
  thumbnail.png       # optional
```

Manifest blob index records logical ID, path, byte count, MIME and SHA-256 where practical (required for written authoritative blobs); deduplicate immutable sources by hash. Generated cache is derived, not sole recipe authority. Validate paths (no traversal, absolute paths, duplicate paths, unexpected types); no extracting executable content. Validate manifest and schema before decoding images or swapping project. Check archive compressed/uncompressed size and entry count early, enforce per-entry and aggregate decoded pixel/byte limits, guard zip bombs; initial provisional limits: 1 GiB total uncompressed, 10,000 entries, max dimension determined by GPU/decoder and memory budget. Test the 100 MB baseline and 500 MB stretch archives before raising claims. Report limit exceeded, no silent downsampling of originals. Use streaming ZIP where practical, avoid loading every decoded image at once; keep source bytes lazy and dispose decoded buffers when not needed. Save has progress/cancel; if a failed save occurs dirty state remains. Recovery stores transactional snapshot metadata and immutable blobs in IndexedDB with schema/version; update recovery pointer only after successful writes, keep previous valid generation until new commit. Debounce after committed edit; explicit save doesn't clear newer edits. Warn when quota unavailable. File input/download baseline; optional filesystem handles with runtime support checks. Revocation, cancellation and errors preserve current project. New schema version requires explicit migration or refusal; future unsupported versions refused without modification. Library package import remaps all IDs and references, preserving internal hierarchy and resolving shared source blobs by hash.

## 8. Export contract

`planFrames(snapshot, range, fps)` returns index, shotTick, PTS, duration. `renderFrame(snapshot, shotTick, target)` yields a ready frame with correct dimensions and alpha policy. `EncoderAdapter` supports probe, start, append(frame,pts,duration), finish, abort; backpressure awaited and frames released immediately. Export queue bounded (initial 1–3 raw frames in flight); no full-frame-array accumulation. Stream encoded output to disk when supported; otherwise buffer encoded bytes only, display resource warning and estimate, permit cancellation. UI reports progress by successfully appended frames; errors are structured; no partial file called successful.

Mediabunny canvas source and MP4/MOV/WebM format adapters. Probe codec, dimensions, alpha and rate combination using actual runtime capability; prefer H.264 MP4 and MOV where supported, WebM VP8/VP9 where available. Unsupported choice disabled with reason and PNG fallback. For non-alpha video composite against chosen background. GIF quantizes to <=256 colors; partial alpha flattened against chosen matte (or thresholded to binary transparency with clear label), delays in centiseconds using cumulative rounding and minimum delay, loop metadata explicit. Warn for very short delays and large GIFs. PNG sequence uses fixed zero-padded index naming and a manifest with fps/range; PNG still uses current committed frame. PNG alpha regression checks must include semitransparent pixels. No audio tracks. Export/preview agreement checked at same logical dimensions and camera, excluding guides. Dispose render targets, video frames, workers and object URLs on success, failure and cancel.

## 9. Testing hooks and observability

The app exposes a dev/test-only adapter (never shipped enabled): load fixture/archive, dispatch validated domain command, get canonical snapshot, evaluate at tick, render at tick, extract RGBA/PNG, export specified range, replay command log, inspect live resource counters. The adapter calls real application paths, not duplicate logic. Return stable error codes and diagnostic context; logs exclude source image bytes and private filesystem details. Test fixtures generated procedurally or self-authored, checked in with provenance. Separate exact pure-domain tests from tolerant GPU comparisons; compare alpha, specific pixels, bounds and draw ordering as well as screenshots. See handoff for matrix and execution gates.
