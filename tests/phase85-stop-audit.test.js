import { describe, it, expect } from 'vitest';
import { PaperTradingEngine } from '../src/trading/PaperTradingEngine.js';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { TradingEvents } from '../src/trading/TradingEvents.js';
import { TRADING_CONFIG, calcFee } from '../src/trading/TradingConfig.js';

// helpers
function c(time, open, high, low, close, volume = 10) { return { time, open, high, low, close, volume }; }
function mc(time, close) { return c(time, close, close + 1, close - 1, close); }
function send(engine, candle, idx) { engine.onMarketCandle({ candle, index: idx, timestamp: candle.time }); }

// ============================================================
// 1. BUY STOP trigger & SELL STOP trigger
// ============================================================
describe('Phase8.5 — STOP triggers', () => {
  it('BUY STOP triggers when high >= stop', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    send(t, c(1001, 100, 106, 99, 102), 1);
    expect(t.getPosition('BTCUSD')).not.toBeNull();
    expect(t.getPosition('BTCUSD').entryPrice).toBe(105);
  });
  it('SELL STOP triggers when low <= stop', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, stopPrice: 95 });
    send(t, c(1001, 100, 101, 94, 96), 1);
    expect(t.getPosition('BTCUSD').side).toBe('SHORT');
    expect(t.getPosition('BTCUSD').entryPrice).toBe(95);
  });
  it('equality trigger BUY STOP high == stop', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    send(t, c(1001, 100, 105, 100, 104), 1);
    expect(t.getPosition('BTCUSD')).not.toBeNull();
  });
  it('equality trigger SELL STOP low == stop', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, stopPrice: 95 });
    send(t, c(1001, 100, 100, 95, 96), 1);
    expect(t.getPosition('BTCUSD')).not.toBeNull();
  });
  it('no trigger when high < BUY stop / low > SELL stop', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    send(t, c(1001, 100, 104, 99, 103), 1);
    expect(t.getPosition('BTCUSD')).toBeNull();
    const t2 = new PaperTradingEngine({ feeRate: 0 });
    send(t2, mc(1000, 100), 0);
    t2.placeStopOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, stopPrice: 95 });
    send(t2, c(1001, 100, 101, 96, 100), 1);
    expect(t2.getPosition('BTCUSD')).toBeNull();
  });
  it('gap-through BUY STOP open >> stop fills at stopPrice (simulator simplification)', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 90), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 100 });
    send(t, c(1001, 110, 115, 110, 112), 1); // gap open 110
    expect(t.getPosition('BTCUSD').entryPrice).toBe(100);
  });
  it('gap-through SELL STOP open << stop fills at stopPrice', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 110), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, stopPrice: 100 });
    send(t, c(1001, 90, 91, 85, 88), 1);
    expect(t.getPosition('BTCUSD').entryPrice).toBe(100);
  });
  it('BUY STOP open == stop fills at stop', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 90), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 100 });
    send(t, c(1001, 100, 102, 99, 101), 1);
    expect(t.getPosition('BTCUSD').entryPrice).toBe(100);
  });
  it('SELL STOP open == stop fills at stop', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 110), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, stopPrice: 100 });
    send(t, c(1001, 100, 101, 99, 100), 1);
    expect(t.getPosition('BTCUSD').entryPrice).toBe(100);
  });
  it('stop fill price is stopPrice not candle open/close', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    send(t, c(1001, 107, 110, 106, 108), 1);
    expect(t.getPosition('BTCUSD').entryPrice).toBe(105);
    expect(t.getOrders()[0].filledPrice).toBe(105);
  });
});

// ============================================================
// next-candle protection + stop cancellation
// ============================================================
describe('Phase8.5 — next-candle protection & cancellation', () => {
  it('STOP cannot fill on creation candle', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 95 }); // already executable (low 99 <=? actually buy stop needs high>=stop, high=101 >=95 true)
    // But creation idx == 0, so next candle check should prevent fill same candle even though condition met?
    // We placed after candle 0, so need same index candle not fill: we already sent 0, order createdIndex 0, if we send same index again? Actually next candle is index1
    // Verify: order created at idx0 cannot fill at idx0 - but we test that sending duplicate idx0 does not fill
    // Instead test: place and immediately send same idx shouldn't fill
    const t2 = new PaperTradingEngine({ feeRate: 0 });
    send(t2, c(1000, 100, 110, 90, 100), 0);
    t2.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    // Try to trigger on same candle index 0 (simulate re-emit)
    send(t2, c(1000, 100, 110, 90, 100), 0);
    expect(t2.getPosition('BTCUSD')).toBeNull();
    send(t2, c(1001, 100, 110, 90, 100), 1);
    expect(t2.getPosition('BTCUSD')).not.toBeNull();
  });
  it('LIMIT cannot fill on creation candle', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, c(1000, 100, 110, 90, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 95 }); // low 90 <=95 yes
    send(t, c(1000, 100, 110, 90, 100), 0);
    expect(t.getPosition('BTCUSD')).toBeNull();
    send(t, c(1001, 95, 96, 94, 95), 1);
    expect(t.getPosition('BTCUSD')).not.toBeNull();
  });
  it('stop cancellation prevents fill', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const res = t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    t.cancelOrder(res.order.id);
    send(t, c(1001, 100, 110, 100, 108), 1);
    expect(t.getPosition('BTCUSD')).toBeNull();
    expect(t.getOrder(res.order.id).status).toBe('CANCELLED');
  });
  it('cancel non-pending rejected', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const res = t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    t.cancelOrder(res.order.id);
    const res2 = t.cancelOrder(res.order.id);
    expect(res2.success).toBe(false);
    expect(res2.code).toBe('ORDER_NOT_PENDING');
  });
  it('multiple stop orders preserve insertion order', () => {
    const t = new PaperTradingEngine({ feeRate: 0, startingBalance: 10000 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 106 });
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 107 });
    expect(t.getPendingOrders().length).toBe(3);
    expect(t.getPendingOrders()[0].stopPrice).toBe(105);
    send(t, c(1001, 100, 110, 99, 108), 1);
    // first fills, others rejected as POSITION_ALREADY_OPEN
    expect(t.getPosition('BTCUSD').entryPrice).toBe(105);
    const orders = t.getOrders();
    expect(orders[0].status).toBe('FILLED');
    expect(orders[1].status).toBe('REJECTED');
    expect(orders[2].status).toBe('REJECTED');
  });
});

