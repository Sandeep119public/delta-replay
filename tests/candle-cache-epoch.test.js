import { describe, expect, it } from 'vitest';
import { CandleCache } from '../src/data/CandleCache.js';

const epochCandle = {
  time: 0,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1,
};

describe('CandleCache timestamp boundaries', () => {
  it('accepts a valid candle at Unix epoch time zero', () => {
    const cache = new CandleCache({ enableIDB: false });
    cache.replace('BTCUSDT', '1m', [epochCandle], {
      timeframeSec: 60,
      gridOrigin: 0,
    });

    const result = cache.get('BTCUSDT', '1m', 0, 0, {
      timeframeSec: 60,
      gridOrigin: 0,
    });

    expect(result.hit).toBe(true);
    expect(result.candles).toEqual([epochCandle]);
  });
});
