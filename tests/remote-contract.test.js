import { describe, expect, it, vi } from 'vitest';
import { RemoteReplayEngine } from '../src/app/RemoteReplayEngine.js';
import { RemoteTradingEngine } from '../src/app/RemoteTradingEngine.js';
import { createTradingPresentation } from '../src/app/TradingPresentationAdapter.js';

const candle = { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 };

function api(responses = {}) { return { request: vi.fn(async (path) => responses[path] ?? { status: 'paused', index: 0, startIndex: 0, total: 1, speed: 1, candle, visibleCandles: [candle] }) }; }

describe('remote contracts', () => {
  it('normalizes replay state names and lifecycle', async () => {
    const client = api({ '/load': { status: 'ready', index: -1, startIndex: -1, total: 1, speed: 1, visibleCandles: [] }, '/start/0': { status: 'paused', index: 0, startIndex: 0, total: 1, speed: 1, candle, visibleCandles: [candle] } });
    const engine = new RemoteReplayEngine(client);
    await engine.load([candle]);
    expect(engine.getState().totalCandles).toBe(1);
    expect(engine.getState().total).toBe(1);
    await engine.start(0);
    expect(engine.getState().currentIndex).toBe(0);
  });

  it('maps trading actions to canonical API payloads', async () => {
    const client = api({ '/order': { account: {}, positions: [], orders: [], trades: [] } });
    const engine = new RemoteTradingEngine(client);
    const result = await engine.submitMarketOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1 });
    expect(result.success).toBe(true);
    expect(client.request).toHaveBeenCalledWith('/order', expect.objectContaining({ method: 'POST', body: expect.stringContaining('BTCUSDT') }));
  });

  it('exposes the narrow presentation contract', () => {
    const engine = { getAccountSnapshot: () => ({ equity: 100 }), getPositions: () => [], getPendingOrders: () => [], getOrders: () => [], getTrades: () => [], getPerformanceStats: () => ({ totalTrades: 0, winRate: 0, profitFactor: 0, netReturn: 0 }), getLatestCandle: () => candle, hasOpenPosition: () => false, on: () => () => {}, submitMarketOrder: vi.fn(), placeLimitOrder: vi.fn(), placeStopOrder: vi.fn(), flattenPosition: vi.fn(), updateRisk: vi.fn(), setStopLoss: vi.fn(), setTakeProfit: vi.fn(), clearRisk: vi.fn(), cancelOrder: vi.fn(), resetAccount: vi.fn(), setStartingBalance: vi.fn(), setFeeRate: vi.fn() };
    const trading = createTradingPresentation(engine);
    expect(Object.isFrozen(trading.actions)).toBe(true);
    expect(trading.snapshot().hasMarket).toBe(true);
  });
});
