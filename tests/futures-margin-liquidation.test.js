import { describe, it, expect } from 'vitest';
import { PaperTradingEngine, EXECUTION_TIMING, EXECUTION_POLICY } from '../src/trading/PaperTradingEngine.js';
import { TradingEvents } from '../src/trading/TradingEvents.js';

function makeCandle(time, open, high, low, close, volume = 10) {
  return { time, open, high, low, close, volume };
}

describe('Phase 2 — Full Futures Margin & Liquidation Accounting', () => {
  describe('1. Margin Reservation, Available Margin, and Equity Invariants', () => {
    it('tracks distinct walletBalance, usedMargin, maintenanceMargin, availableMargin, and equity', () => {
      const engine = new PaperTradingEngine({
        startingBalance: 10000,
        feeRate: 0,
        marginRate: 0.1, // 10x leverage: 10% initial margin
        maintMarginRate: 0.05, // 5% maintenance margin
        executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
      });

      // Send initial bar at 100
      engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 100), index: 0 });

      // Open LONG: 10 units @ 100 = 1000 notional
      // Initial margin: 1000 * 0.1 = 100
      // Maintenance margin: 1000 * 0.05 = 50
      const res = engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 10 });
      expect(res.success).toBe(true);

      const pos = engine.getPosition('BTCUSD');
      expect(pos.initialMargin).toBe(100);
      expect(pos.maintenanceMargin).toBe(50);
      // Liquidation price for LONG: 100 * (1 - 0.1 + 0.05) = 95
      expect(pos.liquidationPrice).toBe(95);

      const acct = engine.getAccountSnapshot();
      expect(acct.walletBalance).toBe(10000);
      expect(acct.usedMargin).toBe(100);
      expect(acct.initialMargin).toBe(100);
      expect(acct.maintenanceMargin).toBe(50);
      expect(acct.unrealizedPnL).toBe(0);
      expect(acct.equity).toBe(10000);
      expect(acct.availableMargin).toBe(9900); // 10000 - 100
      expect(acct.marginRatio).toBeCloseTo(50 / 10000);

      // Price rises to 110 on bar 1
      engine.onMarketCandle({ candle: makeCandle(1060, 100, 112, 99, 110), index: 1 });

      const acct1 = engine.getAccountSnapshot();
      expect(acct1.walletBalance).toBe(10000); // unchanged until realization
      expect(acct1.unrealizedPnL).toBe(100); // (110 - 100) * 10
      expect(acct1.equity).toBe(10100);
      expect(acct1.availableMargin).toBe(10000); // 10100 - 100

      // Close position at 110
      engine.closePosition('BTCUSD');
      const acct2 = engine.getAccountSnapshot();
      expect(acct2.walletBalance).toBe(10100); // 10000 + 100 realized PnL
      expect(acct2.realizedPnL).toBe(100);
      expect(acct2.unrealizedPnL).toBe(0);
      expect(acct2.usedMargin).toBe(0); // margin released!
      expect(acct2.maintenanceMargin).toBe(0);
      expect(acct2.availableMargin).toBe(10100);
    });
  });

  describe('2. Intrabar Deterministic Liquidation', () => {
    it('triggers liquidation when adverse candle price touches liquidation price', () => {
      const engine = new PaperTradingEngine({
        startingBalance: 10000,
        feeRate: 0,
        marginRate: 0.1, // 10%
        maintMarginRate: 0.05, // 5%
        executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
      });

      engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 100), index: 0 });
      engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 10 });

      const pos = engine.getPosition('BTCUSD');
      expect(pos.liquidationPrice).toBe(95);

      const liqEvents = [];
      engine.on(TradingEvents.POSITION_LIQUIDATED, (e) => liqEvents.push(e));

      // Bar 1 drops to Low = 94, crossing 95 liquidation threshold
      engine.onMarketCandle({ candle: makeCandle(1060, 99, 101, 94, 96), index: 1 });

      // Invariant 6: Liquidation occurred and was recorded
      expect(liqEvents.length).toBe(1);
      expect(liqEvents[0].symbol).toBe('BTCUSD');
      expect(liqEvents[0].liquidationPrice).toBe(95);

      // Position should be closed
      expect(engine.getPosition('BTCUSD')).toBeNull();

      // Trade must reflect LIQUIDATION exit reason and exitPrice = 95
      const trades = engine.getTrades();
      expect(trades.length).toBe(1);
      expect(trades[0].exitReason).toBe('LIQUIDATION');
      expect(trades[0].exitPrice).toBe(95);
      expect(trades[0].grossPnL).toBe(-50); // (95 - 100) * 10
      expect(engine.getAccountSnapshot().walletBalance).toBe(9950);
      expect(engine.getAccountSnapshot().usedMargin).toBe(0);
    });

    it('realistic gap-through liquidation fills at Open if open gapped beyond liquidation price', () => {
      const engine = new PaperTradingEngine({
        startingBalance: 10000,
        feeRate: 0,
        marginRate: 0.1,
        maintMarginRate: 0.05,
        executionPolicy: EXECUTION_POLICY.REALISTIC,
        executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
      });

      engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 100), index: 0 });
      engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 10 });
      // Liq price is 95

      // Bar 1 opens with gap down at 92 (open < 95)
      engine.onMarketCandle({ candle: makeCandle(1060, 92, 93, 88, 90), index: 1 });

      const trades = engine.getTrades();
      expect(trades.length).toBe(1);
      expect(trades[0].exitReason).toBe('LIQUIDATION');
      // Gap-through slippage filled at candle.open (92)
      expect(trades[0].exitPrice).toBe(92);
      expect(trades[0].grossPnL).toBe(-80); // (92 - 100) * 10
    });

    it('liquidation for SHORT position triggers when candle High touches liquidation price', () => {
      const engine = new PaperTradingEngine({
        startingBalance: 10000,
        feeRate: 0,
        marginRate: 0.1,
        maintMarginRate: 0.05,
        executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
      });

      engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 100), index: 0 });
      // Open SHORT: 10 units @ 100
      engine.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 10 });

      const pos = engine.getPosition('BTCUSD');
      // For SHORT: 100 * (1 + 0.1 - 0.05) = 105
      expect(pos.liquidationPrice).toBe(105);

      // Bar 1 rallies to High = 106
      engine.onMarketCandle({ candle: makeCandle(1060, 101, 106, 100, 104), index: 1 });

      expect(engine.getPosition('BTCUSD')).toBeNull();
      const trades = engine.getTrades();
      expect(trades[0].exitReason).toBe('LIQUIDATION');
      expect(trades[0].exitPrice).toBe(105);
      expect(trades[0].grossPnL).toBe(-50); // (100 - 105) * 10
    });
  });
});