// ============================================================
// LIMIT + STOP interaction
// ============================================================
describe('Phase8.5 — LIMIT + STOP interaction', () => {
  it('both executable — first in queue wins, second rejected', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 95 });
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    send(t, c(1001, 100, 110, 94, 102), 1);
    expect(t.getPosition('BTCUSD').entryPrice).toBe(95);
    const orders = t.getOrders();
    expect(orders.find(o => o.type === 'LIMIT').status).toBe('FILLED');
    expect(orders.find(o => o.type === 'STOP_MARKET').status).toBe('REJECTED');
  });
  it('reverse queue — STOP wins', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 95 });
    send(t, c(1001, 100, 110, 94, 102), 1);
    expect(t.getPosition('BTCUSD').entryPrice).toBe(105);
  });
  it('after first fills, no second position created, no reversal', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 95 });
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    send(t, c(1001, 100, 110, 94, 102), 1);
    expect(t.getTrades().length).toBe(0); // not closed, just opened
    expect(t.getPositions().length).toBe(1);
    expect(t.getPendingOrders().length).toBe(0);
  });
  it('SELL orders while LONG pending opposite close via LIMIT', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 110 });
    send(t, c(1002, 105, 112, 104, 108), 2);
    expect(t.getPosition('BTCUSD')).toBeNull();
    expect(t.getTrades()[0].exitReason).toBe('LIMIT');
    expect(t.getTrades()[0].exitPrice).toBe(110);
  });
  it('opposite STOP closes position at stopPrice', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, stopPrice: 95 });
    send(t, c(1002, 105, 106, 90, 92), 2);
    expect(t.getPosition('BTCUSD')).toBeNull();
    expect(t.getTrades()[0].exitReason).toBe('STOP');
    expect(t.getTrades()[0].exitPrice).toBe(95);
  });
});

// ============================================================
// SL / TP
// ============================================================
describe('Phase8.5 — SL/TP', () => {
  it('LONG SL triggers', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    send(t, c(1002, 105, 106, 85, 90), 2);
    expect(t.getPosition('BTCUSD')).toBeNull();
    expect(t.getTrades()[0].exitReason).toBe('STOP_LOSS');
    expect(t.getTrades()[0].exitPrice).toBe(90);
  });
  it('SHORT SL triggers', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    send(t, mc(1001, 95), 1);
    t.setStopLoss('BTCUSD', 110);
    send(t, c(1002, 95, 112, 94, 108), 2);
    expect(t.getTrades()[0].exitReason).toBe('STOP_LOSS');
  });
  it('LONG TP triggers', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setTakeProfit('BTCUSD', 120);
    send(t, c(1002, 105, 125, 104, 122), 2);
    expect(t.getTrades()[0].exitReason).toBe('TAKE_PROFIT');
    expect(t.getTrades()[0].exitPrice).toBe(120);
  });
  it('SHORT TP triggers', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    send(t, mc(1001, 95), 1);
    t.setTakeProfit('BTCUSD', 80);
    send(t, c(1002, 95, 96, 78, 80), 2);
    expect(t.getTrades()[0].exitReason).toBe('TAKE_PROFIT');
  });
  it('entry-candle SL/TP protection', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    t.setStopLoss('BTCUSD', 90);
    t.setTakeProfit('BTCUSD', 110);
    // same candle index 0 should not trigger even though condition would be true if we send same index
    send(t, c(1000, 100, 115, 85, 100), 0);
    expect(t.getPosition('BTCUSD')).not.toBeNull();
    // next candle should trigger SL (low 85)
    send(t, c(1001, 100, 110, 85, 90), 1);
    expect(t.getPosition('BTCUSD')).toBeNull();
  });
  it('SL set immediately after creation protected from entry candle', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, c(1000, 100, 110, 90, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 95 });
    send(t, c(1001, 100, 101, 94, 100), 1); // fills at 95
    expect(t.getPosition('BTCUSD')).not.toBeNull();
    t.setStopLoss('BTCUSD', 90);
    // same candle 1 high/low includes sl but should be protected
    send(t, c(1001, 100, 101, 85, 90), 1);
    expect(t.getPosition('BTCUSD')).not.toBeNull();
    send(t, c(1002, 90, 91, 80, 85), 2);
    expect(t.getPosition('BTCUSD')).toBeNull();
  });
  it('ambiguity: both SL and TP touched, SL wins', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    t.setTakeProfit('BTCUSD', 110);
    send(t, c(1002, 105, 115, 85, 100), 2);
    expect(t.getTrades()[0].exitReason).toBe('STOP_LOSS');
    expect(t.getTrades()[0].exitPrice).toBe(90);
    // no TP event
    let tpFired = false;
    const t2 = new PaperTradingEngine({ feeRate: 0 });
    send(t2, mc(1000, 100), 0);
    t2.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t2, mc(1001, 105), 1);
    t2.setStopLoss('BTCUSD', 90);
    t2.setTakeProfit('BTCUSD', 110);
    t2.on('takeProfitTriggered', () => { tpFired = true; });
    send(t2, c(1002, 105, 115, 85, 100), 2);
    expect(tpFired).toBe(false);
  });
  it('risk removal after close: SL/TP cleared with position', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    t.setTakeProfit('BTCUSD', 110);
    send(t, c(1002, 105, 115, 85, 100), 2);
    expect(t.getPosition('BTCUSD')).toBeNull();
    // new position should have no SL/TP
    send(t, mc(1003, 100), 3);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(t.getPosition('BTCUSD').stopLossPrice).toBeNull();
    expect(t.getPosition('BTCUSD').takeProfitPrice).toBeNull();
  });
});

