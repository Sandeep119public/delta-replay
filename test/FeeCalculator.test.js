import { describe, expect, it } from 'vitest';
import { FeeCalculator } from '../src/trading/FeeCalculator.js';

describe('FeeCalculator', () => {
  it('calculates fee from notional and rate', () => {
    expect(FeeCalculator.calculate(1000, 0.0005)).toBe(0.5);
  });

  it('returns zero for invalid or non-positive inputs', () => {
    expect(FeeCalculator.calculate(0, 0.001)).toBe(0);
    expect(FeeCalculator.calculate(-1, 0.001)).toBe(0);
    expect(FeeCalculator.calculate(1000, -0.001)).toBe(0);
    expect(FeeCalculator.calculate(Number.NaN, 0.001)).toBe(0);
  });
});
