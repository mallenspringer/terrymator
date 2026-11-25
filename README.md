# Terrymator (Collage Studio)

A desktop-first, entirely client-side web application for articulated cut-paper animation.

**Authoritative specification & plans:**
- [01_PROJECT_SPEC.md](docs/01_PROJECT_SPEC.md) — Product scope & requirements
- [02_TECHNICAL_DESIGN.md](docs/02_TECHNICAL_DESIGN.md) — Architecture & subsystem contracts
- [03_AGENT_HANDOFF.md](docs/03_AGENT_HANDOFF.md) — Sequential gates & validation plan

## Requirements

- **Node.js:** `24.x` (see `.nvmrc`)
- **npm:** `10.x`
- **Playwright Chromium:** install once with `npx playwright install chromium`
- **Optional CI/local independent decoder:** `ffmpeg` and `ffprobe` on `PATH` for independent video/GIF stream verification

## Setup & Commands

```bash
npm ci
npx playwright install chromium
```

| Command | Purpose |
|---|---|
| `npm run dev` | Local Vite dev server with Terrymator Studio & test harness |
| `npm run build` | Production build (`dist/`), test harness excluded |
| `npm run typecheck` | Strict TypeScript checks (`tsc --noEmit`) |
| `npm run lint` | ESLint flat config checks |
| `npm run format:check` | Prettier formatting check |
| `npm run test:unit` | Vitest pure domain, math, time, and evaluator tests |
| `npm run test:integration` | Vitest store and ZIP archive integration tests |
| `npm run test:browser` | Playwright Chromium WebGL rendering & export tests |
| `npm run test:browser:chrome` | Playwright local Google Chrome channel tests |
| `npm run test:browser:edge` | Playwright local Microsoft Edge channel tests |
| `npm run test:e2e` | Playwright UI shell E2E tests |
| `npm run test:replay` | Vitest deterministic command-log replay tests |
| `npm run test:bench` | Vitest G0 smoke & F10 100-piece/5-rig baseline benchmarks |
| `npm run verify:bundle` | Verify `dist/` excludes test harness & external hosts |
| `npm run verify` | Full verification chain |

## Gate G0 Artifacts

Running the browser export tests populates `artifacts/g0/` (gitignored) with:
- `capability-report-<browser>.json` — WebGL & WebCodecs/Mediabunny codec probe results
- `f09-png-seq-<browser>.zip` + sample extracted PNG frames (`f09-frames-<browser>/`)
- `f09-<browser>.gif`, `f09-<browser>.mp4`, `f09-<browser>.mov`, `f09-<browser>.webm`
