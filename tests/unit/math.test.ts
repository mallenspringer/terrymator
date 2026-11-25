import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import {
  applyAffineToPoint,
  composeLocalMatrix,
  invertAffine,
  multiplyAffine,
} from '../../src/domain/math';

describe('domain/math', () => {
  it('composes T * R * S * T(-pivot) accurately for 90 deg clockwise around nonzero pivot', () => {
    const m = composeLocalMatrix({
      x: 100,
      y: 50,
      angle: 90,
      sx: 1,
      sy: 1,
      pivotX: 10,
      pivotY: 20,
    });
    // Pivot point maps directly to (100, 50)
    const pPivot = applyAffineToPoint(m, { x: 10, y: 20 });
    expect(pPivot.x).toBeCloseTo(100, 6);
    expect(pPivot.y).toBeCloseTo(50, 6);

    // Point (20, 20) is +10 in local +x from pivot; rotated +90 deg CW (+x -> +y) -> (100, 60)
    const pRight = applyAffineToPoint(m, { x: 20, y: 20 });
    expect(pRight.x).toBeCloseTo(100, 6);
    expect(pRight.y).toBeCloseTo(60, 6);
  });

  it('supports negative scale flip and 3-level non-uniform hierarchy (shear)', () => {
    const root = composeLocalMatrix({ x: 10, y: 20, angle: 0, sx: 2, sy: 1, pivotX: 0, pivotY: 0 });
    const mid = composeLocalMatrix({ x: 0, y: 0, angle: 45, sx: 1, sy: 1, pivotX: 0, pivotY: 0 });
    const leaf = composeLocalMatrix({ x: 5, y: 0, angle: 0, sx: -1, sy: 1, pivotX: 0, pivotY: 0 });
    const world = multiplyAffine(multiplyAffine(root, mid), leaf);

    const pt = applyAffineToPoint(world, { x: 2, y: 0 });
    // leaf (2,0) -> (5 - 2, 0) = (3, 0); mid 45deg -> (3/sqrt2, 3/sqrt2); root sx=2,+10,+20
    const s = 3 / Math.SQRT2;
    expect(pt.x).toBeCloseTo(10 + 2 * s, 6);
    expect(pt.y).toBeCloseTo(20 + s, 6);
  });

  it('rejects near-zero singular scale', () => {
    expect(() =>
      composeLocalMatrix({ x: 0, y: 0, angle: 0, sx: 0, sy: 1, pivotX: 0, pivotY: 0 }),
    ).toThrow(AppError);
    expect(() =>
      composeLocalMatrix({ x: 0, y: 0, angle: 0, sx: 1, sy: 1e-8, pivotX: 0, pivotY: 0 }),
    ).toThrow(AppError);
  });

  it('property: invertAffine is exact inverse of non-singular composed matrices', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 500, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -500, max: 500, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -360, max: 360, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.2, max: 5, noNaN: true, noDefaultInfinity: true }),
        fc.constantFrom(-1, 1),
        fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
        (x, y, angle, scaleMag, sign, px, py) => {
          const m = composeLocalMatrix({
            x,
            y,
            angle,
            sx: scaleMag * sign,
            sy: scaleMag,
            pivotX: px,
            pivotY: py,
          });
          const inv = invertAffine(m);
          const roundtrip = applyAffineToPoint(inv, applyAffineToPoint(m, { x: 13.5, y: -7.25 }));
          expect(roundtrip.x).toBeCloseTo(13.5, 5);
          expect(roundtrip.y).toBeCloseTo(-7.25, 5);
        },
      ),
    );
  });
});
