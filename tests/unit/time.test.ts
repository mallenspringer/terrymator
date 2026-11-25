import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { TICKS_PER_SECOND, frameIndexToTick, planFrames, positiveMod } from '../../src/domain/time';

describe('domain/time', () => {
  it('computes exact frame ticks at 24/30/60 fps', () => {
    expect(frameIndexToTick(0, 0, { num: 24, den: 1 })).toBe(0);
    expect(frameIndexToTick(0, 1, { num: 24, den: 1 })).toBe(5_000);
    expect(frameIndexToTick(0, 24, { num: 24, den: 1 })).toBe(TICKS_PER_SECOND);
    expect(frameIndexToTick(0, 1, { num: 30, den: 1 })).toBe(4_000);
    expect(frameIndexToTick(0, 1, { num: 60, den: 1 })).toBe(2_000);
  });

  it('plans half-open ranges with PTS starting at 0 and monotonic', () => {
    const frames = planFrames({ inTick: 0, outTick: TICKS_PER_SECOND / 2 }, { num: 24, den: 1 });
    expect(frames).toHaveLength(12);
    expect(frames[0]!.shotTick).toBe(0);
    expect(frames[0]!.ptsSeconds).toBe(0);
    expect(frames[11]!.shotTick).toBe(55_000);
    for (let i = 1; i < frames.length; i += 1) {
      expect(frames[i]!.ptsSeconds).toBeGreaterThan(frames[i - 1]!.ptsSeconds);
      expect(frames[i]!.shotTick).toBeLessThan(TICKS_PER_SECOND / 2);
    }
  });

  it('supports nonzero start and subframe-aligned end', () => {
    const frames = planFrames({ inTick: 25_000, outTick: 52_000 }, { num: 24, den: 1 });
    // 25000, 30000, 35000, 40000, 45000, 50000 -> 6 frames (55000 >= 52000 excluded)
    expect(frames.map((f) => f.shotTick)).toEqual([25_000, 30_000, 35_000, 40_000, 45_000, 50_000]);
    expect(frames[0]!.ptsSeconds).toBe(0);
  });

  it('rejects invalid ranges and invalid fps', () => {
    expect(() => planFrames({ inTick: -1, outTick: 10_000 }, { num: 24, den: 1 })).toThrow(AppError);
    expect(() => planFrames({ inTick: 10_000, outTick: 10_000 }, { num: 24, den: 1 })).toThrow(
      AppError,
    );
    expect(() => planFrames({ inTick: 0, outTick: 10_000 }, { num: 0, den: 1 })).toThrow(AppError);
  });

  it('property: positiveMod always lands in [0, modulus)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 1000, noNaN: true, noDefaultInfinity: true }),
        (v, m) => {
          const r = positiveMod(v, m);
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThan(m);
          expect(Object.is(r, -0)).toBe(false);
        },
      ),
    );
  });

  it('property: planFrames respects half-open [inTick, outTick)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 120_000 }),
        fc.integer({ min: 1, max: 240_000 }),
        fc.constantFrom(8, 12, 15, 24, 25, 30, 60),
        (inTick, len, fpsNum) => {
          const outTick = inTick + len;
          const frames = planFrames({ inTick, outTick }, { num: fpsNum, den: 1 });
          expect(frames.length).toBeGreaterThan(0);
          expect(frames[0]!.ptsSeconds).toBe(0);
          for (const f of frames) {
            expect(f.shotTick).toBeGreaterThanOrEqual(inTick);
            expect(f.shotTick).toBeLessThan(outTick);
          }
        },
      ),
    );
  });
});
