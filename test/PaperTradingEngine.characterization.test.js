import { describe, expect, it } from 'vitest';
import { PaperTradingEngine, EXECUTION_PROFILE } from '../src/trading/PaperTradingEngine.js';
import { AMBIGUITY_POLICY } from '../src/trading/AmbiguityResolver.js';

const market = (time, open, high, low, close, index) => ({
  candle: { time, open, high, low, close },
  symbol: 'BTCUSDT',
  index,
});

describe('PaperTradingEngine characterization', () => {
  it('executes research market orders on the next candle open', () => {
    const engine = new PaperTradingEngine({ startingBalance: 10000, executionProfile: EXECUTION_PROFILE.RESEARCH_BACKTEST });
    engine.onMarketCandle(market(1000, 100, 105, 95, 101, 0));
    expect(engine.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1 }).success).toBe(true);
    engine.onMarketCandle(market(2000, 110, 115, 108, 112, 1));
    expect(engine.getPosition('BTCUSDT').entryPrice).toBe(110);
  });

  it('keeps current-bar-close execution separate from next-bar-open execution', () => {
    const engine = new PaperTradingEngine({ startingBalance: 10000 });
    engine.onMarketCandle(market(1000, 100, 105, 95, 101, 0));
    const result = engine.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1 });
    expect(result.success).toBe(true);
    expect(result.position.entryPrice).toBe(101);
    expect(engine.getPendingOrders()).toHaveLength(0);
  });

  it('applies funding exactly at a crossed funding boundary when the position predates it', () => {
    const engine = new PaperTradingEngine({
      startingBalance: 10000,
      fundingSchedule: { intervalSec: 1000, origin: 0, defaultRate: 0.01 },
    });
    engine.onMarketCandle(market(9000, 100, 101, 99, 100, 0));
    expect(engine.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1 }).success).toBe(true);
    const before = engine.account.walletBalance;
    engine.onMarketCandle(market(11000, 100, 101, 99, 100, 1));
    expect(engine.getFundingHistory()).toHaveLength(1);
    expect(engine.getFundingHistory()[0].timestamp).toBe(10000);
    expect(engine.account.walletBalance).toBeLessThan(before);
  });

  it('uses the configured ambiguity policy when one OHLC bar crosses both SL and TP', () => {
    const conservative = new PaperTradingEngine({ ambiguityPolicy: AMBIGUITY_POLICY.CONSERVATIVE });
    conservative.onMarketCandle(market(1000, 100, 101, 99, 100, 0));
    conservative.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1 });
    conservative.setRisk({ symbol: 'BTCUSDT', stopLoss: 95, takeProfit: 105 });
    conservative.onMarketCandle(market(2000, 100, 110, 90, 100, 1));
    expect(conservative.hasOpenPosition()).toBe(false);
    expect(conservative.getTrades()[0].exitReason).toBe('STOP_LOSS');

    const tpFirst = new PaperTradingEngine({ ambiguityPolicy: AMBIGUITY_POLICY.TP_FIRST });
    tpFirst.onMarketCandle(market(1000, 100, 101, 99, 100, 0));
    tpFirst.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1 });
    tpFirst.setRisk({ symbol: 'BTCUSDT', stopLoss: 95, takeProfit: 105 });
    tpFirst.onMarketCandle(market(2000, 100, 110, 90, 100, 1));
    expect(tpFirst.hasOpenPosition()).toBe(false);
    expect(tpFirst.getTrades()[0].exitReason).toBe('TAKE_PROFIT');
  });

  it('accounts for both entry and exit fees on a completed trade', () => {
    const engine = new PaperTradingEngine({ startingBalance: 10000, feeRate: 0.001 });
    engine.onMarketCandle(market(1000, 100, 101, 99, 100, 0));
    engine.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1 });
    engine.onMarketCandle(market(2000, 110, 111, 109, 110, 1));
    const close = engine.closePositionImmediate('BTCUSDT');
    expect(close.success).toBe(true);
    expect(close.grossPnL).toBe(10);
    expect(close.entryFee).toBe(0.1);
    expect(close.exitFee).toBe(0.11);
    expect(close.realizedPnL).toBeCloseTo(9.79, 10);
  });

  it('rejects an invalid market timestamp before mutating the latest market state', () => {
    const engine = new PaperTradingEngine({ startingBalance: 10000 });
    engine.onMarketCandle(market(1000, 100, 105, 95, 101, 0));
    const previous = engine.getLatestCandle();
    expect(() => engine.onMarketCandle(market(Number.NaN, 100, 105, 95, 101, 1))).toThrow('MARKET_CANDLE_INVALID_TIMESTAMP');
    expect(engine.getLatestCandle()).toEqual(previous);
    expect(engine.getLatestCandleIndex()).toBe(0);
  });

  it('ignores duplicate candle identity without double-processing', () => {
    const engine = new PaperTradingEngine({ executionProfile: EXECUTION_PROFILE.RESEARCH_BACKTEST });
    engine.onMarketCandle(market(1000, 100, 101, 99, 100, 0));
    engine.onMarketCandle(market(1000, 100, 101, 99, 100, 0));
    expect(engine.getBacktestSummary().totalBars).toBe(1);
  });
});
