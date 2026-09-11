import { describe, expect, it, vi } from 'vitest';
import { RemoteTradingEngine } from '../src/app/RemoteTradingEngine.js';
import { RemoteReplayEngine } from '../src/app/RemoteReplayEngine.js';

const candle = { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 };

function resolvedApi(responses = {}) {
  return { request: vi.fn(async (path) => responses[path] ?? { status: 'paused', index: 0, startIndex: 0, total: 1, speed: 1, candle, visibleCandles: [candle] }) };
}

describe('deep error handling contracts', () => {
  it('does not treat initial trading refresh failure as a valid empty account', async () => {
    const failure = new Error('backend unavailable');
    const client = { request: vi.fn(async () => { throw failure; }) };
    const engine = new RemoteTradingEngine(client);
    const hydration = await engine._refreshPromise;
    expect(hydration.success).toBe(false);
    expect(engine.getHydrationStatus().hydrated).toBe(false);
    const result = await engine.submitMarketOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1 });
    expect(result.success).toBe(false);
    expect(result.message).toContain('backend unavailable');
  });

  it('does not report stale trading responses as successful operations', async () => {
    let resolveOld;
    let resolveNew;
    const old = new Promise((resolve) => { resolveOld = resolve; });
    const newer = new Promise((resolve) => { resolveNew = resolve; });
    let count = 0;
    const client = { request: vi.fn((path) => path === '/state' ? { account: {}, positions: [], orders: [], trades: [] } : (++count === 1 ? old : newer)) };
    const engine = new RemoteTradingEngine(client);
    await engine._refreshPromise;
    const first = engine.setStartingBalance(9000);
    const second = engine.setStartingBalance(12000);
    resolveNew({ account: { startingBalance: 12000, equity: 12000 }, positions: [], orders: [], trades: [] });
    await second;
    resolveOld({ account: { startingBalance: 9000, equity: 9000 }, positions: [], orders: [], trades: [] });
    const stale = await first;
    expect(stale.success).toBe(false);
    expect(stale.stale).toBe(true);
  });

  it('records sync and async presentation listener failures without breaking the engine', async () => {
    const client = resolvedApi({ '/state': { account: { equity: 100 }, positions: [], orders: [], trades: [] } });
    const errors = [];
    client.onClientError = (error, context) => errors.push({ error, context });
    const engine = new RemoteTradingEngine(client);
    await engine._refreshPromise;
    engine.on('accountUpdated', () => { throw new Error('sync listener failed'); });
    engine.on('accountUpdated', async () => { throw new Error('async listener failed'); });
    await engine.refresh();
    await Promise.resolve();
    expect(engine.getLastListenerErrors().length).toBeGreaterThanOrEqual(2);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects unknown chart-independent replay mutations instead of pretending success', async () => {
    const engine = new RemoteReplayEngine(resolvedApi({ '/load': { status: 'ready', index: -1, startIndex: -1, total: 1, speed: 1, visibleCandles: [] } }));
    await engine.load([candle]);
    expect(() => engine.setSpeed(0)).toThrow(/positive number/);
  });
});
