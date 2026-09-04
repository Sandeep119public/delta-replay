import { describe, it, expect } from 'vitest';
import { computeGridMissing, normalizeRange } from '../src/data/CandleGrid.js';

describe('CandleGrid regressions', () => {
  it('does not fabricate an off-grid boundary from contiguous coverage', () => {
    expect(computeGridMissing(1000, 1180, [{ from: 1000, to: 1060 }], 60))
      .toEqual([{ from: 1120, to: 1180 }]);
  });

  it('preserves the requested/effective range contract', () => {
    const range = normalizeRange(1001, 1181, 60, 0);
    expect(range.requestedFrom).toBe(1001);
    expect(range.requestedTo).toBe(1181);
    expect(range.effectiveFrom).toBe(1020);
    expect(range.effectiveTo).toBe(1140);
    expect(range.effectiveFrom).toBeGreaterThanOrEqual(range.requestedFrom);
    expect(range.effectiveTo).toBeLessThanOrEqual(range.requestedTo);
  });
});
