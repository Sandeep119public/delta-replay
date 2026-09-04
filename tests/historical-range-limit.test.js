import { describe, expect, it } from 'vitest';
import { HistoricalDataManager } from '../src/data/HistoricalDataManager.js';

const candle = (time) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 });

const provider = {
  venue: 'TEST',
  getGridSpec: () => ({ origin: 0 }),
  fetchChunk: async ({ from, to }) => [candle(from), ...(to === from ? [] : [candle(to)])],
};

describe('HistoricalDataManager range limit', () => {
  it('allows exactly 100000 inclusive candles', async () => {
    const manager = new HistoricalDataManager({ provider, chunkSize: 100000 });
    await expect(manager.load({
      symbol: 'BTCUSDT',
      timeframe: '1m',
      from: 0,
      to: 99_999 * 60,
    })).resolves.toBeDefined();
  });

  it('rejects 100001 inclusive candles before network access', async () => {
    let calls = 0;
    const guardedProvider = {
      ...provider,
      fetchChunk: async () => {
        calls++;
        return [];
      },
    };
    const manager = new HistoricalDataManager({ provider: guardedProvider });

    await expect(manager.load({
      symbol: 'BTCUSDT',
      timeframe: '1m',
      from: 0,
      to: 100_000 * 60,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(calls).toBe(0);
  });
});
