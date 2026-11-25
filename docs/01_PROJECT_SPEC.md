# Collage Studio — Product specification

**Status:** Approved discovery baseline, v0.1 · 2026-11-25  
**Working name:** Collage Studio (provisional)  
**Companion documents:** `02_TECHNICAL_DESIGN.md`, `03_AGENT_HANDOFF.md`

## 1. Product and boundaries

A desktop-first, entirely client-side web application for making animated collage shots from scans, photographs, illustrations, public-domain ephemera, and digitally fabricated paper-like shapes. Its creative model is articulated cut-paper animation: rigid pieces, visible seams, adjustable shadows, deliberately stepped motion, and layered moving backgrounds.

The app produces individual shots and seamless loops. DaVinci Resolve handles audio recording/mixing/mastering, titles, transitions, sequencing, and final assembly. One project contains one stage and one master timeline. The app is not a filmmaking suite, painting application, general-purpose vector editor, or deformable-character animation system.

**Operating constraints:** static HTTPS deployment; no accounts, server, uploads, telemetry, remote processing, or required ML; current desktop Chrome and Edge are the initial supported browsers; keyboard and mouse first. Offline operation after initial load is desirable but not a release blocker. Local originals and exported files remain under user control.

## 2. Core workflow

1. Create a shot with a canvas size, background, frame rate, and duration.
2. Import local image files; extract one or more independently editable pieces from each source.
3. Repair obscured areas of extracted pieces (for example, extend the torso underneath a separated arm).
4. Create supplemental cut-paper, cardboard, felt, or patterned shapes in the material workshop.
5. Drag assets onto the stage, set their pivots, build parent/child relationships, and order their visible layers.
6. Set poses and individual property keys; independently repeat limb movement, props, and scenery; animate the camera where useful.
7. Apply shadows, glow, and basic color adjustments; preview and scrub the timeline.
8. Save a portable project archive; export all or a selected range as video, GIF, or PNG frames.

The three workspaces share a single asset library and undoable project state. Switching workspaces must not discard work. An asset revision must preserve existing scene instance IDs, keyframes and rig links.

## 3. Workspaces and requirements

### 3.1 Cutting room (CUT)

| ID | MVP capability | Acceptance intent |
|---|---|---|
| CUT-01 | Local PNG, JPEG and WebP import; preserve original bytes | A source can produce many assets without redundant originals |
| CUT-02 | Magic wand (connected region), color-based selection/removal, adjustable tolerance | Isolate solid backgrounds and printed illustrations without ML |
| CUT-03 | Polygon/freehand lasso; replace, add and subtract selections | Precisely separate limbs or irregular pieces |
| CUT-04 | Restore/erase alpha brush, adjustable size, hardness; grow/shrink/feather mask | Refine cutout edges and undo changes |
| CUT-05 | Clone stamp with sampled offset, sampled-color brush and adjustable softness | Extend/reconstruct the visible artwork behind another cutout |
| CUT-06 | Multiple named cutouts from a source, preview on checkerboard or solid color | Existing instances update after a committed asset edit |

Retain original source imagery, a per-asset alpha mask and a per-asset reconstruction overlay. The edit region can be extended beyond the initial cutout. The user must be able to reveal reconstructed pixels by restoring/expanding the mask. Clone sampling is explicit; the tool is a basic clone stamp, not a promise of Photoshop-quality healing or content-aware fill. No attempt to infer missing anatomy automatically. Sampling from a stable pre-stroke image avoids recursive smearing. Undo is one operation per completed stroke or selection edit.

Optional non-ML smart boundary tracing/GrabCut is a later experiment, not a dependency for MVP. Keep the mask editor useful with no advanced extraction feature.

### 3.2 Material workshop (MAT)

