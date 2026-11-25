import { describe, expect, it } from 'vitest';
import {
  applyAlphaBrushStroke,
  applyCloneStampStroke,
  applyColorBrushStroke,
  applySelectionToMask,
  colorSelect,
  combineSelection,
  compositeCutoutAsset,
  extendCutoutBuffers,
  featherMask,
  growMask,
  magicWandSelect,
  rasterizeLasso,
  shrinkMask,
} from '../../src/assets/cutting';
import { buildF01ColorIslands, buildF02HiddenTorsoSheet } from '../../src/test-harness/fixtures';

describe('assets/cutting (F01 & F02)', () => {
  it('magicWandSelect stays on connected island while colorSelect captures disconnected islands', () => {
    const f01 = buildF01ColorIslands();
    // Left red island at (8, 16), right red island at (24, 16), blue separator at x=14..17
    const wand = magicWandSelect(f01.rgba, f01.width, f01.height, 8, 16, 10);
    expect(wand[16 * 32 + 8]).toBe(255);
    expect(wand[16 * 32 + 24]).toBe(0); // did NOT cross blue separator
    expect(wand[16 * 32 + 15]).toBe(0); // blue separator excluded
    expect(wand[0]).toBe(0); // transparent margin excluded

    const color = colorSelect(f01.rgba, f01.width, f01.height, 8, 16, 10);
    expect(color[16 * 32 + 8]).toBe(255);
    expect(color[16 * 32 + 24]).toBe(255); // both disconnected islands selected
    expect(color[16 * 32 + 15]).toBe(0);
  });

  it('rasterizes even-odd lasso and combines selections (replace/add/subtract)', () => {
    const outer = rasterizeLasso(20, 20, [
      { x: 2, y: 2 },
      { x: 18, y: 2 },
      { x: 18, y: 18 },
      { x: 2, y: 18 },
    ]);
    const hole = rasterizeLasso(20, 20, [
      { x: 6, y: 6 },
      { x: 14, y: 6 },
      { x: 14, y: 14 },
      { x: 6, y: 14 },
    ]);
    const donut = combineSelection(outer, hole, 'subtract');
    expect(donut[4 * 20 + 4]).toBe(255); // inside outer ring
    expect(donut[10 * 20 + 10]).toBe(0); // inside subtracted hole

    const mask = new Uint8Array(20 * 20).fill(255);
    const kept = applySelectionToMask(mask, donut, 'keep');
    expect(kept[4 * 20 + 4]).toBe(255);
    expect(kept[10 * 20 + 10]).toBe(0);
  });

  it('applies alpha brush restore/erase and morphology (grow/shrink/feather)', () => {
    const mask = new Uint8Array(20 * 20).fill(0);
    const painted = applyAlphaBrushStroke(mask, 20, 20, [{ x: 10, y: 10 }], {
      mode: 'restore',
      radius: 3,
      hardness: 1,
      opacity: 1,
    });
    expect(painted[10 * 20 + 10]).toBe(255);
    expect(painted[10 * 20 + 14]).toBe(0);

    const grown = growMask(painted, 20, 20, 2);
    expect(grown[10 * 20 + 14]).toBe(255);

    const shrunk = shrinkMask(grown, 20, 20, 2);
    expect(shrunk[10 * 20 + 14]).toBe(0);

    const feathered = featherMask(painted, 20, 20, 2);
    expect(feathered[10 * 20 + 13]!).toBeGreaterThan(0);
    expect(feathered[10 * 20 + 13]!).toBeLessThan(255);

    const erased = applyAlphaBrushStroke(painted, 20, 20, [{ x: 10, y: 10 }], {
      mode: 'erase',
      radius: 3,
      hardness: 1,
      opacity: 1,
    });
    expect(erased[10 * 20 + 10]).toBe(0);
  });

  it('clone stamps from immutable pre-stroke image, extends editRect preserving anchor, and composites without dark fringe', () => {
    const f02 = buildF02HiddenTorsoSheet();
    const w = f02.width;
    const h = f02.height;
    const preComposite = compositeCutoutAsset(f02.rgba, w, h, { x: 0, y: 0, width: w, height: h }, null, null, false);
    const overlay = new Uint8Array(w * h * 4);

    // Clone orange stripe from x=16 into arm-covered area x=32 (offsetX = -16)
    const cloned = applyCloneStampStroke(preComposite, overlay, w, h, [{ x: 32, y: 32 }], {
      offsetX: -16,
      offsetY: 0,
      radius: 4,
      hardness: 1,
      opacity: 1,
    });
    const px = (32 * w + 32) * 4;
    expect(cloned[px]).toBe(240);
    expect(cloned[px + 1]).toBe(120);
    expect(cloned[px + 2]).toBe(40);
    expect(cloned[px + 3]).toBe(255);

    // Color brush on transparent overlay avoids dark fringe (pure color, not darkened by black)
    const painted = applyColorBrushStroke(overlay, w, h, [{ x: 10, y: 10 }], {
      color: [200, 150, 100],
      radius: 3,
      hardness: 0.5,
      opacity: 0.5,
    });
    const edgeIdx = (10 * w + 10) * 4;
    expect(painted[edgeIdx]).toBe(200);
    expect(painted[edgeIdx + 1]).toBe(150);
    expect(painted[edgeIdx + 2]).toBe(100);
    expect(painted[edgeIdx + 3]).toBeGreaterThan(100);

    // Extend editRect by 16px on all sides and verify anchor shifts by (+16, +16)
    const mask = new Uint8Array(w * h).fill(255);
    const ext = extendCutoutBuffers({ x: 0, y: 0, width: w, height: h }, mask, cloned, {
      left: 16,
      top: 16,
      right: 16,
      bottom: 16,
    });
    expect(ext.editRect).toEqual({ x: -16, y: -16, width: 96, height: 96 });
    expect(ext.deltaAnchorX).toBe(16);
    expect(ext.deltaAnchorY).toBe(16);
    // Border pixel is masked out (0), interior shifted pixel preserves cloned color
    expect(ext.mask[0]).toBe(0);
    const shiftedPx = ((32 + 16) * 96 + (32 + 16)) * 4;
    expect(ext.overlay[shiftedPx]).toBe(240);
  });
});
