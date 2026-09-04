import { describe, it, expect } from 'vitest';
import { CandleCache } from '../src/data/CandleCache.js';

const candle = (time) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 });

describe('CandleCache public coverage API', () => {
  it('exposes truthful intervals without requiring internal state access', () => {
    const cache = new CandleCache({ enableIDB: false });
    cache.set('BTCUSDT', '1m', 60, 180, [candle(60), candle(120), candle(180)], {
      timeframeSec: 60,
      venue: 'TEST',
    });

    expect(cache.getCoverage('BTCUSDT', '1m', { timeframeSec: 60, venue: 'TEST' })).toEqual([
      { from: 60, to: 180 },
    ]);
  });

  it('does not trust stale interval metadata when determining a cache hit', () => {
    const cache = new CandleCache({ enableIDB: false });
    cache.set('BTCUSDT', '1m', 60, 180, [candle(60), candle(120), candle(180)], {
      timeframeSec: 60,
      venue: 'TEST',
    });

    const key = cache._key('BTCUSDT', '1m', { venue: 'TEST', gridOrigin: 0 });
    cache._memory.get(key).intervals = [{ from: 60, to: 180 }];
    cache._memory.get(key).candles = [candle(60), candle(180)];

    const result = cache.get('BTCUSDT', '1m', 60, 180, { timeframeSec: 60, venue: 'TEST' });
    expect(result.hit).toBe(false);
    expect(result.missing).toEqual([{ from: 120, to: 120 }]);
    expect(result.intervals).toEqual([
      { from: 60, to: 60 },
      { from: 180, to: 180 },
    ]);
  });
});
