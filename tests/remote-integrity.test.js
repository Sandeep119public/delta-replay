import { describe, expect, it, vi } from 'vitest';
import { RemoteReplayEngine } from '../src/app/RemoteReplayEngine.js';
import { RemoteTradingEngine } from '../src/app/RemoteTradingEngine.js';

const candle = { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 };

describe('remote state integrity', () => {
  it('returns defensive replay snapshots', async () => {
    const api = { request: vi.fn(async () => ({ status: 'paused', index: 0, startIndex: 0, total: 1, speed: 1, candle, visibleCandles: [candle] })) };
    const engine = new RemoteReplayEngine(api);
    await engine.start(0);
    const state = engine.getState();
    state.candle.close = 999;
    state.visibleCandles[0].open = 999;
    expect(engine.getState().candle.close).toBe(100);
    expect(engine.getState().visibleCandles[0].open).toBe(100);
  });

  it('does not expose mutable trading state', async () => {
    const api = { request: vi.fn(async () => ({ account: { startingBalance: 10000, equity: 10000 }, positions: [{ symbol: 'BTCUSDT', quantity: 1 }], orders: [{ id: 1, status: 'PENDING' }], pendingOrders: [{ id: 1, status: 'PENDING' }], trades: [{ id: 1, netPnL: 2 }], candle })) };
    const engine = new RemoteTradingEngine(api);
    await engine.refresh();
    const account = engine.getAccountSnapshot();
    const positions = engine.getPositions();
    const orders = engine.getOrders();
    const trades = engine.getTrades();
    account.equity = -1;
    positions[0].quantity = 99;
    orders[0].status = 'FILLED';
    trades[0].netPnL = -99;
    expect(engine.getAccountSnapshot().equity).toBe(10000);
    expect(engine.getPositions()[0].quantity).toBe(1);
    expect(engine.getOrders()[0].status).toBe('PENDING');
    expect(engine.getTrades()[0].netPnL).toBe(2);
  });

  it('does not let a stale candle response replace the latest candle', async () => {
    let resolveOld;
    let resolveNew;
    const old = new Promise((resolve) => { resolveOld = resolve; });
    const newer = new Promise((resolve) => { resolveNew = resolve; });
    let calls = 0;
    const api = { request: vi.fn((path) => { calls += 1; return path === '/state' ? { account: {}, positions: [], orders: [], trades: [] } : calls === 2 ? old : newer; }) };
    const engine = new RemoteTradingEngine(api);
    await engine._refreshPromise;
    const first = engine.onMarketCandle({ symbol: 'BTCUSDT', candle: { ...candle, time: 2 }, index: 2 });
    const second = engine.onMarketCandle({ symbol: 'BTCUSDT', candle: { ...candle, time: 3 }, index: 3 });
    resolveNew({ account: {}, positions: [], orders: [], trades: [], candle: { ...candle, time: 3 } });
    await second;
    resolveOld({ account: {}, positions: [], orders: [], trades: [], candle: { ...candle, time: 2 } });
    await first;
    expect(engine.getLatestCandle().time).toBe(3);
  });
});
