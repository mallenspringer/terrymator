# Technical Decisions Log — Terrymator

## 2026-11-25 — Gate G0

### 1. Project Naming
- Working package/repository name set to `terrymator` (`package.json`, manifest `kind: "terrymator-project"`, harness global `__TERRYMATOR_HARNESS__`) per user confirmation.

### 2. Pinned Dependencies & Licenses
All runtime and test dependencies are pinned to exact versions in `package.json` and `package-lock.json`:
- `pixi.js@8.23.0` (MIT) — WebGL2/WebGL renderer (`WebGLRenderer`, `BufferImageSource`, `TilingSprite`, `ColorMatrixFilter`)
- `pixi-filters@6.1.5` (MIT) — `DropShadowFilter`, `GlowFilter`
- `mediabunny@1.66.4` (MPL-2.0) — WebCodecs `CanvasSource` + `Mp4OutputFormat`, `MovOutputFormat`, `WebMOutputFormat`
- `gifenc@1.0.3` (MIT) — Animated GIF quantization & encoding (local `src/types/gifenc.d.ts` added since `gifenc` ships JS-only)
- `fflate@0.8.3` (MIT) — ZIP archive packing/unpacking & PNG zlib compression
- `zod@4.6.7` (MIT) — Untrusted schema validation at archive/load boundaries
- `react@19.3.1`, `react-dom@19.3.1` (MIT) — UI panel shell
- Dev/Test: `typescript@5.9.3`, `vite@8.3.8`, `vitest@5.1.2`, `@playwright/test@1.65.1`, `fast-check@4.11.0`, `pngjs@7.0.0`, `eslint@10.15.0`, `typescript-eslint@8.74.0`, `prettier@3.10.1`

### 3. TypeScript 5.9.3 vs 7.0.2
- `npm view typescript` currently resolves to `7.0.2`, while `typescript-eslint@8.74.0` declares peer dependency `typescript: ">=4.8.4 <6.1.0"`.
- Pinned `typescript@5.9.3` for full ESLint/tooling compatibility.

### 4. PixiJS v8 `BufferImageSource` Format & Straight-Alpha Readback
- PixiJS v8 `BufferImageSource` defaults to `bgra8unorm` when passed a `Uint8Array` without an explicit `format`. All RGBA buffer uploads explicitly pass `format: 'rgba8unorm'` and `alphaMode: 'no-premultiply-alpha'`.
- `WebGLRenderer` readback via `gl.readPixels` returns bottom-up premultiplied RGBA; `PixiStageRenderer.renderToRgba()` flips rows and un-premultiplies non-opaque pixels to maintain straight-alpha PNG/RGBA consistency.

### 5. PixiJS v8 + `pixi-filters@6.1.5` Effects Behavior
- Applying `ColorMatrixFilter`, `GlowFilter`, and `DropShadowFilter` to a non-rotated wrapper `Container` around the transformed sprite ensures `DropShadowFilter` offsets are applied in stage-aligned space (respecting `globalShadowAngle` and `cameraScale`) rather than rotating with the sprite's local matrix.
- Filter padding is explicitly sized (`ceil(dist + softness * 2) + 12` for shadow, `ceil(radius) + 8` for glow) to prevent edge clipping.

### 6. Production Bundle Isolation
- `__ENABLE_TEST_HARNESS__` is `true` only during `vite` dev server (or `VITE_ENABLE_TEST_HARNESS=1`) and `false` during `vite build`.
- `src/main.tsx` dynamically imports `src/test-harness/harness.ts` only inside `if (__ENABLE_TEST_HARNESS__)`, and `scripts/verify-prod-bundle.mjs` verifies `dist/` contains no harness symbols or unexpected external URLs.

## 2026-11-25 — Gate G1

### 7. Content-Addressed Source Deduplication & Undo Blob Retention
- `BlobStore.putSource()` hashes raw imported bytes with SHA-256 (`src/domain/hash.ts`) and reuses any existing `'source'` blob with the same digest, avoiding redundant storage when the same image is imported twice.
- `ProjectStore.pruneOrphanedBlobs()` retains all blobs referenced by the active project **and** any snapshot in `UndoHistory` (`undoStack` + `redoStack`), releasing blobs only when evicted from history or on project switch / `NEW_SHOT`.

### 8. Generational IndexedDB Crash Recovery
- `RecoveryManager` writes referenced blobs and the new `RecoveryGeneration` record *before* updating `meta.activeGenId`, so any simulated or real write/quota failure leaves the previous valid generation intact.
- `App.tsx` surfaces an explicit `Recover` / `Discard` banner on startup when a recovery snapshot exists, and debounces recovery saves (250ms) after committed dirty edits.

### 9. Strict React 19 Hook Purity
- `eslint-plugin-react-hooks@7.1.1` enforces `react-hooks/refs`; long-lived controller instances (`ProjectStore`, `PixiStageRenderer`, `RecoveryManager`) are initialized via `useState(() => ...)` lazy initializers rather than reading `useRef.current` during render.

## 2026-11-25 — Gate G2

### 10. Premultiplied Overlay Blending & Derived Cutout Cache
- `blendPixelOver()` in `src/assets/cutting.ts` converts both destination and source pixels to premultiplied alpha before `source-over` compositing and converts back to straight RGBA, preventing dark fringes on transparent reconstruction overlays.
- `ProjectStore.getBlobs()` lazily composites and caches `derived-cutout:${assetId}@${revision}` RGBA buffers for cutouts with masks, overlays, or extended `editRect`s, keeping `.collage` archives compact (storing only immutable source bytes + 8-bit mask PNG + overlay PNG).

### 11. Deterministic Seeded Material Synthesis
- `src/assets/materialSynthesis.ts` uses pure integer-hashed 2D value noise (`hash2D` + `valueNoise2D`) and `2x2` subpixel shape supersampling with `Math.random()` strictly banned, guaranteeing bit-for-bit identical rasters across Node and Browser for any given `MaterialRecipe`.

## 2026-11-25 — Gate G3

### 12. Lossless Preserve-World TRS Decomposition & Shear Refusal
- `decomposeAffineToTRS()` in `src/domain/math.ts` verifies column orthogonality (`|u·v| / (|u||v|) <= 1e-4`) and recomposition accuracy (`<= 1e-3`) before committing `REPARENT_NODE_PRESERVE_WORLD`, throwing `ERR_SHEAR_NOT_REPRESENTABLE` rather than silently approximating sheared transforms.
- Animated nodes (`hasAnimatedTransform()`) are protected by `ERR_ANIMATED_TRANSFORM_LOCKED` unless explicitly overridden, preventing accidental pose corruption during setup-mode reparenting or pivot changes.

### 13. Standalone `.collageasset` Package Remapping
- `packAssetPackage()` strips the root node's external `parentId` and bundles only the referenced subtree, assets, sources, tracks, and SHA-256-verified blobs.
- `ProjectStore.importAssetPackage()` deduplicates source blobs by SHA-256 and remaps every `sourceId`, `assetId`, `nodeId`, and `trackId` to fresh IDs while preserving internal hierarchy and relative `drawOrder` shifted above existing stage layers.
