import { describe, expect, it, vi } from 'vitest';
import { StoredDatasetProvider } from '../../src/data/StoredDatasetProvider.js';

describe('StoredDatasetProvider', () => {
  it('reads candles from the stored dataset API', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        source: 'BINANCE_PARQUET',
        candles: [{ time: 1000, open: 10, high: 11, low: 9, close: 10, volume: 4 }],
      }),
    });
    const provider = new StoredDatasetProvider({ fetchFn, baseUrl: 'http://localhost:8000' });

    const candles = await provider.getCandles({
      symbol: 'SOLUSDT',
      timeframe: '1m',
      from: 1000,
      to: 1060,
    });

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn.mock.calls[0][0]).toContain('/api/v1/data/candles');
    expect(fetchFn.mock.calls[0][0]).toContain('symbol=SOLUSDT');
    expect(fetchFn.mock.calls[0][0]).toContain('timeframe=1m');
    expect(candles[0]).toEqual({
      time: 1000, open: 10, high: 11, low: 9, close: 10, volume: 4,
    });
  });

  it('does not fall back to a remote exchange provider when data is missing', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'No stored dataset' }),
    });
    const provider = new StoredDatasetProvider({ fetchFn });
    await expect(provider.getCandles({
      symbol: 'SOLUSDT', timeframe: '15m', from: 1000, to: 2000,
    })).rejects.toMatchObject({ code: 'STORED_DATA_ERROR', status: 404 });
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
