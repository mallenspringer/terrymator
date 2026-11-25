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

test.describe('G3 browser rendering: F04 jointed puppet & F06 camera/parallax', () => {
  test('renders F04 articulated rig, independent draw order, preserve-world pivot, and wireframe isolation', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__TERRYMATOR_HARNESS__));

    const res = await page.evaluate(async () => {
      const h = window.__TERRYMATOR_HARNESS__!;
      await h.loadFixture('F04_JOINTED_PUPPET');

      const base = await h.render(0);

      // Preserve-world pivot change on upper-arm must produce identical rendered pixels
      await h.dispatch({
        type: 'SET_NODE_PIVOT_PRESERVE_WORLD',
        nodeId: 'upper-arm',
        pivotX: 0,
        pivotY: 0,
      });
      const afterPivot = await h.render(0);

      // Reset pivot and rotate upper-arm 90 deg -> hand swings down!
      await h.dispatch({
        type: 'SET_NODE_PIVOT_PRESERVE_WORLD',
        nodeId: 'upper-arm',
        pivotX: -16,
        pivotY: 0,
      });
      await h.dispatch({
        type: 'SET_NODE_TRANSFORM',
        nodeId: 'upper-arm',
        transform: { angle: 90 },
      });
      const rotated = await h.render(0);
      const evalRotated = h.evaluate(0);
      const handJoint = evalRotated.joints.find((j) => j.nodeId === 'hand')!;

      // Wireframe overlay renders differently from clean export render
      const withWire = await h.render(0, { showWireframe: true });
      h.dispose();

      return {
        base: base.rgba,
        afterPivot: afterPivot.rgba,
        rotated: rotated.rgba,
        withWire: withWire.rgba,
        handPos: handJoint.worldPivot,
      };
    });

    // Preserve-world pivot produces bit-for-bit identical output
    expect(res.afterPivot).toEqual(res.base);

    // At (170, 75), upper-arm(z:10) overlaps torso(z:20) -> torso red wins
    const torsoWin = getPixel(res.base, 320, 170, 75);
    expect(torsoWin).toEqual([200, 50, 50, 255]);

    // When upper-arm rotates 90 deg, hand moves to evaluated worldPivot -> blue pixel at handPos!
    const hx = Math.round(res.handPos.x);
    const hy = Math.round(res.handPos.y);
    const handPx = getPixel(res.rotated, 320, hx, hy);
    expect(handPx).toEqual([50, 130, 240, 255]);

    // Wireframe overlay adds visible guide pixels not present in clean render
    expect(res.withWire).not.toEqual(res.rotated);
  });

  test('renders F06 repeating tiles (mirrorX, single-row repeatY=false) and camera zoom/pan', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__TERRYMATOR_HARNESS__));

    const res = await page.evaluate(async () => {
      const h = window.__TERRYMATOR_HARNESS__!;
      await h.loadFixture('F06_PARALLAX');
      const r0 = await h.render(0);

      await h.dispatch({
        type: 'SET_CAMERA',
        x: 160,
        y: 90,
        zoom: 1.5,
      });
      const rZoomed = await h.render(0);
      h.dispose();
      return { r0: r0.rgba, rZoomed: rZoomed.rgba };
    });

    // Row 80..111 has hills-tiles (32px tall), repeatY=false -> row 125 is empty (transparent)
    expect(getPixel(res.r0, 320, 50, 95)[3]).toBe(255);
    expect(getPixel(res.r0, 320, 50, 125)[3]).toBe(0);

    // Zooming camera changes rendered pixels
    expect(res.rZoomed).not.toEqual(res.r0);
  });
});
