import { describe, expect, it } from 'vitest';
import { BinanceClient } from '../src/data/BinanceClient.js';

describe('BinanceClient response validation', () => {
  it('throws INVALID_RESPONSE when Binance returns a non-array payload', async () => {
    const client = new BinanceClient({
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ code: -1000, msg: 'unknown error' }),
      }),
    });

    await expect(client.fetchCandles({
      symbol: 'BTCUSDT',
      resolution: '1m',
      start: 0,
      end: 60,
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
