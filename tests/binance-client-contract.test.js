import { describe, it, expect } from 'vitest';
import { BinanceClient } from '../src/data/BinanceClient.js';

describe('BinanceClient provider contract', () => {
  const candlePayload = [
    [1700000000000, '100', '105', '95', '102', '10'],
    [1700000060000, '102', '108', '101', '106', '15'],
  ];

  it('maps Binance kline arrays to canonical candles', async () => {
    const client = new BinanceClient({
      fetchFn: async () => ({
        ok: true,
        json: async () => candlePayload,
      }),
    });

    const candles = await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1700000000, end: 1700000060 });
    expect(candles).toEqual([
      { time: 1700000000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { time: 1700000060, open: 102, high: 108, low: 101, close: 106, volume: 15 },
    ]);
  });

  it('rejects malformed object candle payloads at the provider boundary', async () => {
    const client = new BinanceClient({
      fetchFn: async () => ({
        ok: true,
        json: async () => ([
          { time: 1700000000, open: 100, high: 90, low: 95, close: 102, volume: 10 },
        ]),
      }),
    });

    await expect(client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1700000000, end: 1700000000 }))
      .rejects.toThrow(/invalid candle/i);
  });

  it('rejects object payloads with non-finite OHLCV values', async () => {
    const client = new BinanceClient({
      fetchFn: async () => ({
        ok: true,
        json: async () => ([
          { time: 1700000000, open: 100, high: 105, low: 95, close: NaN, volume: 10 },
        ]),
      }),
    });

    await expect(client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1700000000, end: 1700000000 }))
      .rejects.toThrow(/invalid candle/i);
  });
});
