import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { evaluateScene } from '../../src/domain/evaluator';
import { packArchive, unpackArchive } from '../../src/persistence/zip';
import { PNG } from 'pngjs';
import { buildG0DemoFixture } from '../../src/test-harness/fixtures';

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx]!;
}

describe('bench/g0 smoke', () => {
  it('measures 1000 pure evaluations and 20 archive roundtrips', async () => {
    const { project, blobs } = buildG0DemoFixture();
    const evalTimes: number[] = [];

    for (let i = 0; i < 1000; i += 1) {
      const t0 = performance.now();
      evaluateScene(project, (i * 5000) % 240_000);
      evalTimes.push(performance.now() - t0);
    }
    evalTimes.sort((a, b) => a - b);

    const archiveTimes: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now();
      const packed = await packArchive(project, blobs);
      await unpackArchive(packed, async (bytes) => {
        const png = PNG.sync.read(Buffer.from(bytes));
        return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
      });
      archiveTimes.push(performance.now() - t0);
    }
    archiveTimes.sort((a, b) => a - b);

    console.info(
      `[G0 Bench] eval median=${percentile(evalTimes, 0.5).toFixed(3)}ms p95=${percentile(evalTimes, 0.95).toFixed(3)}ms | archive roundtrip median=${percentile(archiveTimes, 0.5).toFixed(2)}ms p95=${percentile(archiveTimes, 0.95).toFixed(2)}ms`,
    );

    expect(evalTimes.length).toBe(1000);
    expect(archiveTimes.length).toBe(20);
  });
});
