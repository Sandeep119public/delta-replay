import { describe, it, expect } from 'vitest';
import { CandleNormalizer } from '../src/data/CandleNormalizer.js';

describe('CandleNormalizer', () => {
  it('normalizes seconds timestamp intact', () => {
    const raw = { time: 1700000000, open: 100, high: 110, low: 90, close: 105, volume: 10 };
    const c = CandleNormalizer.normalize(raw);
    expect(c.time).toBe(1700000000);
  });

  it('converts millisecond timestamp to seconds', () => {
    const raw = { time: 1700000000 * 1000, open: 100, high: 110, low: 90, close: 105, volume: 10 };
    const c = CandleNormalizer.normalize(raw);
    expect(c.time).toBe(1700000000);
  });

  it('handles t/o/h/l/c/v alias', () => {
    const raw = { t: 1700000000, o: 100, h: 110, l: 90, c: 105, v: 10 };
    const c = CandleNormalizer.normalize(raw);
    expect(c.time).toBe(1700000000);
    expect(c.open).toBe(100);
  });

  it('handles array form', () => {
    const raw = [1700000000, 100, 110, 90, 105, 10];
    const c = CandleNormalizer.normalize(raw);
    expect(c.time).toBe(1700000000);
  });

  it('handles timestamp alias', () => {
    const raw = { timestamp: 1700000000, open: 100, high: 110, low: 90, close: 105, volume: 5 };
    const c = CandleNormalizer.normalize(raw);
    expect(c.time).toBe(1700000000);
  });

  it('throws on missing time', () => {
    expect(() => CandleNormalizer.normalize({ open: 1, high: 2, low: 1, close: 1 })).toThrow();
  });

  it('normalizes batch', () => {
    const batch = [
      { time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 },
      { time: 1700000060, open: 1.5, high: 2, low: 1, close: 1.8, volume: 1 }
    ];
    const out = CandleNormalizer.normalizeBatch(batch);
    expect(out.length).toBe(2);
  });
});
