# Known Bugs & Limitations — Terrymator

## Gate G0 Observations (2026-11-25)

- **MOV / MP4 Alpha Channel:** WebCodecs `avc` (H.264) in MP4 and MOV containers does not carry an alpha channel. Non-alpha video exports composite onto the chosen matte/background color; PNG sequence (`png-sequence`) is the lossless alpha intermediate for DaVinci Resolve.
- **GIF Transparency:** GIF89a supports 1-bit binary transparency only; semitransparent edges are thresholded at `alpha < 128` when `alpha: true` or flattened against the matte color when `alpha: false`.
- **Bundle Size Warning:** `vite build` reports `dist/assets/index-*.js` at ~1,040 kB (gzip 302 kB) because PixiJS v8, Mediabunny, Zod, and React are bundled in a single initial chunk. Code-splitting export/worker modules can be added in later gates if needed.
- **Pending Manual Check:** Exported `artifacts/g0/f09-*.mp4`, `f09-*.mov`, and `f09-png-seq-*.zip` have been validated by `ffprobe`/`ffmpeg` 8.1.1 and `pngjs`, but have **not yet been manually imported into DaVinci Resolve** on the target desktop.
