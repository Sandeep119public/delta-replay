import { describe, it, expect } from 'vitest';
import { MarginEngine } from '../src/trading/MarginEngine.js';

describe('MarginEngine configuration validation', () => {
  it('rejects non-finite and out-of-range margin rates', () => {
    for (const value of [NaN, Infinity, -Infinity, -0.1, 1.01]) {
      expect(() => new MarginEngine({ marginRate: value })).toThrow(/marginRate/);
    }
  });
  it('accepts zero margin for explicit characterization scenarios', () => {
    const engine = new MarginEngine({ marginRate: 0, maintMarginRate: 0 });
    expect(engine.getEffectiveIMRate()).toBe(0);
    expect(engine.getEffectiveMMRate()).toBe(0);
  });
  it('rejects maintenance margin above initial margin', () => {
    expect(() => new MarginEngine({ marginRate: 0.1, maintMarginRate: 0.11 })).toThrow(/maintMarginRate must be <= marginRate/);
  });
  it('accepts valid rates and can atomically update them', () => {
    const engine = new MarginEngine({ marginRate: 0.1, maintMarginRate: 0.05 });
    expect(engine.setRates({ marginRate: 0.2, maintMarginRate: 0.1 })).toEqual({ marginRate: 0.2, maintMarginRate: 0.1 });
  });
  it('does not partially apply an invalid rate update', () => {
    const engine = new MarginEngine({ marginRate: 0.2, maintMarginRate: 0.1 });
    expect(() => engine.setRates({ marginRate: 0.05, maintMarginRate: 0.1 })).toThrow(/maintMarginRate must be <= marginRate/);
    expect(engine.setRates()).toEqual({ marginRate: 0.2, maintMarginRate: 0.1 });
  });
});
