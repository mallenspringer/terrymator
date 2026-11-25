import { describe, expect, it } from 'vitest';
import { synthesizeMaterial } from '../../src/assets/materialSynthesis';
import { createSolidSquare } from '../../src/assets/synthetic';
import {
  createDefaultMaterialRecipe,
  type MaterialPatternKind,
  type MaterialPreset,
} from '../../src/domain/schema';
import { buildF03PaperRecipeData } from '../../src/test-harness/fixtures';

describe('assets/materialSynthesis (F03)', () => {
  it('is strictly deterministic for identical seed & recipe, and varies when seed changes', () => {
    const r1 = buildF03PaperRecipeData();
    const out1a = synthesizeMaterial(r1);
    const out1b = synthesizeMaterial(r1);
    expect(Buffer.compare(Buffer.from(out1a.rgba), Buffer.from(out1b.rgba))).toBe(0);

    const out2 = synthesizeMaterial({ ...r1, seed: 9999 });
    expect(Buffer.compare(Buffer.from(out1a.rgba), Buffer.from(out2.rgba))).not.toBe(0);
  });

  it('cuts boolean ellipse hole cleanly (alpha=0 inside hole, opaque paper outside)', () => {
    const recipe = buildF03PaperRecipeData();
    const out = synthesizeMaterial(recipe);

    // Center (64, 64) is inside subtracted ellipse (x:44..84, y:44..84)
    const holeIdx = (64 * 128 + 64) * 4;
    expect(out.rgba[holeIdx + 3]).toBe(0);

    // Outside rect (2, 2) is transparent
    const outIdx = (2 * 128 + 2) * 4;
    expect(out.rgba[outIdx + 3]).toBe(0);

    // Inside paper (20, 100) is opaque
    const paperIdx = (100 * 128 + 20) * 4;
    expect(out.rgba[paperIdx + 3]).toBe(255);
  });

  it('supports all 6 presets and 5 graphic patterns deterministically', () => {
    const presets: MaterialPreset[] = [
      'construction-paper',
      'kraft-cardboard',
      'felt',
      'aged-paper',
      'fabric',
      'halftone',
    ];
    const patterns: MaterialPatternKind[] = [
      'stripes',
      'dots',
      'grid',
      'checkerboard',
      'crosshatch',
    ];

    for (const preset of presets) {
      const r = createDefaultMaterialRecipe({ width: 48, height: 48, preset });
      const res = synthesizeMaterial(r);
      expect(res.rgba[(24 * 48 + 24) * 4 + 3]).toBe(255);
    }

    for (const kind of patterns) {
      const r = createDefaultMaterialRecipe({
        width: 48,
        height: 48,
        pattern: { kind, color: '#112233', opacity: 0.5, scale: 8 },
      });
      const res = synthesizeMaterial(r);
      expect(res.rgba[(24 * 48 + 24) * 4 + 3]).toBe(255);
    }
  });

  it('applies imported photo material under shape mask (MAT-06)', () => {
    const photo = createSolidSquare(32, 32, [30, 190, 220, 255]);
    const recipe = createDefaultMaterialRecipe({
      width: 64,
      height: 64,
      grainIntensity: 0,
      edgeIrregularity: 0,
      edgeDarkening: 0,
      imageSourceId: 'src-photo',
      shapes: [{ id: 'e1', kind: 'ellipse', op: 'union', x: 16, y: 16, width: 32, height: 32 }],
    });
    const out = synthesizeMaterial(recipe, photo);
    const center = (32 * 64 + 32) * 4;
    expect(out.rgba[center]).toBe(30);
    expect(out.rgba[center + 1]).toBe(190);
    expect(out.rgba[center + 2]).toBe(220);
    expect(out.rgba[center + 3]).toBe(255);

    const corner = (2 * 64 + 2) * 4;
    expect(out.rgba[corner + 3]).toBe(0);
  });
});