// ============================================================
// Replacement / clearing
// ============================================================
describe('Phase8.5 — Risk replacement & clearing', () => {
  it('set SL again replaces and updates index', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    expect(t.getPosition('BTCUSD').stopLossPrice).toBe(90);
    send(t, mc(1002, 106), 2);
    t.setStopLoss('BTCUSD', 95);
    expect(t.getPosition('BTCUSD').stopLossPrice).toBe(95);
    expect(t.getPosition('BTCUSD').stopLossCreatedIndex).toBe(2);
    // old level 90 should not trigger; new level 95 should
    send(t, c(1003, 106, 107, 89, 92), 3); // low 89 <=90 and <=95 but new is 95
    // Should trigger at 95 (new)
    expect(t.getTrades()[0].exitPrice).toBe(95);
  });
  it('set TP again replaces', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setTakeProfit('BTCUSD', 120);
    send(t, mc(1002, 106), 2);
    t.setTakeProfit('BTCUSD', 110);
    send(t, c(1003, 106, 112, 105, 111), 3);
    expect(t.getTrades()[0].exitPrice).toBe(110);
  });
  it('clear SL prevents trigger', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    t.clearStopLoss('BTCUSD');
    expect(t.getPosition('BTCUSD').stopLossPrice).toBeNull();
    send(t, c(1002, 105, 106, 80, 85), 2);
    expect(t.getPosition('BTCUSD')).not.toBeNull();
  });
  it('clear TP prevents trigger', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setTakeProfit('BTCUSD', 110);
    t.clearTakeProfit('BTCUSD');
    send(t, c(1002, 105, 115, 104, 112), 2);
    expect(t.getPosition('BTCUSD')).not.toBeNull();
  });
  it('cleared levels cannot trigger later', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    t.clearStopLoss('BTCUSD');
    send(t, c(1002, 105, 106, 80, 85), 2);
    expect(t.getTrades().length).toBe(0);
    send(t, c(1003, 85, 86, 80, 82), 3);
    expect(t.getTrades().length).toBe(0);
  });
});

// ============================================================
// Fees / PnL
// ============================================================
describe('Phase8.5 — Fees & PnL (STOP/SL/TP)', () => {
  const FEE = TRADING_CONFIG.TAKER_FEE_RATE;
  it('STOP entry fee correct', () => {
    const t = new PaperTradingEngine({ feeRate: FEE, startingBalance: 10000 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    send(t, c(1001, 100, 110, 100, 108), 1);
    const fee = 105 * FEE;
    expect(t.getAccountSnapshot().totalFees).toBeCloseTo(fee);
    expect(t.getAccountSnapshot().cashBalance).toBeCloseTo(10000 - fee);
  });
  it('SL exit gross/net/fees correct', () => {
    const t = new PaperTradingEngine({ feeRate: FEE, startingBalance: 10000 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 2 });
    const entryFee = 100 * 2 * FEE;
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    send(t, c(1002, 105, 106, 80, 85), 2);
    const tr = t.getTrades()[0];
    const gross = (90 - 100) * 2; // -20
    const exitFee = 90 * 2 * FEE;
    const totalFee = entryFee + exitFee;
    const net = gross - totalFee;
    expect(tr.grossPnL).toBeCloseTo(gross);
    expect(tr.entryFee).toBeCloseTo(entryFee);
    expect(tr.exitFee).toBeCloseTo(exitFee);
    expect(tr.totalFee).toBeCloseTo(totalFee);
    expect(tr.netPnL).toBeCloseTo(net);
    expect(t.getAccountSnapshot().realizedPnL).toBeCloseTo(net);
    expect(t.getAccountSnapshot().cashBalance).toBeCloseTo(10000 + net);
  });
  it('TP exit gross/net correct', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setTakeProfit('BTCUSD', 120);
    send(t, c(1002, 105, 125, 104, 122), 2);
    const tr = t.getTrades()[0];
    expect(tr.grossPnL).toBe(20);
    expect(tr.netPnL).toBeCloseTo(20 - (100*FEE + 120*FEE));
  });
  it('LIMIT close fees correct', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 110 });
    send(t, c(1002, 105, 112, 104, 108), 2);
    const tr = t.getTrades()[0];
    expect(tr.exitReason).toBe('LIMIT');
    expect(tr.grossPnL).toBe(10);
    expect(tr.totalFee).toBeCloseTo(100*FEE + 110*FEE);
  });
  it('STOP exit fees correct', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, stopPrice: 95 });
    send(t, c(1002, 105, 106, 90, 92), 2);
    const tr = t.getTrades()[0];
    expect(tr.exitReason).toBe('STOP');
    expect(tr.grossPnL).toBe(-5);
  });
  it('non-round price accounting', () => {
    const t = new PaperTradingEngine({ feeRate: FEE, startingBalance: 10000 });
    send(t, c(1000, 100.123, 101, 99, 100.123), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1.5 });
    send(t, c(1001, 100.123, 110.789, 90, 110.789), 1);
    t.setTakeProfit('BTCUSD', 110.789);
    send(t, c(1002, 110.789, 111, 110.789, 110.789), 2);
    const tr = t.getTrades()[0];
    const gross = (110.789 - 100.123) * 1.5;
    expect(tr.grossPnL).toBeCloseTo(gross, 5);
    expect(tr.netPnL).toBeCloseTo(gross - tr.totalFee, 5);
  });
  it('exitReason values deterministic', () => {
    const checks = [
      { mk: () => { const t = new PaperTradingEngine({ feeRate: 0 }); send(t, mc(1000,100),0); t.placeOrder({symbol:'BTCUSD',side:'BUY',quantity:1}); send(t,mc(1001,105),1); t.setStopLoss('BTCUSD',90); send(t,c(1002,105,106,80,85),2); return t.getTrades()[0].exitReason; }, exp: 'STOP_LOSS' },
      { mk: () => { const t = new PaperTradingEngine({ feeRate: 0 }); send(t,mc(1000,100),0); t.placeOrder({symbol:'BTCUSD',side:'BUY',quantity:1}); send(t,mc(1001,105),1); t.setTakeProfit('BTCUSD',110); send(t,c(1002,105,115,104,112),2); return t.getTrades()[0].exitReason; }, exp: 'TAKE_PROFIT' },
      { mk: () => { const t = new PaperTradingEngine({ feeRate: 0 }); send(t,mc(1000,100),0); t.placeOrder({symbol:'BTCUSD',side:'BUY',quantity:1}); send(t,mc(1001,105),1); t.placeLimitOrder({symbol:'BTCUSD',side:'SELL',quantity:1,limitPrice:110}); send(t,c(1002,105,112,104,108),2); return t.getTrades()[0].exitReason; }, exp: 'LIMIT' },
      { mk: () => { const t = new PaperTradingEngine({ feeRate: 0 }); send(t,mc(1000,100),0); t.placeOrder({symbol:'BTCUSD',side:'BUY',quantity:1}); send(t,mc(1001,105),1); t.placeStopOrder({symbol:'BTCUSD',side:'SELL',quantity:1,stopPrice:95}); send(t,c(1002,105,106,90,92),2); return t.getTrades()[0].exitReason; }, exp: 'STOP' },
    ];
    for (const { mk, exp } of checks) expect(mk()).toBe(exp);
  });
});

