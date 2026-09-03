import { describe, it, expect } from 'vitest';
import { PaperTradingEngine, EXECUTION_TIMING } from '../src/trading/PaperTradingEngine.js';
import { TradingEvents } from '../src/trading/TradingEvents.js';

function makeCandle(time, open, high, low, close, volume = 10) {
  return { time, open, high, low, close, volume };
}

describe('Phase 3 — Independent Funding Rate Mechanism', () => {
  describe('1. Invariant 7: Funding never alters trade realizedPnL', () => {
    it('applies funding to walletBalance without mutating trade realizedPnL', () => {
      const engine = new PaperTradingEngine({
        startingBalance: 10000,
        feeRate: 0,
        executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
      });

      // Bar 0 at time 1000: buy 10 BTC at 100
      engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 100), index: 0 });
      engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 10 });

      // Apply funding rate of 0.01 (1%) at mark price 100
      // Notional = 100 * 10 = 1000. Long pays 1% = -10 USD
      const events = [];
      engine.on(TradingEvents.FUNDING_PAYMENT, (e) => events.push(e));

      const payments = engine.applyFundingRate({ symbol: 'BTCUSD', fundingRate: 0.01, timestamp: 1000 });
      expect(payments.length).toBe(1);
      expect(payments[0].payment).toBe(-10);
      expect(events.length).toBe(1);
      expect(events[0].payment).toBe(-10);

      // Account walletBalance decreased by 10
      expect(engine.getAccountSnapshot().walletBalance).toBe(9990);
      expect(engine.getAccountSnapshot().totalFundingPaid).toBe(10);

      // Bar 1 at time 2000: price moves to 110
      engine.onMarketCandle({ candle: makeCandle(2000, 105, 115, 104, 110), index: 1 });

      // Close position at 110
      engine.closePosition('BTCUSD');

      // INVARIANT 7 ASSERTION:
      // Trade realizedPnL must be purely grossPnL - fees: (110 - 100) * 10 = 100
      const trades = engine.getTrades();
      expect(trades.length).toBe(1);
      expect(trades[0].realizedPnL).toBe(100);
      expect(trades[0].grossPnL).toBe(100);

      // Wallet balance must be: starting (10000) - funding (10) + realizedPnL (100) = 10090
      expect(engine.getAccountSnapshot().walletBalance).toBe(10090);
      expect(engine.getAccountSnapshot().realizedPnL).toBe(100);
    });

    it('shorts receive positive funding when funding rate is positive', () => {
      const engine = new PaperTradingEngine({
        startingBalance: 10000,
        feeRate: 0,
        executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
      });

      engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 100), index: 0 });
      // Short 10 units
      engine.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 10 });

      // Funding rate 0.01: Short receives +10
      const payments = engine.applyFundingRate({ symbol: 'BTCUSD', fundingRate: 0.01, timestamp: 1000 });
      expect(payments[0].payment).toBe(10);
      expect(engine.getAccountSnapshot().walletBalance).toBe(10010);
      expect(engine.getAccountSnapshot().totalFundingPaid).toBe(0);
    });
  });

  describe('2. Scheduled Automatic Funding Evaluation', () => {
    it('automatically applies funding when candle timestamp crosses funding interval', () => {
      const engine = new PaperTradingEngine({
        startingBalance: 10000,
        feeRate: 0,
        fundingSchedule: {
          intervalSec: 28800, // 8 hours
          defaultRate: 0.001, // 0.1%
        },
        executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
      });

      // Bar at time 0: Open LONG 10 units at 100
      engine.onMarketCandle({ candle: makeCandle(0, 100, 105, 95, 100), index: 0 });
      engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 10 });

      const fundingEvents = [];
      engine.on(TradingEvents.FUNDING_PAYMENT, (e) => fundingEvents.push(e));

      // Bar at time 14400 (4h): within same 8h window -> no funding
      engine.onMarketCandle({ candle: makeCandle(14400, 100, 105, 95, 100), index: 1 });
      expect(fundingEvents.length).toBe(0);

      // Bar at time 28800 (8h): crosses into next bucket -> funding triggered!
      // Notional = 100 * 10 = 1000. Rate = 0.001 -> Payment = -1
      engine.onMarketCandle({ candle: makeCandle(28800, 100, 105, 95, 100), index: 2 });
      expect(fundingEvents.length).toBe(1);
      expect(fundingEvents[0].payment).toBe(-1);
      expect(engine.getAccountSnapshot().walletBalance).toBe(9999);
    });
  });
});
