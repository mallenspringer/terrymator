import { expect, test } from '@playwright/test';
import type { StudioHarness } from '../../src/test-harness/harness';

declare global {
  interface Window {
    __TERRYMATOR_HARNESS__?: StudioHarness;
  }
}

function getPixel(rgba: number[], width: number, x: number, y: number): [number, number, number, number] {
  const idx = (y * width + x) * 4;
  return [rgba[idx]!, rgba[idx + 1]!, rgba[idx + 2]!, rgba[idx + 3]!];
}

test.describe('PixiJS v8 deterministic rendering & effects', () => {
  test('renders G0_DEMO deterministically with drawOrder, alpha, tiling, and stage-relative shadow', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__TERRYMATOR_HARNESS__));

    const result = await page.evaluate(async () => {
      const h = window.__TERRYMATOR_HARNESS__!;
      await h.loadFixture('G0_DEMO');

      const f0a = await h.render(0);
      const f60a = await h.render(60_000);
      const f120 = await h.render(120_000);
      const f60b = await h.render(60_000);
      const f0b = await h.render(0);

      // Verify zero frame accumulation on repeated renders of same tick
      const f0c = await h.render(0);

      // Test negative tile offset wrapping
      await h.dispatch({
        type: 'SET_NODE_VISIBILITY',
        nodeId: 'tile-bg',
        visible: true,
      });
      const tileAtZero = await h.render(0);

      // Test resource cleanup
      h.dispose();
      const afterDispose = h.resources();

      return {
        width: f0a.width,
        height: f0a.height,
        f0a: f0a.rgba,
        f0b: f0b.rgba,
        f0c: f0c.rgba,
        f60a: f60a.rgba,
        f60b: f60b.rgba,
        f120Len: f120.rgba.length,
        tilePixel: [tileAtZero.rgba[0], tileAtZero.rgba[1], tileAtZero.rgba[2], tileAtZero.rgba[3]],
        afterDispose,
      };
    });

    expect(errors).toEqual([]);
    expect(result.width).toBe(320);
    expect(result.height).toBe(180);
    expect(result.f120Len).toBe(320 * 180 * 4);

    // Determinism regardless of seek order and no frame accumulation
    expect(result.f0a).toEqual(result.f0b);
    expect(result.f0a).toEqual(result.f0c);
    expect(result.f60a).toEqual(result.f60b);

    // Transparent background probe
    const bgPx = getPixel(result.f0a, 320, 315, 5);
    expect(bgPx).toEqual([0, 0, 0, 0]);

    // Semitransparent border band of torso (alpha = 128) at (186, 63), outside tile-bg and arm
    const semiPx = getPixel(result.f0a, 320, 186, 63);
    expect(semiPx[3]).toBeGreaterThanOrEqual(126);
    expect(semiPx[3]).toBeLessThanOrEqual(130);

    // Global drawOrder probes: arm(10) < torso(20) < hand(30)
    const torsoOverArm = getPixel(result.f0a, 320, 175, 90);
    expect(torsoOverArm[0]).toBeGreaterThan(150);
    expect(torsoOverArm[1]).toBeLessThan(100);

    const pureArm = getPixel(result.f0a, 320, 205, 90);
    expect(pureArm[1]).toBeGreaterThan(150);
    expect(pureArm[0]).toBeLessThan(100);

    const handOverTorso = getPixel(result.f0a, 320, 185, 90);
    expect(handOverTorso[2]).toBeGreaterThan(200);
    expect(handOverTorso[0]).toBeLessThan(100);

    // Stage-relative drop shadow on 90-deg rotated fx-badge at (260, 90), globalShadowAngle = 45
    // Bottom-right shadow region (279, 109) must have dark shadow alpha > 0
    const shadowBr = getPixel(result.f0a, 320, 279, 109);
    expect(shadowBr[3]).toBeGreaterThan(20);

    // Tiled layer with negative offset renders opaque pixels at (0,0)
    expect(result.tilePixel[3]).toBe(255);

    // Resource disposal leaves zero owned GPU resources
    expect(result.afterDispose.textures).toBe(0);
    expect(result.afterDispose.mirroredTextures).toBe(0);
    expect(result.afterDispose.filters).toBe(0);
    expect(result.afterDispose.activeRenderTargets).toBe(0);
    expect(result.afterDispose.activeEncoders).toBe(0);
  });
});