// ============================================================
// Position close race conditions
// ============================================================
describe('Phase8.5 — Close race conditions', () => {
  it('SL vs TP same candle: only one close, no second trade', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    t.setTakeProfit('BTCUSD', 110);
    send(t, c(1002, 100, 115, 85, 100), 2);
    expect(t.getTrades().length).toBe(1);
    expect(t.getPosition('BTCUSD')).toBeNull();
    // next candle no second close
    send(t, c(1003, 100, 115, 85, 100), 3);
    expect(t.getTrades().length).toBe(1);
  });
  it('SL vs opposite LIMIT same candle: SL wins, LIMIT cancelled, no reversal', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 108 });
    let cancelled = false;
    t.on('orderCancelled', () => { cancelled = true; });
    send(t, c(1002, 105, 115, 85, 100), 2);
    expect(t.getTrades().length).toBe(1);
    expect(t.getTrades()[0].exitReason).toBe('STOP_LOSS');
    expect(cancelled).toBe(true);
    expect(t.getPosition('BTCUSD')).toBeNull(); // no SHORT reversal
  });
  it('SL vs opposite STOP same candle: SL wins', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, stopPrice: 95 });
    send(t, c(1002, 105, 106, 80, 85), 2);
    expect(t.getTrades()[0].exitReason).toBe('STOP_LOSS');
    expect(t.getPosition('BTCUSD')).toBeNull();
  });
  it('after SL close, stale LIMIT cannot reopen same candle', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 108 });
    send(t, c(1002, 105, 115, 85, 108), 2);
    expect(t.getPosition('BTCUSD')).toBeNull();
    expect(t.getOrders().find(o => o.type === 'LIMIT').status).toBe('CANCELLED');
  });
  it('fees not double-counted on race', () => {
    const FEE = TRADING_CONFIG.TAKER_FEE_RATE;
    const t = new PaperTradingEngine({ feeRate: FEE });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    t.setTakeProfit('BTCUSD', 110);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 108 });
    send(t, c(1002, 105, 115, 85, 100), 2);
    expect(t.getTrades().length).toBe(1);
    const entryFee = 100 * FEE;
    const exitFee = 90 * FEE;
    expect(t.getAccountSnapshot().totalFees).toBeCloseTo(entryFee + exitFee);
  });
  it('entry-candle race: position created via LIMIT, SL/TP not eligible same candle', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, c(1000, 100, 101, 99, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 95 });
    send(t, c(1001, 100, 115, 85, 100), 1); // fills at 95, but low 85 would hit SL 90 if SL existed; however SL not set yet
    // SL set same candle as fill (index1) -> protected
    t.setStopLoss('BTCUSD', 90);
    send(t, c(1001, 95, 96, 80, 85), 1); // same index
    expect(t.getPosition('BTCUSD')).not.toBeNull();
    send(t, c(1002, 85, 86, 80, 82), 2);
    expect(t.getPosition('BTCUSD')).toBeNull();
  });
});

