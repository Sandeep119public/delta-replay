import { describe, expect, it } from 'vitest';
import { PaperTradingEngine } from '../src/trading/PaperTradingEngine.js';

const candle = (time, price = 100) => ({
  time,
  open: price,
  high: price,
  low: price,
  close: price,
  volume: 1,
  symbol: 'BTCUSD',
});

describe('PaperTradingEngine starting balance reset', () => {
  it('clears stale margin state when starting balance changes', () => {
    const engine = new PaperTradingEngine({
      startingBalance: 10000,
      marginRate: 0.1,
      maintMarginRate: 0.05,
      feeRate: 0,
    });

    engine.onMarketCandle({ candle: candle(1000), index: 0, symbol: 'BTCUSD' });
    const opened = engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 10 });
    expect(opened.success).toBe(true);
    expect(engine.getAccountSnapshot().usedMargin).toBe(100);
    expect(engine.getAccountSnapshot().maintenanceMargin).toBe(50);

    const result = engine.setStartingBalance(20000);

    expect(result.success).toBe(true);
    expect(result.balance).toBe(20000);
    expect(engine.getPositions()).toEqual([]);
    expect(engine.getAccountSnapshot().usedMargin).toBe(0);
    expect(engine.getAccountSnapshot().initialMargin).toBe(0);
    expect(engine.getAccountSnapshot().maintenanceMargin).toBe(0);
    expect(engine.getAccountSnapshot().availableMargin).toBe(20000);
    expect(engine.getAccountSnapshot().equity).toBe(20000);
  });
});
