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

test.describe('G2 browser rendering: cutting reconstruction & seeded materials', () => {
  test('reconstructs hidden torso behind moved arm in WebGL and roundtrips .collage', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__TERRYMATOR_HARNESS__));

    const res = await page.evaluate(async () => {
      const h = window.__TERRYMATOR_HARNESS__!;
      await h.loadFixture('F02_HIDDEN_TORSO');

      // Arm mask: keep only green strip x:24..39, y:10..53
      const armMask = new Array<number>(64 * 64).fill(0);
      for (let y = 10; y < 54; y += 1) {
        for (let x = 24; x < 40; x += 1) {
          armMask[y * 64 + x] = 255;
        }
      }
      await h.commitCutoutEdit({
        assetId: 'asset-arm',
        editRect: { x: 0, y: 0, width: 64, height: 64 },
        mask: armMask,
        overlay: null,
        anchorX: 32,
        anchorY: 32,
      });

      // Torso mask: full opaque, overlay: reconstruct orange [240,120,40,255] behind arm (x:24..39)
      const torsoMask = new Array<number>(64 * 64).fill(255);
      const torsoOverlay = new Array<number>(64 * 64 * 4).fill(0);
      for (let y = 10; y < 54; y += 1) {
        for (let x = 24; x < 40; x += 1) {
          const b = (y * 64 + x) * 4;
          torsoOverlay[b] = 240;
          torsoOverlay[b + 1] = 120;
          torsoOverlay[b + 2] = 40;
          torsoOverlay[b + 3] = 255;
        }
      }
      await h.commitCutoutEdit({
        assetId: 'asset-torso',
        editRect: { x: 0, y: 0, width: 64, height: 64 },
        mask: torsoMask,
        overlay: torsoOverlay,
        anchorX: 32,
        anchorY: 32,
      });

      // Move arm aside to x=200
      await h.dispatch({
        type: 'SET_NODE_TRANSFORM',
        nodeId: 'node-arm',
        transform: { x: 200, y: 90 },
      });

      const rendered = await h.render(0);
      const packed = await h.packCurrentArchive();
      await h.loadArchive(packed);
      const afterReopen = await h.render(0);

      h.dispose();
      return {
        rgba: rendered.rgba,
        sameAfterReopen: JSON.stringify(rendered.rgba) === JSON.stringify(afterReopen.rgba),
      };
    });

    // At (120, 90), arm moved away -> reconstructed orange torso is visible!
    const torsoPx = getPixel(res.rgba, 320, 120, 90);
    expect(torsoPx).toEqual([240, 120, 40, 255]);

    // At (200, 90), moved green arm is visible!
    const armPx = getPixel(res.rgba, 320, 200, 90);
    expect(armPx).toEqual([40, 190, 80, 255]);

    expect(res.sameAfterReopen).toBe(true);
  });

  test('renders F03 material hole transparency and isolates unique duplicate edits', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__TERRYMATOR_HARNESS__));

    const res = await page.evaluate(async () => {
      const h = window.__TERRYMATOR_HARNESS__!;
      await h.loadFixture('F03_PAPER_RECIPE');
      const r1 = await h.render(0);

      // Duplicate node, make unique, and recolor unique copy to blue
      await h.dispatch({
        type: 'DUPLICATE_NODE',
        sourceNodeId: 'node-paper',
        newNodeId: 'node-paper-2',
        offsetX: 90,
        offsetY: 0,
      });
      await h.dispatch({
        type: 'MAKE_ASSET_UNIQUE',
        nodeId: 'node-paper-2',
        newAssetId: 'asset-paper-unique',
      });
      const uniqueAsset = h.snapshot().assets['asset-paper-unique']!;
      if (uniqueAsset.kind === 'material') {
        await h.updateMaterialAsset({
          assetId: uniqueAsset.id,
          recipe: { ...uniqueAsset.recipe, baseColor: '#2255cc', seed: 777 },
        });
      }

      const r2 = await h.render(0);
      h.dispose();
      return { r1: r1.rgba, r2: r2.rgba };
    });

    // Hole at center (160, 90) is transparent
    expect(getPixel(res.r1, 320, 160, 90)[3]).toBe(0);
    // Opaque orange paper at (116, 126)
    const origPx = getPixel(res.r1, 320, 116, 126);
    expect(origPx[3]).toBe(255);
    expect(origPx[0]).toBeGreaterThan(origPx[2]);

    // After unique copy edit, original pixel at (116, 126) is unchanged, while unique copy at (206, 126) is blue
    expect(getPixel(res.r2, 320, 116, 126)).toEqual(origPx);
    const uniquePx = getPixel(res.r2, 320, 206, 126);
    expect(uniquePx[3]).toBe(255);
    expect(uniquePx[2]).toBeGreaterThan(uniquePx[0]);
  });
});