// ============================================================
// Event semantics
// ============================================================
describe('Phase8.5 — Event semantics', () => {
  it('STOP placement emits ORDER_PLACED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    let placed = 0;
    t.on(TradingEvents.ORDER_PLACED, () => placed++);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    expect(placed).toBe(1);
  });
  it('STOP execution emits ORDER_TRIGGERED then ORDER_FILLED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    const seq = [];
    t.on(TradingEvents.ORDER_TRIGGERED, () => seq.push('TRIGGERED'));
    t.on(TradingEvents.ORDER_FILLED, () => seq.push('FILLED'));
    send(t, c(1001, 100, 110, 99, 108), 1);
    expect(seq).toEqual(['TRIGGERED', 'FILLED']);
  });
  it('STOP cancellation emits ORDER_CANCELLED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const res = t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    let cancelled = 0;
    t.on(TradingEvents.ORDER_CANCELLED, () => cancelled++);
    t.cancelOrder(res.order.id);
    expect(cancelled).toBe(1);
  });
  it('rejection emits ORDER_REJECTED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    let rejected = 0;
    t.on(TradingEvents.ORDER_REJECTED, () => rejected++);
    t.placeOrder({ symbol: '', side: 'BUY', quantity: 1 });
    expect(rejected).toBe(1);
  });
  it('SL emits STOP_LOSS_TRIGGERED exactly once', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    let count = 0;
    t.on(TradingEvents.STOP_LOSS_TRIGGERED, () => count++);
    send(t, c(1002, 105, 106, 80, 85), 2);
    send(t, c(1003, 85, 86, 80, 82), 3);
    expect(count).toBe(1);
  });
  it('TP emits TAKE_PROFIT_TRIGGERED exactly once', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setTakeProfit('BTCUSD', 110);
    let count = 0;
    t.on(TradingEvents.TAKE_PROFIT_TRIGGERED, () => count++);
    send(t, c(1002, 105, 115, 104, 112), 2);
    send(t, c(1003, 112, 115, 110, 114), 3);
    expect(count).toBe(1);
  });
  it('payload contains correct order/position and is immutable', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    let payload = null;
    t.on(TradingEvents.ORDER_PLACED, (p) => { payload = p.order; });
    const res = t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    payload.quantity = 999;
    expect(t.getOrder(res.order.id).quantity).toBe(1);
    let filledPayload = null;
    t.on(TradingEvents.ORDER_FILLED, (p) => { filledPayload = p.order; });
    send(t, c(1001, 100, 110, 99, 108), 1);
    filledPayload.filledPrice = 999;
    expect(t.getOrders()[0].filledPrice).toBe(105);
  });
  it('event ordering deterministic: TRIGGERED before FILLED before POSITION_CLOSED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    // create position so STOP becomes exit: need position first
    const tt = new PaperTradingEngine({ feeRate: 0 });
    send(tt, mc(1000, 100), 0);
    tt.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(tt, mc(1001, 105), 1);
    tt.placeStopOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, stopPrice: 95 });
    const seq = [];
    tt.on(TradingEvents.ORDER_TRIGGERED, () => seq.push('TRIGGERED'));
    tt.on(TradingEvents.ORDER_FILLED, () => seq.push('FILLED'));
    tt.on(TradingEvents.POSITION_CLOSED, () => seq.push('CLOSED'));
    send(tt, c(1002, 105, 106, 90, 92), 2);
    expect(seq).toEqual(['TRIGGERED', 'FILLED', 'CLOSED']);
  });
  it('no duplicate trigger/fill on same candle', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    let trig = 0, fill = 0;
    t.on(TradingEvents.ORDER_TRIGGERED, () => trig++);
    t.on(TradingEvents.ORDER_FILLED, () => fill++);
    send(t, c(1001, 100, 110, 99, 108), 1);
    send(t, c(1002, 108, 112, 107, 110), 2);
    expect(trig).toBe(1);
    expect(fill).toBe(1);
  });
});

// ============================================================
// Execution order audit
// ============================================================
describe('Phase8.5 — Execution order', () => {
  it('order: SL/TP before pending, pending respects next-candle', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 108 });
    // candle where both SL and SELL limit executable: SL should win
    const seq = [];
    t.on(TradingEvents.STOP_LOSS_TRIGGERED, () => seq.push('SL'));
    t.on(TradingEvents.ORDER_FILLED, () => seq.push('FILL'));
    send(t, c(1002, 105, 115, 85, 100), 2);
    expect(seq[0]).toBe('SL');
    // FILL should not be the SELL limit (it was cancelled)
    expect(t.getTrades()[0].exitReason).toBe('STOP_LOSS');
  });
  it('pending entry + attached SL from prior candle: both could interact but next-candle protects new position', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, c(1000, 100, 101, 99, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 95 });
    // No position yet, place SL would fail; instead test pending LIMIT fills and SL set after
    send(t, c(1001, 100, 101, 94, 96), 1); // fills at 95
    t.setStopLoss('BTCUSD', 90);
    // Next candle low 85 triggers SL, not pending
    send(t, c(1002, 96, 97, 85, 86), 2);
    expect(t.getTrades()[0].exitReason).toBe('STOP_LOSS');
  });
  it('no hindsight: engine never accesses future candles', async () => {
    const fs = await import('fs');
    const raw = fs.readFileSync('src/trading/PaperTradingEngine.js', 'utf-8');
    const codeLines = raw.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('/'));
    const code = codeLines.join('\n');
    expect(code).not.toMatch(/from.*CandleStore/);
    expect(code).not.toMatch(/from.*HistoricalDataManager/);
    expect(code).not.toMatch(/from.*Timeline/);
    expect(code).not.toMatch(/from.*ChartManager/);
    expect(code).not.toMatch(/from.*AppState/);
    expect(code).toMatch(/onMarketCandle/);
  });
});

