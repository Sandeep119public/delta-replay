import { describe, expect, it, vi } from 'vitest';
import { RemoteTradingEngine } from '../src/app/RemoteTradingEngine.js';

const candle = { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 };

describe('remote trading event deduplication', () => {
  it('does not emit ORDER_FILLED twice when state transition and backend event describe the same fill', async () => {
    const client = { request: vi.fn(async (path) => path === '/state'
      ? { account: { equity: 10000 }, positions: [], orders: [], trades: [] }
      : { account: { equity: 10000 }, positions: [], orders: [{ id: 7, status: 'FILLED', symbol: 'BTCUSDT' }], trades: [], candle, events: [{ type: 'ORDER_FILLED', order: 7 }] }) };
    const engine = new RemoteTradingEngine(client);
    await engine._refreshPromise;
    const filled = vi.fn();
    const triggered = vi.fn();
    engine.on('orderFilled', filled);
    engine.on('orderTriggered', triggered);

    await engine.onMarketCandle({ symbol: 'BTCUSDT', candle, index: 1 });

    expect(filled).toHaveBeenCalledTimes(1);
    expect(triggered).toHaveBeenCalledTimes(1);
  });
});
