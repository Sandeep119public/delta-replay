import { describe, it, expect } from 'vitest';
import { PaperTradingEngine, EXECUTION_TIMING } from '../src/trading/PaperTradingEngine.js';
import { TradingEvents } from '../src/trading/TradingEvents.js';
import { ORDER_STATUSES, ORDER_TYPES } from '../src/trading/Order.js';

function makeCandle(time, open, high, low, close, volume = 10) {
  return { time, open, high, low, close, volume };
}

describe('Phase 1 — Unified Execution Clock & Canonical Emission', () => {
  describe('1. NEXT_BAR_OPEN Execution Timing', () => {
    it('market order in NEXT_BAR_OPEN mode does NOT fill on signal bar T; fills at Open(T+1)', () => {
      const engine = new PaperTradingEngine({
        startingBalance: 10000,
        feeRate: 0,
        executionTiming: EXECUTION_TIMING.NEXT_BAR_OPEN,
      });

      // Candle 0 arrives (time = 1000, O=100, H=105, L=95, C=102)
      engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 102), index: 0 });

      // Signal generated at Bar 0 close -> place market order
      const orderRes = engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
      expect(orderRes.success).toBe(true);
      expect(orderRes.status).toBe(ORDER_STATUSES.PENDING);
      expect(orderRes.order.timing).toBe(EXECUTION_TIMING.NEXT_BAR_OPEN);
      expect(orderRes.order.createdIndex).toBe(0);

      // Invariant 1: Position is NOT opened yet on bar T!
      expect(engine.getPosition('BTCUSD')).toBeNull();

      // Candle 1 arrives (time = 1060, O=104, H=110, L=103, C=108)
      engine.onMarketCandle({ candle: makeCandle(1060, 104, 110, 103, 108), index: 1 });

      // Position must now be filled at Candle 1 Open (104), NOT Candle 0 Close (102)!
      const pos = engine.getPosition('BTCUSD');
      expect(pos).not.toBeNull();
      expect(pos.entryPrice).toBe(104);
      expect(pos.quantity).toBe(1);
      expect(pos.openedIndex).toBe(1);
    });

    it('submitIntent always uses NEXT_BAR_OPEN execution', () => {
      const engine = new PaperTradingEngine({
        startingBalance: 10000,
        feeRate: 0,
        // Engine default can be IMMEDIATE_CLOSE, but submitIntent forces NEXT_BAR_OPEN
        executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
      });

      engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 102), index: 0 });

      const res = engine.submitIntent({
        symbol: 'BTCUSD',
        side: 'BUY',
        type: ORDER_TYPES.MARKET,
        quantity: 1,
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe(ORDER_STATUSES.PENDING);
      expect(engine.getPosition('BTCUSD')).toBeNull();

      // Next bar arrives
      engine.onMarketCandle({ candle: makeCandle(1060, 105, 112, 104, 110), index: 1 });

      const pos = engine.getPosition('BTCUSD');
      expect(pos).not.toBeNull();
      expect(pos.entryPrice).toBe(105);
    });

    it('IMMEDIATE_CLOSE fills at current candle close for manual UI clicks', () => {
      const engine = new PaperTradingEngine({
        startingBalance: 10000,
        feeRate: 0,
        executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
      });

      engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 102), index: 0 });

      const res = engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
      expect(res.success).toBe(true);

      const pos = engine.getPosition('BTCUSD');
      expect(pos).not.toBeNull();
      expect(pos.entryPrice).toBe(102); // Candle 0 Close
    });

    it('closing position via NEXT_BAR_OPEN closes at Open(T+1)', () => {
      const engine = new PaperTradingEngine({
        startingBalance: 10000,
        feeRate: 0,
        executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
      });

      // Bar 0: open position at 100
      engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 100), index: 0 });
      engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
      expect(engine.getPosition('BTCUSD').entryPrice).toBe(100);

      // Bar 1 arrives
      engine.onMarketCandle({ candle: makeCandle(1060, 102, 110, 101, 108), index: 1 });

      // Signal at Bar 1 close: sell position via NEXT_BAR_OPEN
      const exitRes = engine.placeOrder({
        symbol: 'BTCUSD',
        side: 'SELL',
        quantity: 1,
        timing: EXECUTION_TIMING.NEXT_BAR_OPEN,
      });
      expect(exitRes.status).toBe(ORDER_STATUSES.PENDING);
      expect(engine.getPosition('BTCUSD')).not.toBeNull();

      // Bar 2 arrives with Open = 112
      engine.onMarketCandle({ candle: makeCandle(1120, 112, 115, 111, 114), index: 2 });

      // Position should now be closed at Bar 2 Open (112)
      expect(engine.getPosition('BTCUSD')).toBeNull();
      const trades = engine.getTrades();
      expect(trades.length).toBe(1);
      expect(trades[0].exitPrice).toBe(112);
      expect(trades[0].grossPnL).toBe(12); // 112 - 100
    });
  });

  describe('2. Canonical Single Account Snapshot Emission', () => {
    it('emits exactly one ACCOUNT_UPDATED snapshot per completed bar', () => {
      const engine = new PaperTradingEngine({ startingBalance: 10000, feeRate: 0 });
      let accountUpdates = 0;
      engine.on(TradingEvents.ACCOUNT_UPDATED, () => accountUpdates++);

      engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 100), index: 0 });
      expect(accountUpdates).toBe(1);

      accountUpdates = 0;
      engine.onMarketCandle({ candle: makeCandle(1060, 102, 110, 101, 108), index: 1 });
      expect(accountUpdates).toBe(1);
    });

    it('emits exactly one ACCOUNT_UPDATED even when pending order fills during the bar', () => {
      const engine = new PaperTradingEngine({ startingBalance: 10000, feeRate: 0 });
      engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 100), index: 0 });

      // Place limit order at 90
      engine.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });

      let accountUpdates = 0;
      engine.on(TradingEvents.ACCOUNT_UPDATED, () => accountUpdates++);

      // Candle drops to 85, filling limit order
      engine.onMarketCandle({ candle: makeCandle(1060, 100, 102, 85, 95), index: 1 });

      // Invariant 3: Exactly one canonical ACCOUNT_UPDATED for this completed bar!
      expect(accountUpdates).toBe(1);
      expect(engine.getPosition('BTCUSD')).not.toBeNull();
    });

    it('emits exactly one ACCOUNT_UPDATED even when Stop-Loss triggers during the bar', () => {
      const engine = new PaperTradingEngine({ startingBalance: 10000, feeRate: 0 });
      engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 100), index: 0 });
      engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
      engine.setStopLoss('BTCUSD', 90);

      let accountUpdates = 0;
      engine.on(TradingEvents.ACCOUNT_UPDATED, () => accountUpdates++);

      // Candle drops to 80, triggering Stop-Loss
      engine.onMarketCandle({ candle: makeCandle(1060, 98, 99, 80, 85), index: 1 });

      // Invariant 3 & 4: Exactly one canonical ACCOUNT_UPDATED emitted
      expect(accountUpdates).toBe(1);
      expect(engine.getPosition('BTCUSD')).toBeNull();
      expect(engine.getTrades().length).toBe(1);
      expect(engine.getTrades()[0].exitReason).toBe('STOP_LOSS');
    });

    it('emits BAR_CLOSE event with frozen canonical candle', () => {
      const engine = new PaperTradingEngine({ startingBalance: 10000, feeRate: 0 });
      const barCloseEvents = [];
      engine.on(TradingEvents.BAR_CLOSE, (e) => barCloseEvents.push(e));

      engine.onMarketCandle({ candle: makeCandle(1000, 100, 105, 95, 102), index: 0 });

      expect(barCloseEvents.length).toBe(1);
      expect(barCloseEvents[0].phase).toBe('BAR_CLOSE');
      expect(barCloseEvents[0].index).toBe(0);
      expect(barCloseEvents[0].candle.close).toBe(102);
      expect(Object.isFrozen(barCloseEvents[0].candle)).toBe(true);
    });
  });
});