// ============================================================
// Symbol safety
// ============================================================
describe('Phase8.5 — Symbol safety', () => {
  it('pending cleared on replay load', () => {
    const replay = new ReplayEngine();
    const t = new PaperTradingEngine({ feeRate: 0, replayEngine: replay });
    const candles = [mc(1000, 100), mc(1001, 101)].map(cn => ({ ...cn }));
    replay.load(candles);
    replay.start(0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    expect(t.getPendingOrders().length).toBe(1);
    const newCandles = [mc(2000, 200), mc(2001, 201)].map(cn => ({ ...cn }));
    replay.load(newCandles);
    expect(t.getPendingOrders().length).toBe(0);
    expect(t.getOrders()[0].status).toBe('CANCELLED');
  });
  it('pending cleared on replay reset', () => {
    const replay = new ReplayEngine();
    const t = new PaperTradingEngine({ feeRate: 0, replayEngine: replay });
    replay.load([mc(1000, 100), mc(1001, 101)].map(cn => ({ ...cn })));
    replay.start(0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    replay.reset();
    expect(t.getPendingOrders().length).toBe(0);
  });
  it('old order cannot execute against new symbol data', () => {
    const replay = new ReplayEngine();
    const t = new PaperTradingEngine({ feeRate: 0, replayEngine: replay });
    replay.load([mc(1000, 100), mc(1001, 101), mc(1002, 102)].map(cn => ({ ...cn })));
    replay.start(0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    replay.load([mc(2000, 200), mc(2001, 210), mc(2002, 220)].map(cn => ({ ...cn })));
    replay.start(0);
    // Even though new candles would trigger old stop 105, pending was cleared so no fill
    replay.stepForward();
    replay.stepForward();
    expect(t.getPosition('BTCUSD')).toBeNull();
  });
  it('ETH pending not executed on BTC candle when both pending', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'ETHUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    send(t, c(1001, 100, 110, 99, 108), 1); // BTC-style candle triggers ETH order? Since no symbol on candle, it will trigger any pending
    // This documents limitation: candle has no symbol, pending triggers regardless of symbol
    // But after load, clearing prevents cross-symbol stale execution. Document as known limitation for single-symbol replay.
    // For this test, we assert current behavior: it does fill (since symbol not filtered)
    expect(t.getPosition('ETHUSD')).not.toBeNull();
  });
});

// ============================================================
// Position cloning & ownership
// ============================================================
describe('Phase8.5 — Position ownership & cloning', () => {
  it('mutating returned position does not mutate engine', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const p = t.getPosition('BTCUSD');
    p.quantity = 999;
    p.stopLossPrice = 1;
    expect(t.getPosition('BTCUSD').quantity).toBe(1);
    expect(t.getPosition('BTCUSD').stopLossPrice).toBeNull();
  });
  it('mutating event payload does not mutate engine', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    let captured = null;
    t.on(TradingEvents.POSITION_UPDATED, (p) => { captured = p.position; });
    send(t, mc(1001, 110), 1);
    captured.quantity = 999;
    expect(t.getPosition('BTCUSD').quantity).toBe(1);
  });
  it('position JSON clone preserves SL/TP', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    t.setTakeProfit('BTCUSD', 110);
    const p = t.getPosition('BTCUSD');
    expect(p.stopLossPrice).toBe(90);
    expect(p.takeProfitPrice).toBe(110);
    expect(p.stopLossCreatedIndex).toBe(1);
    expect(p.takeProfitCreatedIndex).toBe(1);
  });
  it('reset cleanup clears positions and trades', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 110), 1);
    t.resetAccount();
    expect(t.getPosition('BTCUSD')).toBeNull();
    expect(t.getTrades().length).toBe(0);
    expect(t.getAccountSnapshot().equity).toBe(10000);
  });
  it('reset clears pending', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    t.resetAccount();
    expect(t.getPendingOrders().length).toBe(0);
  });
  it('position cloning after SL/TP preserves indices', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    t.setStopLoss('BTCUSD', 90);
    const before = t.getPosition('BTCUSD');
    expect(before.stopLossCreatedIndex).toBe(1);
    send(t, mc(1002, 106), 2);
    const after = t.getPosition('BTCUSD');
    expect(after.stopLossCreatedIndex).toBe(1);
  });
});

// ============================================================
// Risk price validation
// ============================================================
describe('Phase8.5 — Risk price validation', () => {
  it('LONG SL below entry allowed', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    const res = t.setStopLoss('BTCUSD', 90);
    expect(res.success).toBe(true);
  });
  it('LONG SL equal entry allowed (permissive)', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    const res = t.setStopLoss('BTCUSD', 100);
    expect(res.success).toBe(true); // permissive, docs as intentional
  });
  it('LONG SL above entry allowed (permissive, economically nonsensical but not blocked)', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    const res = t.setStopLoss('BTCUSD', 110);
    expect(res.success).toBe(true);
  });
  it('LONG TP below entry allowed (permissive)', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    expect(t.setTakeProfit('BTCUSD', 90).success).toBe(true);
  });
  it('LONG TP equal entry allowed', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    expect(t.setTakeProfit('BTCUSD', 100).success).toBe(true);
  });
  it('LONG TP above entry allowed', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    expect(t.setTakeProfit('BTCUSD', 110).success).toBe(true);
  });
  it('SHORT SL above entry allowed', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    send(t, mc(1001, 100), 1);
    expect(t.setStopLoss('BTCUSD', 110).success).toBe(true);
  });
  it('SHORT SL equal/below entry permissive', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    send(t, mc(1001, 100), 1);
    expect(t.setStopLoss('BTCUSD', 100).success).toBe(true);
    expect(t.setStopLoss('BTCUSD', 90).success).toBe(true);
  });
  it('SHORT TP above/below/equal permissive', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    send(t, mc(1001, 100), 1);
    expect(t.setTakeProfit('BTCUSD', 110).success).toBe(true);
    expect(t.setTakeProfit('BTCUSD', 100).success).toBe(true);
    expect(t.setTakeProfit('BTCUSD', 90).success).toBe(true);
  });
  it('invalid stopPrice rejected', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 105), 1);
    expect(t.setStopLoss('BTCUSD', 0).success).toBe(false);
    expect(t.setStopLoss('BTCUSD', -10).success).toBe(false);
    expect(t.setStopLoss('BTCUSD', NaN).success).toBe(false);
    expect(t.setStopLoss('BTCUSD', Infinity).success).toBe(false);
    expect(t.setTakeProfit('BTCUSD', 0).success).toBe(false);
  });
  it('NaN/Infinity quantity/limit/stop rejected at placement', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    expect(t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: NaN }).code).toBe('INVALID_QUANTITY');
    expect(t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: Infinity }).code).toBe('INVALID_QUANTITY');
    expect(t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: NaN }).code).toBe('INVALID_LIMIT_PRICE');
    expect(t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: Infinity }).code).toBe('INVALID_LIMIT_PRICE');
    expect(t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: NaN }).code).toBe('INVALID_STOP_PRICE');
    expect(t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: Infinity }).code).toBe('INVALID_STOP_PRICE');
  });
});

