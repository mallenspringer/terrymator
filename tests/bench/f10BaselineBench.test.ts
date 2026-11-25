import { performance } from 'node:perf_hooks';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { evaluateScene } from '../../src/domain/evaluator';
import { packArchive, unpackArchive } from '../../src/persistence/zip';
import { buildF10StressScene } from '../../src/test-harness/fixtures';

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx]!;
}

describe('bench/f10 baseline (100 pieces, 5 rigs, 1920x1080)', () => {
  it('measures F10 setup, 200 evaluations with/without FX, and archive roundtrip', async () => {
    const tSetup0 = performance.now();
    const { project: fxProject, blobs } = buildF10StressScene(true);
    const setupMs = performance.now() - tSetup0;
    const { project: noFxProject } = buildF10StressScene(false);

    const spriteCount = Object.values(fxProject.nodes).filter((n) => n.kind === 'sprite').length;
    const rigCount = Object.values(fxProject.nodes).filter((n) => n.kind === 'group').length;
    expect(spriteCount).toBe(100);
    expect(rigCount).toBe(5);

    const fxEvalTimes: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const t0 = performance.now();
      evaluateScene(fxProject, (i * 9_000) % fxProject.shot.durationTicks);
      fxEvalTimes.push(performance.now() - t0);
    }
    fxEvalTimes.sort((a, b) => a - b);

    const noFxEvalTimes: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const t0 = performance.now();
      evaluateScene(noFxProject, (i * 9_000) % noFxProject.shot.durationTicks);
      noFxEvalTimes.push(performance.now() - t0);
    }
    noFxEvalTimes.sort((a, b) => a - b);

    const tPack0 = performance.now();
    const packed = await packArchive(fxProject, blobs);
    const packMs = performance.now() - tPack0;

    const tUnpack0 = performance.now();
    const unpacked = await unpackArchive(packed, async (bytes) => {
      const png = PNG.sync.read(Buffer.from(bytes));
      return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
    });
    const unpackMs = performance.now() - tUnpack0;

    expect(Object.keys(unpacked.project.nodes).length).toBe(105);

    console.info(
      `[F10 Bench] setup=${setupMs.toFixed(2)}ms | eval(FX) median=${percentile(fxEvalTimes, 0.5).toFixed(3)}ms p95=${percentile(fxEvalTimes, 0.95).toFixed(3)}ms | eval(noFX) median=${percentile(noFxEvalTimes, 0.5).toFixed(3)}ms p95=${percentile(noFxEvalTimes, 0.95).toFixed(3)}ms | archive write=${packMs.toFixed(2)}ms read=${unpackMs.toFixed(2)}ms size=${(packed.byteLength / 1024).toFixed(1)}KB`,
    );
  });
});
