import { describe, it, expect } from 'vitest';
import { PaperTradingEngine, EXECUTION_TIMING, AMBIGUITY_POLICY } from '../src/trading/PaperTradingEngine.js';

function makeCandle(time, open, high, low, close, volume = 10) {
  return { time, open, high, low, close, volume };
}

describe('Phase 4 — Ambiguity Accounting & Metrics Tracking', () => {
  it('persists CONSERVATIVE ambiguity resolution on Trade when both SL and TP touch', () => {
    const engine = new PaperTradingEngine({
      startingBalance: 10000,
      feeRate: 0,
      ambiguityPolicy: AMBIGUITY_POLICY.CONSERVATIVE,
      executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
    });

    // Bar 0: Buy 1 BTC at 100, set SL=90, TP=110
    engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 100), index: 0 });
    engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    engine.setStopLoss('BTCUSD', 90);
    engine.setTakeProfit('BTCUSD', 110);

    // Bar 1: Huge range [85, 115] touches BOTH SL (90) and TP (110)
    engine.onMarketCandle({ candle: makeCandle(1060, 100, 115, 85, 102), index: 1 });

    const trades = engine.getTrades();
    expect(trades.length).toBe(1);
    expect(trades[0].exitReason).toBe('STOP_LOSS');
    // Invariant 8: Dual-touch resolution recorded on resulting Trade
    expect(trades[0].ambiguityResolution).toBe('CONSERVATIVE');

    const summary = engine.getBacktestSummary();
    expect(summary.ambiguousBars).toBe(1);
    expect(summary.totalBars).toBe(2);
    expect(summary.ambiguousBarRate).toBe(0.5); // 1 out of 2
  });

  it('persists TP_FIRST ambiguity resolution on Trade when configured', () => {
    const engine = new PaperTradingEngine({
      startingBalance: 10000,
      feeRate: 0,
      ambiguityPolicy: AMBIGUITY_POLICY.TP_FIRST,
      executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
    });

    engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 100), index: 0 });
    engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    engine.setStopLoss('BTCUSD', 90);
    engine.setTakeProfit('BTCUSD', 110);

    // Touches both SL and TP
    engine.onMarketCandle({ candle: makeCandle(1060, 100, 115, 85, 102), index: 1 });

    const trades = engine.getTrades();
    expect(trades.length).toBe(1);
    expect(trades[0].exitReason).toBe('TAKE_PROFIT');
    expect(trades[0].ambiguityResolution).toBe('TP_FIRST');
  });

  it('records ambiguityResolution = NONE when only one boundary touches', () => {
    const engine = new PaperTradingEngine({
      startingBalance: 10000,
      feeRate: 0,
      ambiguityPolicy: AMBIGUITY_POLICY.CONSERVATIVE,
      executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
    });

    engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 100), index: 0 });
    engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    engine.setStopLoss('BTCUSD', 90);
    engine.setTakeProfit('BTCUSD', 110);

    // Drops to 85, only touching SL
    engine.onMarketCandle({ candle: makeCandle(1060, 100, 105, 85, 92), index: 1 });

    const trades = engine.getTrades();
    expect(trades.length).toBe(1);
    expect(trades[0].exitReason).toBe('STOP_LOSS');
    expect(trades[0].ambiguityResolution).toBe('NONE');

    const summary = engine.getBacktestSummary();
    expect(summary.ambiguousBars).toBe(0);
    expect(summary.ambiguousBarRate).toBe(0);
  });
});