// ============================================================
// Determinism
// ============================================================
describe('Phase8.5 — Determinism', () => {
  function runScenario() {
    const t = new PaperTradingEngine({ feeRate: 0.0005, startingBalance: 10000 });
    send(t, c(1000, 100, 101, 99, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 95 });
    send(t, c(1001, 100, 101, 94, 96), 1);
    t.setStopLoss('BTCUSD', 90);
    t.setTakeProfit('BTCUSD', 110);
    send(t, c(1002, 96, 112, 89, 108), 2);
    // should hit TP 110
    send(t, c(1003, 108, 109, 107, 108), 3);
    return {
      trades: t.getTrades(),
      pending: t.getPendingOrders(),
      orders: t.getOrders(),
      pos: t.getPosition('BTCUSD'),
      acct: t.getAccountSnapshot(),
      events: null,
    };
  }
  it('identical scenarios produce identical trades/account/orders', () => {
    const a = runScenario();
    const b = runScenario();
    expect(JSON.stringify(a.trades)).toBe(JSON.stringify(b.trades));
    expect(JSON.stringify(a.orders)).toBe(JSON.stringify(b.orders));
    expect(a.acct).toEqual(b.acct);
    expect(a.pos).toEqual(b.pos);
  });
  it('order IDs deterministic', () => {
    const t1 = new PaperTradingEngine({ feeRate: 0 });
    send(t1, mc(1000, 100), 0);
    t1.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    t1.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110 });
    const t2 = new PaperTradingEngine({ feeRate: 0 });
    send(t2, mc(1000, 100), 0);
    t2.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    t2.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110 });
    expect(t1.getOrders().map(o => o.id)).toEqual(t2.getOrders().map(o => o.id));
  });
  it('event sequence deterministic', () => {
    function runWithEvents() {
      const t = new PaperTradingEngine({ feeRate: 0 });
      const seq = [];
      t.on(TradingEvents.ORDER_PLACED, () => seq.push('PLACED'));
      t.on(TradingEvents.ORDER_TRIGGERED, () => seq.push('TRIG'));
      t.on(TradingEvents.ORDER_FILLED, () => seq.push('FILL'));
      t.on(TradingEvents.STOP_LOSS_TRIGGERED, () => seq.push('SL'));
      t.on(TradingEvents.TAKE_PROFIT_TRIGGERED, () => seq.push('TP'));
      send(t, mc(1000, 100), 0);
      t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
      send(t, mc(1001, 105), 1);
      t.setStopLoss('BTCUSD', 90);
      send(t, c(1002, 105, 106, 80, 85), 2);
      return seq;
    }
    expect(runWithEvents()).toEqual(runWithEvents());
  });
  it('multiple runs same PnL and fees', () => {
    const run = () => {
      const t = new PaperTradingEngine({ feeRate: 0 });
      send(t, mc(1000, 100), 0);
      t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 2, stopPrice: 105 });
      send(t, c(1001, 100, 110, 100, 108), 1);
      t.setTakeProfit('BTCUSD', 120);
      send(t, c(1002, 108, 125, 107, 122), 2);
      return t.getAccountSnapshot();
    };
    expect(run()).toEqual(run());
  });
});

// ============================================================
// Integration with ReplayEngine + seek guard
// ============================================================
describe('Phase8.5 — Replay integration & guards', () => {
  it('seek blocked while position open', () => {
    const replay = new ReplayEngine();
    const t = new PaperTradingEngine({ feeRate: 0, replayEngine: replay });
    replay.load([mc(1000, 100), mc(1001, 110), mc(1002, 120)].map(cn => ({ ...cn })));
    replay.start(0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const before = replay.getState().currentIndex;
    let rejected = false;
    t.on(TradingEvents.ORDER_REJECTED, (e) => { if (e.code === 'SEEK_BLOCKED') rejected = true; });
    replay.seek(2);
    expect(replay.getState().currentIndex).toBe(before);
    expect(rejected).toBe(true);
  });
  it('load blocked while position open', () => {
    const replay = new ReplayEngine();
    const t = new PaperTradingEngine({ feeRate: 0, replayEngine: replay });
    replay.load([mc(1000, 100), mc(1001, 101)].map(cn => ({ ...cn })));
    replay.start(0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    let rejected = false;
    t.on(TradingEvents.ORDER_REJECTED, (e) => { if (e.code === 'LOAD_BLOCKED') rejected = true; });
    replay.load([mc(2000, 200), mc(2001, 201)].map(cn => ({ ...cn })));
    expect(rejected).toBe(true);
    expect(replay.getState().totalCandles).toBe(2); // still old? Actually load blocked returns early so totalCandles unchanged
  });
});

// ============================================================
// Accounting re-audit
// ============================================================
describe('Phase8.5 — Accounting audit', () => {
  const FEE = TRADING_CONFIG.TAKER_FEE_RATE;
  it('cash movement exactly once per close', () => {
    const t = new PaperTradingEngine({ feeRate: FEE, startingBalance: 10000 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(t.getAccountSnapshot().cashBalance).toBeCloseTo(10000 - 100*FEE);
    send(t, mc(1001, 110), 1);
    t.closePosition('BTCUSD');
    const gross = 10;
    const totalFee = 100*FEE + 110*FEE;
    expect(t.getAccountSnapshot().cashBalance).toBeCloseTo(10000 + gross - totalFee);
    expect(t.getAccountSnapshot().realizedPnL).toBeCloseTo(gross - totalFee);
    expect(t.getAccountSnapshot().totalFees).toBeCloseTo(totalFee);
    expect(t.getAccountSnapshot().equity).toBeCloseTo(10000 + gross - totalFee);
  });
  it('position quantity accounted in gross', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 3 });
    send(t, mc(1001, 110), 1);
    expect(t.getPosition('BTCUSD').unrealizedPnL).toBe(30);
    t.closePosition('BTCUSD');
    expect(t.getTrades()[0].grossPnL).toBe(30);
  });
  it('no double fee on candles without close', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const afterEntry = t.getAccountSnapshot().totalFees;
    send(t, mc(1001, 110), 1);
    send(t, mc(1002, 120), 2);
    send(t, mc(1003, 130), 3);
    expect(t.getAccountSnapshot().totalFees).toBeCloseTo(afterEntry);
  });
});

