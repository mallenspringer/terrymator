import { PNG } from 'pngjs';
import { expect, test } from '@playwright/test';
import type { StudioHarness } from '../../src/test-harness/harness';

declare global {
  interface Window {
    __TERRYMATOR_HARNESS__?: StudioHarness;
  }
}

test.describe('G5 browser rendering: F07 lighting/FX & F10 stress stability', () => {
  test('verifies F07 global vs override shadow angle, green tint, zero filter accumulation, and preview-vs-still equality', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__TERRYMATOR_HARNESS__));

    const result = await page.evaluate(async () => {
      const h = window.__TERRYMATOR_HARNESS__!;
      await h.loadFixture('F07_LIGHTING');

      const samplePixel = (rgba: number[], w: number, x: number, y: number) => {
        const idx = (y * w + x) * 4;
        return [rgba[idx]!, rgba[idx + 1]!, rgba[idx + 2]!, rgba[idx + 3]!] as const;
      };

      // 1. Initial render (globalShadowAngle = 0 -> shadow to the right of node-global-shadow at x=150, y=180, width=80)
      const r0 = await h.render(0);
      const globalRight = samplePixel(r0.rgba, r0.width, 200, 180);
      const globalBelow = samplePixel(r0.rgba, r0.width, 150, 230);

      // Override box at x=320, y=180 has angle=90 -> shadow below (x=320, y=230), not to the right (x=370, y=180)
      const overrideRight0 = samplePixel(r0.rgba, r0.width, 370, 180);
      const overrideBelow0 = samplePixel(r0.rgba, r0.width, 320, 230);

      // Tint/glow box at x=490, y=180 has green tint -> center pixel (490, 180) should be green-dominant
      const tintCenter = samplePixel(r0.rgba, r0.width, 490, 180);

      // 2. Preview vs still PNG export equality
      const still = await h.exportRange({
        format: 'png-still',
        range: { inTick: 0, outTick: 1 },
        fps: { num: 24, den: 1 },
        alpha: false,
        matteColor: '#f0f0f0',
      });

      // 3. Change global shadow angle to 180 (left) -> global box shadow flips left, override box stays below
      await h.dispatch({ type: 'SET_GLOBAL_SHADOW_ANGLE', angle: 180 });
      const r180 = await h.render(0);
      const globalLeft180 = samplePixel(r180.rgba, r180.width, 100, 180);
      const globalRight180 = samplePixel(r180.rgba, r180.width, 200, 180);
      const overrideBelow180 = samplePixel(r180.rgba, r180.width, 320, 230);

      // 4. Zero-accumulation check: render 5 times consecutively and compare r180 vs 5th render
      let rFifth = r180;
      for (let i = 0; i < 4; i += 1) {
        rFifth = await h.render(0);
      }
      let maxDiff = 0;
      for (let i = 0; i < r180.rgba.length; i += 1) {
        const d = Math.abs(r180.rgba[i]! - rFifth.rgba[i]!);
        if (d > maxDiff) maxDiff = d;
      }

      // 5. Disable effects on tint box -> returns to white
      await h.dispatch({
        type: 'SET_NODE_EFFECTS',
        nodeId: 'node-tint-glow',
        effects: {
          dropShadow: {
            enabled: false,
            color: '#000000',
            opacity: 0.5,
            distance: 8,
            softness: 4,
            useGlobalAngle: true,
            angle: 45,
          },
          outerGlow: { enabled: false, color: '#ffffff', intensity: 0, radius: 8 },
          colorAdjust: {
            enabled: false,
            tint: '#ffffff',
            tintAmount: 0,
            brightness: 0,
            contrast: 0,
          },
        },
      });
      const rDisabled = await h.render(0);
      const tintCenterDisabled = samplePixel(rDisabled.rgba, rDisabled.width, 490, 180);

      h.dispose();
      return {
        globalRight,
        globalBelow,
        overrideRight0,
        overrideBelow0,
        tintCenter,
        tintCenterDisabled,
        globalLeft180,
        globalRight180,
        overrideBelow180,
        maxDiff,
        r0Rgba: r0.rgba,
        stillBytes: still.bytes,
      };
    });

    // Global shadow at 0 deg: right is dark (< 60), below is light (> 200)
    expect(result.globalRight[0]).toBeLessThan(60);
    expect(result.globalBelow[0]).toBeGreaterThan(200);

    // Override shadow at 90 deg: right is light (> 200), below is dark (< 60)
    expect(result.overrideRight0[0]).toBeGreaterThan(200);
    expect(result.overrideBelow0[0]).toBeLessThan(60);

    // Green tint on white square: G > 200, R < 40, B < 40
    expect(result.tintCenter[1]).toBeGreaterThan(200);
    expect(result.tintCenter[0]).toBeLessThan(40);
    expect(result.tintCenter[2]).toBeLessThan(40);

    // After disabling effects: back to pure white
    expect(result.tintCenterDisabled[0]).toBeGreaterThan(240);
    expect(result.tintCenterDisabled[1]).toBeGreaterThan(240);
    expect(result.tintCenterDisabled[2]).toBeGreaterThan(240);

    // After globalShadowAngle = 180: global flips left, override remains below
    expect(result.globalLeft180[0]).toBeLessThan(60);
    expect(result.globalRight180[0]).toBeGreaterThan(200);
    expect(result.overrideBelow180[0]).toBeLessThan(60);

    // Zero filter accumulation across 5 renders
    expect(result.maxDiff).toBe(0);

    // Preview vs png-still equality
    const decodedStill = PNG.sync.read(Buffer.from(result.stillBytes));
    expect(decodedStill.data.length).toBe(result.r0Rgba.length);
    let maxExportDiff = 0;
    for (let i = 0; i < decodedStill.data.length; i += 1) {
      const d = Math.abs(decodedStill.data[i]! - result.r0Rgba[i]!);
      if (d > maxExportDiff) maxExportDiff = d;
    }
    expect(maxExportDiff).toBe(0);
  });

  test('loads, renders, exports, and disposes F10_STRESS_SCENE 3x without leaking GPU/object resources', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__TERRYMATOR_HARNESS__));

    const stats = await page.evaluate(async () => {
      const h = window.__TERRYMATOR_HARNESS__!;
      const runs = [];
      for (let i = 0; i < 3; i += 1) {
        await h.loadFixture('F10_STRESS_SCENE');
        const rendered = await h.render(i * 60_000);
        const still = await h.exportRange({
          format: 'png-still',
          range: { inTick: 0, outTick: 1 },
          fps: { num: 24, den: 1 },
          alpha: true,
        });
        h.dispose();
        runs.push({
          width: rendered.width,
          height: rendered.height,
          stillBytes: still.bytes.length,
          resources: h.resources(),
        });
      }
      return runs;
    });

    expect(stats).toHaveLength(3);
    for (const run of stats) {
      expect(run.width).toBe(1920);
      expect(run.height).toBe(1080);
      expect(run.stillBytes).toBeGreaterThan(1000);
      expect(run.resources.textures).toBe(0);
      expect(run.resources.mirroredTextures).toBe(0);
      expect(run.resources.filters).toBe(0);
      expect(run.resources.activeRenderTargets).toBe(0);
      expect(run.resources.objectUrls).toBe(0);
      expect(run.resources.activeEncoders).toBe(0);
    }
  });
});
