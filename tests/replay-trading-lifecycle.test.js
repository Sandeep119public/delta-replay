import { describe, it, expect } from 'vitest';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { PaperTradingEngine, EXECUTION_TIMING } from '../src/trading/PaperTradingEngine.js';

const candle = (time, open, high = open, low = open, close = open, symbol = 'BTCUSDT') => ({
  time, open, high, low, close, volume: 1, symbol,
});

describe('replay/trading lifecycle hardening', () => {
  it('auto-feeds replay candles exactly once even when UI seeds the start candle', () => {
    const replay = new ReplayEngine();
    const trading = new PaperTradingEngine({ replayEngine: replay });
    const candles = [candle(100, 100), candle(200, 101), candle(300, 102)];
    replay.load(candles);
    trading.onMarketCandle({ candle: candles[1], index: 1, symbol: 'BTCUSDT', timestamp: 200 });
    expect(trading.getLatestCandleIndex()).toBe(1);
    expect(trading.getAccountSnapshot().totalBars).toBe(1);
    replay.start(1);
    expect(trading.getLatestCandleIndex()).toBe(1);
    expect(trading.getAccountSnapshot().totalBars).toBe(1);
  });

  it('resets the account when a new replay is loaded', () => {
    const replay = new ReplayEngine();
    const trading = new PaperTradingEngine({ replayEngine: replay, executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE });
    const firstRun = [candle(100, 100), candle(200, 110), candle(300, 120)];
    replay.load(firstRun);
    replay.start(0);
    expect(trading.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1 }).success).toBe(true);
    replay.stepForward();
    expect(trading.getTrades()).toHaveLength(0);
    trading.closePositionImmediate('BTCUSDT');
    expect(trading.getTrades()).toHaveLength(1);
    replay.load([candle(1000, 200), candle(1100, 201)]);
    expect(trading.getTrades()).toHaveLength(0);
    expect(trading.getPositions()).toHaveLength(0);
    expect(trading.getPendingOrders()).toHaveLength(0);
    expect(trading.getAccountSnapshot().cashBalance).toBeCloseTo(10000, 10);
    expect(trading.getAccountSnapshot().totalBars).toBe(0);
  });

  it('resets the account when replay is reset after a completed position', () => {
    const replay = new ReplayEngine();
    const trading = new PaperTradingEngine({ replayEngine: replay, executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE });
    const candles = [candle(100, 100), candle(200, 110)];
    replay.load(candles);
    replay.start(0);
    expect(trading.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1 }).success).toBe(true);
    trading.closePositionImmediate('BTCUSDT');
    expect(trading.getTrades()).toHaveLength(1);
    replay.reset();
    expect(trading.getTrades()).toHaveLength(0);
    expect(trading.getPositions()).toHaveLength(0);
    expect(trading.getAccountSnapshot().cashBalance).toBeCloseTo(10000, 10);
    // Replay reset returns to the start candle, so the trading feed receives that candle again.
    expect(trading.getLatestCandleIndex()).toBe(0);
    expect(trading.getLatestCandle().time).toBe(100);
  });
});

// Preserve this coverage as a regression guard for replay session boundaries.
