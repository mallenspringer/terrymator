import { expect, test } from '@playwright/test';
import { encodePngRgba } from '../../src/assets/pngCodec';
import { createSolidSquare } from '../../src/assets/synthetic';
import type { StudioHarness } from '../../src/test-harness/harness';

declare global {
  interface Window {
    __TERRYMATOR_HARNESS__?: StudioHarness;
  }
}

test.describe('G1 browser lifecycle: import, archive roundtrip, IndexedDB recovery, and GPU cleanup', () => {
  test('imports PNG, shares source across assets, roundtrips .collage, recovers via IndexedDB, and releases GPU textures', async ({
    page,
  }) => {
    const img = createSolidSquare(48, 48, [40, 200, 140, 255]);
    const pngBytes = Array.from(encodePngRgba(img.rgba, 48, 48));

    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__TERRYMATOR_HARNESS__));

    const res = await page.evaluate(async (bytes) => {
      const h = window.__TERRYMATOR_HARNESS__!;
      await h.discardRecovery();
      await h.dispatch({ type: 'NEW_SHOT', projectId: 'g1-browser', width: 320, height: 180 });

      const imp1 = await h.importSource('leaf.png', bytes, { createInitialAsset: true });
      const imp2 = await h.importSource('leaf-dup.png', bytes, { createInitialAsset: false });

      await h.dispatch({
        type: 'ADD_NODE',
        node: {
          id: 'node-leaf-1',
          name: 'Leaf 1',
          kind: 'sprite',
          parentId: null,
          assetId: imp1.assetId!,
          transform: { x: 80, y: 90, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
          opacity: 1,
          visible: true,
          locked: false,
          drawOrder: 1,
          effects: h.snapshot().nodes['node-leaf-1']?.effects ?? {
            dropShadow: {
              enabled: false,
              color: '#000000',
              opacity: 0.5,
              distance: 8,
              softness: 4,
              useGlobalAngle: true,
              angle: 45,
            },
            outerGlow: { enabled: false, color: '#ffffff', intensity: 1, radius: 8 },
            colorAdjust: {
              enabled: false,
              tint: '#ffffff',
              tintAmount: 0,
              brightness: 0,
              contrast: 0,
            },
          },
        },
      });

      const beforeRender = await h.render(0);
      const packed = await h.packCurrentArchive();

      // Save to real browser IndexedDB recovery
      const recInfo = await h.saveRecovery();

      // Switch to G0_DEMO (different project), verify textures cleared on switch
      await h.loadFixture('G0_DEMO');
      await h.render(0);
      const demoTexCount = h.resources().textures;

      // Reload packed archive
      await h.loadArchive(packed);
      const afterArchiveRender = await h.render(0);
      const archiveTexCount = h.resources().textures;

      // Recover from IndexedDB
      await h.recoverFromStorage();
      const afterRecoveryRender = await h.render(0);
      const inspectedAfter = await h.inspectRecovery();
      await h.discardRecovery();
      const inspectedDiscarded = await h.inspectRecovery();

      h.dispose();
      const afterDispose = h.resources();

      return {
        dedup1: imp1.deduplicated,
        dedup2: imp2.deduplicated,
        recInfo,
        demoTexCount,
        archiveTexCount,
        sameArchiveRgba: JSON.stringify(beforeRender.rgba) === JSON.stringify(afterArchiveRender.rgba),
        sameRecoveryRgba:
          JSON.stringify(beforeRender.rgba) === JSON.stringify(afterRecoveryRender.rgba),
        inspectedAfterNotNull: inspectedAfter !== null,
        inspectedDiscardedNull: inspectedDiscarded === null,
        afterDispose,
      };
    }, pngBytes);

    expect(res.dedup1).toBe(false);
    expect(res.dedup2).toBe(true);
    expect(res.demoTexCount).toBeGreaterThan(1);
    expect(res.archiveTexCount).toBe(1);
    expect(res.sameArchiveRgba).toBe(true);
    expect(res.sameRecoveryRgba).toBe(true);
    expect(res.inspectedAfterNotNull).toBe(true);
    expect(res.inspectedDiscardedNull).toBe(true);
    expect(res.afterDispose.textures).toBe(0);
    expect(res.afterDispose.activeRenderTargets).toBe(0);
  });
});
