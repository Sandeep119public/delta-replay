import { describe, it, expect } from 'vitest';
import { HistoricalDataManager } from '../src/data/HistoricalDataManager.js';

const makeManager = (provider) => new HistoricalDataManager({
  provider,
  concurrency: 1,
  maxRetries: 0,
  chunkSize: 2,
});

describe('HistoricalDataManager provider contracts', () => {
  it('fails when a provider returns a non-array chunk', async () => {
    const manager = makeManager({
      getGridSpec: () => ({ origin: 0 }),
      fetchChunk: async () => ({ candles: [] }),
    });

    await expect(manager.load({
      symbol: 'BTCUSDT',
      timeframe: '1m',
      from: 60,
      to: 180,
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
