import { describe, expect, it, vi } from 'vitest';
import { RemoteTradingEngine } from '../src/app/RemoteTradingEngine.js';

const account = {
  startingBalance: 10000,
  walletBalance: 10000,
  equity: 10000,
  realizedPnL: 0,
  unrealizedPnL: 0,
  totalFees: 0,
  availableMargin: 10000,
  usedMargin: 0,
};

function state(extra = {}) {
  return { account, positions: [], orders: [], pendingOrders: [], trades: [], funding: [], ...extra };
}

describe('RemoteTradingEngine state ordering', () => {
  it('applies every successful response in serialized completion order', async () => {
    const queue = [];
    const api = { request: vi.fn((path) => new Promise((resolve, reject) => queue.push({ path, resolve, reject }))) };
    const engine = new RemoteTradingEngine(api);

    await Promise.resolve();
    expect(queue).toHaveLength(1);
    queue.shift().resolve(state());
    await engine._refreshPromise;

    const first = engine.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1, type: 'market' });
    const second = engine.setFeeRate(0.001);

    expect(queue).toHaveLength(2);
    queue.shift().resolve(state({ orders: [{ id: 1, symbol: 'BTCUSDT', status: 'PENDING' }], pendingOrders: [{ id: 1, symbol: 'BTCUSDT', status: 'PENDING' }] }));
    queue.shift().reject(new Error('configuration rejected'));

    const firstResult = await first;
    const secondResult = await second;

    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(false);
    expect(engine.getOrders()).toHaveLength(1);
    expect(engine.getOrders()[0].id).toBe(1);
  });
});