| ID | MVP capability | Acceptance intent |
|---|---|---|
| MAT-01 | Rectangle, ellipse, polygon, freehand closed shape | Make simple props and shapes without a vector editor |
| MAT-02 | Union, subtraction and intersection via raster masks | Cut holes and combine basic shapes |
| MAT-03 | Construction paper, kraft/cardboard and felt; additional aged paper, fabric and halftone presets | Seeded, material-fixed texture; no per-frame random flicker |
| MAT-04 | Base color, grain intensity, texture scale/rotation, variation, edge irregularity and edge darkening | Simple controls create distinctive material variations |
| MAT-05 | Stripes, dots, grids, checkerboards, crosshatching; pattern scale | Fabricate graphic backgrounds and props |
| MAT-06 | Imported image as material under a shape mask | Cut a shape out of a photograph or scan |

Keep editable generation parameters and shape operations; rasterize an alpha-bearing asset for the studio. No Bezier editor, typography tool, advanced procedural node graph or complex vector Boolean geometry. Shape/material edits should not unexpectedly shift the asset's anchor or invalidate existing animation.

### 3.3 Animation studio: composition and rigs (STG, RIG)

| ID | MVP capability |
|---|---|
| STG-01 | Asset library with thumbnails, names, drag/add to stage, select, duplicate, make unique, delete with reference checks |
| STG-02 | Stage view with pan/zoom independent of shot camera, frame boundary, direct move/rotate/scale, visibility and lock |
| STG-03 | Layer list with independently adjustable global draw order; grouping, collapse and selection |
| RIG-01 | Freeform rigid-piece parenting and adjustable pivots; forward kinematics; optional wireframe/joint overlay |
| RIG-02 | Reparent or change pivot in setup mode without unexpected jumps; prevent cycles |
| RIG-03 | Save/reuse a whole character (group + subtree + assets) in same or another project; no external path dependencies |
| STG-04 | Animatable shot camera: position and positive zoom; no automatic depth-parallax requirement |
| STG-05 | Repeating layer, X/Y/both, tile scale, offset, scroll rate and optional mirrored repetition |

An instance duplicates placement/animation state but shares artwork; Make Unique copies the asset definition and editable mask/overlay or recipe while reusing immutable source blobs. Duplicating a group creates fresh IDs for every node and internal reference. External parent links are not copied into a standalone library item. The library supports portable standalone asset/rig packages; cross-project importing is explicit.

A puppet may be anatomically unconventional. Skeleton templates, IK, skinning, bones with weights, and mesh warping are not MVP. Allow non-rendering group/joint nodes as needed. A hand can be drawn in front of a torso even if the arm is drawn behind it. Visibility/locking are clear, and guides never appear in export.

### 3.4 Timeline (ANI)

| ID | MVP capability |
|---|---|
| ANI-01 | Play/pause, scrub, step, zoom timeline, select playback/export range, loop selected range |
| ANI-02 | Property tracks: position, rotation, scale, opacity, visibility, draw order, supported effect scalars, camera and tile offsets |
| ANI-03 | Manual key insertion (default) and opt-in auto-key; whole-group pose key; edit/move/delete/duplicate keys |
| ANI-04 | Hold, linear and smooth ease-in/out interpolation; discrete properties always hold |
| ANI-05 | Independently timed track, object and group loops: repeat, ping-pong, once-and-hold, speed and time offset |
| ANI-06 | Project default motion sampling rate, inherited with per-object/group override or full output rate |

Loop a character's local pose independently of its master-timeline travel by keeping locomotion on a separate outer group/root. No blended or overlapping clip editor, reusable motion-clip library, curve editor or motion-path editor in MVP. The interface should expose the most common transform and pose operations before advanced controls.

Auto-key OFF means changing a property with an existing track stages a visible draft at the current time; user must insert a key or discard the draft before changing time/exporting/saving. Unanimated properties can update base state directly. Auto-key ON creates/replaces keys only for changed properties. Pose capture records local pose transforms of the chosen group and descendants (not stage-camera or unrelated tracks). All edits are undoable. See technical design for time and loop rules.

### 3.5 Visual effects (FX)

| ID | MVP capability |
|---|---|
| FX-01 | Drop shadow: color, opacity, distance, softness, global direction with per-layer override |
| FX-02 | Outer glow/backlight: color, intensity, radius |
| FX-03 | Tint, brightness, contrast; simple enable/disable controls |

