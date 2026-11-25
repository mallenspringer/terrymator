import { unzipSync } from 'fflate';
import { expect, test } from '@playwright/test';
import type { StudioHarness } from '../../src/test-harness/harness';

declare global {
  interface Window {
    __TERRYMATOR_HARNESS__?: StudioHarness;
  }
}

test.describe('G4 browser rendering: F05 seek determinism & sub-range export', () => {
  test('renders F05_WALKING_LOOP identically across random vs forward seeks and exports nonzero sub-range', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__TERRYMATOR_HARNESS__));

    const res = await page.evaluate(async () => {
      const h = window.__TERRYMATOR_HARNESS__!;
      await h.loadFixture('F05_WALKING_LOOP');

      const t0a = await h.render(0);
      const t60a = await h.render(60_000);
      const t120a = await h.render(120_000);
      // Random seek back
      const t60b = await h.render(60_000);
      const t0b = await h.render(0);
      const t120b = await h.render(120_000);

      // Export nonzero sub-range on F09_EXPORT_CLOCK: [10000, 40000) @ 24fps => 6 frames
      await h.loadFixture('F09_EXPORT_CLOCK');
      const subExport = await h.exportRange({
        format: 'png-sequence',
        range: { inTick: 10_000, outTick: 40_000 },
        fps: { num: 24, den: 1 },
        alpha: true,
      });

      h.dispose();
      return {
        eq0: JSON.stringify(t0a.rgba) === JSON.stringify(t0b.rgba),
        eq60: JSON.stringify(t60a.rgba) === JSON.stringify(t60b.rgba),
        eq120: JSON.stringify(t120a.rgba) === JSON.stringify(t120b.rgba),
        movedAcrossStage: JSON.stringify(t0a.rgba) !== JSON.stringify(t120a.rgba),
        subFrameCount: subExport.frameCount,
        subBytes: subExport.bytes,
      };
    });

    expect(res.eq0).toBe(true);
    expect(res.eq60).toBe(true);
    expect(res.eq120).toBe(true);
    expect(res.movedAcrossStage).toBe(true);
    expect(res.subFrameCount).toBe(6);

    const unzipped = unzipSync(new Uint8Array(res.subBytes));
    const manifest = JSON.parse(Buffer.from(unzipped['manifest.json']!).toString('utf8')) as {
      frames: Array<{ shotTick: number; ptsSeconds: number }>;
    };
    expect(manifest.frames.map((f) => f.shotTick)).toEqual([
      10_000, 15_000, 20_000, 25_000, 30_000, 35_000,
    ]);
    expect(manifest.frames[0]!.ptsSeconds).toBe(0);
  });
});
