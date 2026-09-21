import { describe, expect, it, vi } from 'vitest';
import { StoredDatasetProvider } from '../src/data/StoredDatasetProvider.js';
import { CandleCache } from '../src/data/CandleCache.js';

function candle(time, close = 100) {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 10 };
}

describe('deep-audit refactor regressions', () => {
  it('explicit candle-derived coverage does not claim a sparse range is fully covered', () => {
    const cache = new CandleCache({ enableIDB: false });
    const candles = [candle(1000), candle(1120)];
    cache.set('BTCUSDT', '1m', 1000, 1120, candles, {
      intervals: CandleCache.intervalsFromCandles(candles, 60),
      timeframeSec: 60,
    });

    const result = cache.get('BTCUSDT', '1m', 1000, 1120, { timeframeSec: 60 });

    expect(result.hit).toBe(false);
    expect(result.missing).toEqual([{ from: 1060, to: 1060 }]);
  });

  it('cache recognizes contiguous explicit coverage', () => {
    const cache = new CandleCache({ enableIDB: false });
    const candles = [candle(1000), candle(1060), candle(1120)];
    cache.set('BTCUSDT', '1m', 1000, 1120, candles, {
      intervals: CandleCache.intervalsFromCandles(candles, 60),
      timeframeSec: 60,
    });

    const result = cache.get('BTCUSDT', '1m', 1000, 1120, { timeframeSec: 60 });

    expect(result.hit).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('stored replay provider reads only the stored dataset API', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ source: 'BINANCE_PARQUET', candles: [candle(1000)] }) }));
    const provider = new StoredDatasetProvider({ fetchFn, baseUrl: 'http://localhost:8000' });
    const result = await provider.getCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 1060 });
    expect(result).toEqual([candle(1000)]);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn.mock.calls[0][0]).toContain('/api/v1/data/candles');
  });});