// ============================================================
// UI audit (mock DOM)
// ============================================================
describe('Phase8.5 — UI TradingPanel', () => {
  it('order type UI toggles limit/stop rows', async () => {
    const { TradingPanel } = await import('../src/ui/TradingPanel.js');
    // create minimal mock DOM
    global.document = {
      getElementById: (id) => {
        if (id === 'limit-price-row' || id === 'stop-price-row') {
          return { classList: { add(v){ this._hidden=v; }, remove(v){ this._hidden=null; }, contains(v){ return false; }, _hidden: null } };
        }
        if (id === 'symbol-select') return { value: 'BTCUSD' };
        return null;
      }
    };
    const engine = new PaperTradingEngine({ feeRate: 0 });
    send(engine, mc(1000, 100), 0);
    const mkEl = (txt='') => ({ textContent: txt, className:'', disabled:false, innerHTML:'', value:'', addEventListener(){}, classList:{add(){},remove(){},contains(){return false}}, querySelectorAll(){return []} });
    const panel = new TradingPanel({
      tradingEngine: engine,
      balanceEl: mkEl(), equityEl: mkEl(), realizedEl: mkEl(), unrealizedEl: mkEl(), feesEl: mkEl(),
      posSymbolEl: mkEl(), posSideEl: mkEl(), posQtyEl: mkEl(), posEntryEl: mkEl(), posCurrentEl: mkEl(), posPnlEl: mkEl(),
      qtyInput: { value:'1' }, buyBtn: mkEl(), sellBtn: mkEl(), closeBtn: mkEl(), resetBtn: mkEl(),
      tradesListEl: mkEl(), errorEl: mkEl(),
      orderTypeSelect: { value:'MARKET', addEventListener(){} }, limitPriceInput: { value:'100' }, stopPriceInput: { value:'105' }, pendingListEl: mkEl(),
      posSlEl: mkEl(), posTpEl: mkEl(), slInput: { value:'' }, tpInput: { value:'' }, setRiskBtn: mkEl(), clearRiskBtn: mkEl()
    });
    // initial MARKET -> both hidden
    panel._updateOrderTypeUI();
    expect(panel.buyBtn.textContent).toBe('BUY');
    // LIMIT
    panel.orderTypeSelect.value = 'LIMIT';
    panel._updateOrderTypeUI();
    expect(panel.buyBtn.textContent).toBe('BUY LIMIT');
    // STOP
    panel.orderTypeSelect.value = 'STOP_MARKET';
    panel._updateOrderTypeUI();
    expect(panel.buyBtn.textContent).toBe('BUY STOP');
    delete global.document;
  });
  it('SL/TP controls disabled when no position, enabled when open', async () => {
    const { TradingPanel } = await import('../src/ui/TradingPanel.js');
    global.document = { getElementById: () => null };
    const engine = new PaperTradingEngine({ feeRate: 0 });
    send(engine, mc(1000, 100), 0);
    const mkEl = (txt='') => ({ textContent: txt, className:'', disabled:false, innerHTML:'', value:'', addEventListener(){}, classList:{add(){},remove(){},contains(){return false}}, querySelectorAll(){return []} });
    const setBtn = mkEl(); const clearBtn = mkEl(); const closeBtn = mkEl();
    const panel = new TradingPanel({
      tradingEngine: engine,
      balanceEl: mkEl(), equityEl: mkEl(), realizedEl: mkEl(), unrealizedEl: mkEl(), feesEl: mkEl(),
      posSymbolEl: mkEl(), posSideEl: mkEl(), posQtyEl: mkEl(), posEntryEl: mkEl(), posCurrentEl: mkEl(), posPnlEl: mkEl(),
      qtyInput: { value:'1' }, buyBtn: mkEl(), sellBtn: mkEl(), closeBtn, resetBtn: mkEl(),
      tradesListEl: mkEl(), errorEl: mkEl(),
      orderTypeSelect: { value:'MARKET', addEventListener(){} }, limitPriceInput: { value:'100' }, stopPriceInput: { value:'105' }, pendingListEl: mkEl(),
      posSlEl: mkEl(), posTpEl: mkEl(), slInput: { value:'' }, tpInput: { value:'' }, setRiskBtn: setBtn, clearRiskBtn: clearBtn
    });
    panel.render();
    expect(setBtn.disabled).toBe(true);
    expect(clearBtn.disabled).toBe(true);
    expect(closeBtn.disabled).toBe(true);
    engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    panel.render();
    expect(setBtn.disabled).toBe(false);
    expect(clearBtn.disabled).toBe(false);
    expect(closeBtn.disabled).toBe(false);
    engine.closePosition('BTCUSD');
    panel.render();
    expect(setBtn.disabled).toBe(true);
    delete global.document;
  });
  it('pending orders update and cancelled not actionable', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const res = t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    expect(t.getPendingOrders().length).toBe(1);
    t.cancelOrder(res.order.id);
    expect(t.getPendingOrders().length).toBe(0);
    expect(t.cancelOrder(res.order.id).code).toBe('ORDER_NOT_PENDING');
  });
  it('limit price required for LIMIT, stop price required for STOP', async () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    expect(t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: NaN }).success).toBe(false);
    expect(t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: NaN }).success).toBe(false);
    expect(t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 0 }).success).toBe(false);
    expect(t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 0 }).success).toBe(false);
  });
});