Effects are attached to individual rendered pieces; a group may batch-edit its descendants, but true composited group filters are deferred. A global shadow direction simulates a light source, not physical light transport. Effects must not change the cutout's alpha mask or accumulate from frame to frame. More advanced lighting, layer heights and shadows cast on specific objects are later work.

### 3.6 Project persistence (IO)

| ID | MVP capability |
|---|---|
| IO-01 | Save/open portable ZIP-based `.collage` file with schema version, embedded sources, masks, reconstruction overlays and generated assets |
| IO-02 | Local crash recovery with an explicit recover/discard choice; autosave after committed edits |
| IO-03 | Import/export reusable single assets and rigs as `.collageasset` packages |
| IO-04 | Validation of archive references, errors without losing current project, dirty-state and destructive-action prompts |
| IO-05 | Optional per-source attribution/source URL notes (local metadata, never fetched automatically) |

Download and standard file picker are the portable baseline. In-place save using browser filesystem handles is optional. Autosave is recovery, not a replacement for a portable file; clearly disclose quota or permission failures. Save/load must preserve image edits, masks, timeline, camera, rigging, effects and reusable asset links.

### 3.7 Export (EXP)

| ID | MVP capability |
|---|---|
| EXP-01 | Render exact frame times, entire shot or selected half-open range, progress and cancel |
| EXP-02 | MP4/H.264, MOV and WebM when codec capability checks succeed; show codec and compatibility limits |
| EXP-03 | Animated GIF with dimensions, frame rate, loop setting and quantization; warn about file size and limited alpha |
| EXP-04 | Numbered PNG sequence (ZIP or direct folder when supported), PNG still; preserve transparency when enabled |
| EXP-05 | Export resolution, frame rate, opaque background or supported alpha; no editor overlays |

Video export is frame-by-frame, not screen recording. MP4/H.264 is the primary ordinary video target. MOV is a container, not a guarantee of ProRes or alpha. PNG sequence is the reliable Resolve intermediate for transparency and unsupported codecs. Output must open in an appropriate independent decoder; a manual Resolve import check on the target desktop is required before release. No audio or titles.

## 4. Baseline targets (not hard limits)

| Metric | Baseline | Stretch, not a release gate |
|---|---:|---:|
| Resolution | 1920×1080 | 3840×2160 |
| Output frame rate | 24–30 fps | 60 fps |
| Shot length | 30 seconds | 5 minutes |
| Visible pieces | 100 | 500 |
| Articulated characters | 5 | 20 |
| Project archive | 100 MB | 500 MB |

Initial defaults: 1920×1080, 24 fps, 10-second duration, 12 fps object motion sampling with full-rate camera/scrolling backgrounds. All are editable. Project length and resolution are positive; reject unsafe dimensions only based on documented resource/renderer limits. No gratuitous project duration cap. Preview may drop frames; final export must never omit frames. Measure baseline on a documented desktop before promising real-time performance. Warn about expensive filters, huge assets, long GIFs and exports that cannot be streamed.

## 5. Deferred scope

Facial-part library (eyes, eyebrows, lids, mouths) with attachments, swap sets and predefined blink/mouth motion; no audio-driven lip sync assumed. Also: advanced healing/inpainting and segmentation; rig templates/IK; reusable animation clips; physical lighting/layer heights; particles; mesh deformation; nested shots; mobile editing. Audio, text/title editing, transitions and multi-shot sequencing remain outside the shot-maker's intended scope, not automatic future additions.

## 6. Release definition

All MVP requirement IDs are implemented or explicitly approved as deferred; deterministic evaluator, persistence, cutting, rigging, loops and export pass the automated gates in the handoff; baseline benchmark and actual Chrome/Edge/Resolve smoke tests are recorded. The application functions without network requests to third parties after static assets have loaded. Document limits and supported codecs rather than claiming universal compatibility. No unreviewed test/golden changes or known data-loss bugs.
