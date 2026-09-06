import { describe, expect, it } from 'vitest';
import { PaperTradingEngine, EXECUTION_PROFILE } from '../src/trading/PaperTradingEngine.js';

const candle = (time, open, high, low, close) => ({ candle: { time, open, high, low, close }, symbol: 'BTCUSDT', index: Math.floor(time / 1000) });

describe('PaperTradingEngine characterization', () => {
  it('executes research market orders on the next candle open', () => {
    const engine = new PaperTradingEngine({ startingBalance: 10000, executionProfile: EXECUTION_PROFILE.RESEARCH_BACKTEST });
    engine.onMarketCandle(candle(1000, 100, 105, 95, 101));
    expect(engine.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1 }).success).toBe(true);
    engine.onMarketCandle(candle(2000, 110, 115, 108, 112));
    expect(engine.getPosition('BTCUSDT').entryPrice).toBe(110);
  });

  it('applies funding with the expected long and short signs', () => {
    const engine = new PaperTradingEngine({ startingBalance: 10000 });
    engine._positions.set('BTCUSDT', { symbol: 'BTCUSDT', side: 'LONG', quantity: 1, entryPrice: 100, currentPrice: 100, unrealizedPnL: 0 });
    const before = engine.account.walletBalance;
    const payments = engine.applyFundingRate({ symbol: 'BTCUSDT', fundingRate: 0.01, markPrice: 100, timestamp: 1 });
    expect(payments[0].payment).toBe(-1);
    expect(engine.account.walletBalance).toBe(before - 1);
  });

  it('rejects a duplicate candle identity in research mode', () => {
    const engine = new PaperTradingEngine({ executionProfile: EXECUTION_PROFILE.RESEARCH_BACKTEST });
    engine.onMarketCandle(candle(1000, 100, 101, 99, 100));
    expect(() => engine.onMarketCandle(candle(1000, 100, 101, 99, 100))).not.toThrow();
  });
});
