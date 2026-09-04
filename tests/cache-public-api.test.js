import { describe, it, expect } from 'vitest';
import { CandleCache } from '../src/data/CandleCache.js';

describe('CandleCache public coverage API', () => {
  it('exposes truthful intervals without requiring internal state access', () => {
    const cache = new CandleCache({ enableIDB: false });
    cache.set('BTCUSDT', '1m', 60, 180, [
      { time: 60, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 120, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 180, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ], { timeframeSec: 60, venue: 'TEST' });

    expect(cache.getCoverage('BTCUSDT', '1m', { timeframeSec: 60, venue: 'TEST' })).toEqual([
      { from: 60, to: 180 },
    ]);
  });
});
