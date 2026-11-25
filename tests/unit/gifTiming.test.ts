import { describe, expect, it } from 'vitest';
import { computeGifDelaysCs } from '../../src/export/gifEncoder';

describe('export/gifEncoder timing', () => {
  it('uses cumulative centisecond rounding so 24 frames at 24 fps sum to 100 cs', () => {
    const delays = computeGifDelaysCs(24, { num: 24, den: 1 });
    expect(delays).toHaveLength(24);
    expect(delays.every((d) => d >= 2)).toBe(true);
    const sum = delays.reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('clamps ultra-high fps delays to >= 2 cs minimum', () => {
    const delays = computeGifDelaysCs(10, { num: 120, den: 1 });
    expect(delays.every((d) => d >= 2)).toBe(true);
  });
});
