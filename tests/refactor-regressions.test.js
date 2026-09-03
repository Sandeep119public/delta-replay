import { describe, expect, it, vi } from 'vitest';
import { BinanceCandleProvider } from '../src/data/BinanceCandleProvider.js';
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
    expect(result.missing).toEqual([{ from: 1001, to: 1119 }]);
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

  it('Binance provider legacy getCandles returns the same array contract as fetchChunk', async () => {
    const fetchCandles = vi.fn(async () => [candle(1000)]);
    const provider = new BinanceCandleProvider({ client: { fetchCandles } });

    const result = await provider.getCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 1060 });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(fetchCandles).toHaveBeenCalledTimes(1);
  });
});
