import { describe, it, expect } from 'vitest';
import { PaperTradingEngine, EXECUTION_PROFILE, EXECUTION_TIMING } from '../src/trading/PaperTradingEngine.js';
import { Strategy } from '../src/strategy/Strategy.js';
import { BacktestRunner } from '../src/strategy/BacktestRunner.js';

const c = (time, open, high = open, low = open, close = open, symbol = 'BTCUSDT') => ({
  time, open, high, low, close, volume: 1, symbol,
});

class BuyOnFirstBar extends Strategy {
  evaluate(bar) {
    if (bar.index === 0) return [this.createIntent({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1 })];
    return [];
  }
}

describe('execution semantics hardening', () => {
  it('uses explicit manual replay profile for immediate-close UI execution', () => {
    const engine = new PaperTradingEngine({ executionProfile: EXECUTION_PROFILE.MANUAL_REPLAY });
    expect(engine.executionProfile).toBe(EXECUTION_PROFILE.MANUAL_REPLAY);
    expect(engine.executionTiming).toBe(EXECUTION_TIMING.IMMEDIATE_CLOSE);
  });

  it('uses explicit research profile for next-bar-open execution', () => {
    const engine = new PaperTradingEngine({ executionProfile: EXECUTION_PROFILE.RESEARCH_BACKTEST });
    expect(engine.executionProfile).toBe(EXECUTION_PROFILE.RESEARCH_BACKTEST);
    expect(engine.executionTiming).toBe(EXECUTION_TIMING.NEXT_BAR_OPEN);
  });

  it('rejects regressing market candles', () => {
    const engine = new PaperTradingEngine({ executionProfile: EXECUTION_PROFILE.RESEARCH_BACKTEST });
    engine.onMarketCandle({ candle: c(1000, 100), index: 0, symbol: 'BTCUSDT' });
    expect(() => engine.onMarketCandle({ candle: c(900, 99), index: 1, symbol: 'BTCUSDT' }))
      .toThrow(/MARKET_CANDLE_OUT_OF_ORDER/);
    expect(engine.getLatestCandleIndex()).toBe(0);
    expect(engine.getAccountSnapshot().totalBars).toBe(1);
  });

  it('rejects conflicting timestamp for the same candle index', () => {
    const engine = new PaperTradingEngine();
    engine.onMarketCandle({ candle: c(1000, 100), index: 0, symbol: 'BTCUSDT' });
    expect(() => engine.onMarketCandle({ candle: c(1001, 101), index: 0, symbol: 'BTCUSDT' }))
      .toThrow(/MARKET_CANDLE_IDENTITY_CONFLICT/);
  });

  it('tracks funding received separately and derives net funding', () => {
    const engine = new PaperTradingEngine({ feeRate: 0, executionProfile: EXECUTION_PROFILE.MANUAL_REPLAY });
    engine.onMarketCandle({ candle: c(1000, 100), index: 0, symbol: 'BTCUSDT' });
    engine.placeOrder({ symbol: 'BTCUSDT', side: 'SELL', quantity: 10 });
    engine.applyFundingRate({ symbol: 'BTCUSDT', fundingRate: 0.01, timestamp: 1000, markPrice: 100 });
    const snapshot = engine.getAccountSnapshot();
    expect(snapshot.totalFundingReceived).toBe(10);
    expect(snapshot.totalFundingPaid).toBe(0);
    expect(snapshot.netFunding).toBe(10);
  });

  it('starts each backtest run from a clean research session', () => {
    const strategy = new BuyOnFirstBar();
    const runner = new BacktestRunner({ strategy, startingBalance: 10000, feeRate: 0 });
    const first = runner.run([c(100, 100), c(200, 110)]);
    expect(first.account.executionProfile).toBe(EXECUTION_PROFILE.RESEARCH_BACKTEST);
    expect(first.trades).toHaveLength(0);

    const second = runner.run([c(1000, 200), c(1100, 220)]);
    expect(second.account.totalBars).toBe(2);
    expect(second.account.cashBalance).toBe(10000);
    expect(second.trades).toHaveLength(0);
    expect(second.unfilledOrders).toHaveLength(1);
    expect(second.unfilledOrders[0].createdIndex).toBe(0);
  });
});
