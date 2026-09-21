import { describe, expect, it, vi } from 'vitest';
import { BinanceLiveMarketService } from '../../src/app/BinanceLiveMarketService.js';

function candle(time = 1000) {
  return { time, open: 100, high: 101, low: 99, close: 100.5, volume: 10 };
}

describe('BinanceLiveMarketService', () => {
  it('bootstraps the live chart from Binance REST without entering replay', async () => {
    const chartManager = { setRevealedMax: vi.fn(), setData: vi.fn(), update: vi.fn() };
    const client = { fetchCandles: vi.fn(async () => Array.from({ length: 3 }, (_, i) => candle(1000 + i * 60))) };
    const socket = { close: vi.fn() };
    const service = new BinanceLiveMarketService({
      client,
      chartManager,
      wsFactory: vi.fn(() => socket),
    });

    await service.start({ symbol: 'BTCUSDT', timeframe: '1m' });

    expect(client.fetchCandles).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'BTCUSDT',
      resolution: '1m',
      signal: expect.any(AbortSignal),
    }));
    expect(chartManager.setData).toHaveBeenCalledWith(expect.any(Array), { fit: true });
  });

  it('updates only the live chart when a Binance kline message arrives', async () => {
    const chartManager = { setRevealedMax: vi.fn(), setData: vi.fn(), update: vi.fn() };
    const socket = { close: vi.fn() };
    const wsFactory = vi.fn(() => socket);
    const service = new BinanceLiveMarketService({
      client: { fetchCandles: vi.fn(async () => [candle()]) },
      chartManager,
      wsFactory,
    });

    await service.start({ symbol: 'ETHUSDT', timeframe: '5m' });
    socket.onmessage?.({ data: JSON.stringify({
      stream: 'ethusdt@kline_5m',
      data: {
        k: { t: 1060_000, o: '100', h: '103', l: '99', c: '102', v: '25' },
      },
    }) });

    expect(chartManager.update).toHaveBeenCalledWith({
      time: 1060,
      open: 100,
      high: 103,
      low: 99,
      close: 102,
      volume: 25,
    });
  });

  it('stops the WebSocket and aborts the bootstrap request', async () => {
    const chartManager = { setRevealedMax: vi.fn(), setData: vi.fn(), update: vi.fn() };
    const socket = { close: vi.fn() };
    const client = { fetchCandles: vi.fn(() => new Promise(() => {})) };
    const service = new BinanceLiveMarketService({ client, chartManager, wsFactory: () => socket });

    const pending = service.start({ symbol: 'BTCUSDT', timeframe: '1m' });
    service.stop();

    expect(socket.close).toHaveBeenCalledTimes(0);
    await Promise.resolve(pending);
  });
});
