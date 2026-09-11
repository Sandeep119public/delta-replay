import { describe, it, expect } from 'vitest';
import { DeltaCandleProvider } from '../src/data/DeltaCandleProvider.js';

describe('DeltaCandleProvider input contract', () => {
  it('rejects invalid limits before requesting data', async () => {
    let calls = 0;
    const provider = new DeltaCandleProvider({
      maxCandles: 10,
      client: {
        fetchCandles: async () => {
          calls += 1;
          return [{ time: 1000, open: 100, high: 101, low: 99, close: 100, volume: 1 }];
        },
      },
    });

    await expect(provider.getCandles({
      symbol: 'BTCUSD',
      timeframe: '1m',
      from: 1000,
      to: 1060,
      limit: 0,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    await expect(provider.getCandles({
      symbol: 'BTCUSD',
      timeframe: '1m',
      from: 1000,
      to: 1060,
      limit: 11,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    expect(calls).toBe(0);
  });

  it('rejects invalid cache size at construction', () => {
    expect(() => new DeltaCandleProvider({ cacheSize: -1 })).toThrow(/cacheSize/i);
    expect(() => new DeltaCandleProvider({ cacheSize: 1.5 })).toThrow(/cacheSize/i);
  });
});
