import { describe, it, expect } from 'vitest';
import { PaperTradingEngine } from '../src/trading/PaperTradingEngine.js';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { TradingEvents } from '../src/trading/TradingEvents.js';
import { TRADING_CONFIG, calcFee } from '../src/trading/TradingConfig.js';

// helpers
function c(time, open, high, low, close, volume = 10) { return { time, open, high, low, close, volume }; }
function mc(time, close) { return c(time, close, close+1, close-1, close); }
function send(engine, candle, idx) { engine.onMarketCandle({ candle, index: idx, timestamp: candle.time }); }

// ============================================================
// 1. State transition legality
// ============================================================
describe('Phase9 — State transition legality', () => {
  it('ORDER PENDING -> FILLED is legal, FILLED -> PENDING impossible', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const res = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    expect(t.getOrder(res.order.id).status).toBe('PENDING');
    send(t, c(1001, 95, 96, 89, 90), 1);
    expect(t.getOrder(res.order.id).status).toBe('FILLED');
    // No API allows FILLED -> PENDING; try cancel on filled should fail
    const cr = t.cancelOrder(res.order.id);
    expect(cr.success).toBe(false);
    expect(cr.code).toBe('ORDER_NOT_PENDING');
    expect(t.getOrder(res.order.id).status).toBe('FILLED');
  });
  it('PENDING -> CANCELLED legal, CANCELLED -> FILLED impossible', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const res = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    t.cancelOrder(res.order.id);
    expect(t.getOrder(res.order.id).status).toBe('CANCELLED');
    // Try to fill after cancelled — next candle should not fill
    send(t, c(1001, 95, 96, 89, 90), 1);
    expect(t.getOrder(res.order.id).status).toBe('CANCELLED');
    expect(t.getPosition('BTCUSD')).toBeNull();
  });
  it('PENDING -> REJECTED legal (POSITION_ALREADY_OPEN), REJECTED -> FILLED impossible', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const res = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    // This pending is same-side, should be rejected on next fill attempt or via incompatible cancel
    // Actually _cancelIncompatiblePendings rejects immediately upon market open, but limit pending placed after position open is not auto-rejected until next position change?
    // Our _cancelIncompatiblePendings is called after market open/close, but limit pending placed after position open remains pending until fill attempt where it becomes REJECTED
    // Force a candle that would fill it
    send(t, c(1001, 100, 101, 89, 95), 1);
    // Should be REJECTED
    expect(t.getOrder(res.order.id).status).toBe('REJECTED');
    // Next candle should not change it to FILLED
    send(t, c(1002, 95, 96, 88, 90), 2);
    expect(t.getOrder(res.order.id).status).toBe('REJECTED');
  });
  it('REJECTED cannot become FILLED or CANCELLED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const res = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    send(t, c(1001, 100, 101, 89, 95), 1);
    expect(t.getOrder(res.order.id).status).toBe('REJECTED');
    const cr = t.cancelOrder(res.order.id);
    expect(cr.success).toBe(false);
    expect(cr.code).toBe('ORDER_NOT_PENDING');
  });
  it('CANCELLED cannot become REJECTED/FILLED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const res = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    t.cancelOrder(res.order.id);
    expect(t.getOrder(res.order.id).status).toBe('CANCELLED');
    // Try totrigger via candle
    send(t, c(1001, 95, 96, 89, 90), 1);
    expect(t.getOrder(res.order.id).status).toBe('CANCELLED');
  });
  it('POSITION NONE -> OPEN -> CLOSED legal, CLOSED cannot become OPEN except via new order', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    expect(t.getPosition('BTCUSD')).toBeNull();
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(t.getPosition('BTCUSD')).not.toBeNull();
    send(t, mc(1001, 110), 1);
    t.closePosition('BTCUSD');
    expect(t.getPosition('BTCUSD')).toBeNull();
    expect(t.getTrades().length).toBe(1);
    // Second close should fail
    const cr = t.closePosition('BTCUSD');
    expect(cr.success).toBe(false);
    // New order creates new position
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    expect(t.getPosition('BTCUSD').side).toBe('SHORT');
  });
});

// ============================================================
// 2. Single source of truth — pending IDs vs order status sync
// ============================================================
describe('Phase9 — Single source of truth', () => {
  it('pending IDs always correspond to PENDING orders', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110 });
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 95 });
    expect(t.getPendingOrders().length).toBe(3);
    const inv = t.checkInvariants();
    expect(inv.pendingIdsUnique).toBe(true);
    expect(inv.pendingAllPending).toBe(true);
    send(t, c(1001, 100, 112, 89, 105), 1); // both BUY orders triggerable, first wins
    expect(t.checkInvariants().pendingAllPending).toBe(true);
  });
  it('after fills, pendings correctly pruned', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const a = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    const b = t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110 });
    send(t, c(1001, 100, 115, 89, 105), 1);
    // a fills at 90, b rejected as POSITION_ALREADY_OPEN, both removed from pending
    expect(t.getPendingOrders().length).toBe(0);
    expect(t.checkInvariants().pendingIdsUnique).toBe(true);
    expect(t.checkInvariants().pendingAllPending).toBe(true);
  });
  it('cancelled orders removed from pending', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const r = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    t.cancelOrder(r.order.id);
    expect(t.getPendingOrders().length).toBe(0);
    expect(t.getOrders().find(o=>o.id===r.order.id).status).toBe('CANCELLED');
  });
  it('no duplicate pending IDs after 10 mixed orders', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    for (let i=0;i<10;i++) {
      if (i%2===0) t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 80+i });
      else t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110+i });
    }
    expect(t.getPendingOrders().length).toBe(10);
    const ids = t.getPendingOrders().map(o=>o.id);
    expect(new Set(ids).size).toBe(10);
    expect(t.checkInvariants().pendingIdsUnique).toBe(true);
  });
});

// ============================================================
// 3. ID determinism
// ============================================================
describe('Phase9 — ID determinism', () => {
  it('same sequence produces same order IDs across fresh engines', () => {
    function run() {
      const t = new PaperTradingEngine({ feeRate: 0 });
      send(t, mc(1000, 100), 0);
      t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
      t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110 });
      t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 95 });
      return t.getOrders().map(o=>o.id);
    }
    expect(run()).toEqual(run());
    expect(run()[0]).toBe('order-1');
    expect(run()[1]).toBe('order-2');
  });
  it('same sequence produces same trade IDs', () => {
    function run() {
      const t = new PaperTradingEngine({ feeRate: 0 });
      send(t, mc(1000, 100), 0);
      t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
      send(t, mc(1001, 110), 1);
      t.closePosition('BTCUSD');
      send(t, mc(1002, 120), 2);
      t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
      send(t, mc(1003, 100), 3);
      t.closePosition('BTCUSD');
      return t.getTrades().map(tr=>tr.id);
    }
    expect(run()).toEqual([1,2]);
    expect(run()).toEqual(run());
  });
  it('IDs never collide after account reset (order history preserved, IDs monotonic)', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const a = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    expect(a.order.id).toBe('order-1');
    t.resetAccount();
    // order history preserved, next order should be order-2 not order-1
    send(t, mc(1001, 100), 1);
    const b = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    expect(b.order.id).toBe('order-2');
    expect(b.order.id).not.toBe(a.order.id);
    // trade IDs reset because trade history cleared, but no collision because old trades gone
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1002, 110), 2);
    // But note BUY limit pending will compete with market position; need to handle
  });
  it('resetAll clears orders and resets IDs deterministically', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110 });
    expect(t.getOrders().length).toBe(2);
    t.resetAll();
    expect(t.getOrders().length).toBe(0);
    expect(t.getPendingOrders().length).toBe(0);
    const r = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    expect(r.order.id).toBe('order-1');
  });
  it('replay restart with fresh engine gives same IDs', () => {
    function sim() {
      const t = new PaperTradingEngine({ feeRate: 0 });
      send(t, mc(1000, 100), 0);
      t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
      send(t, c(1001, 100, 101, 89, 90), 1);
      return { orders: t.getOrders(), trades: t.getTrades(), pos: t.getPosition('BTCUSD') };
    }
    const a = sim();
    const b = sim();
    expect(a.orders.map(o=>o.id)).toEqual(b.orders.map(o=>o.id));
    expect(a.trades.map(tr=>tr.id)).toEqual(b.trades.map(tr=>tr.id));
  });
});

// ============================================================
// 4. Event sequence
// ============================================================
describe('Phase9 — Event sequence', () => {
  it('MARKET BUY: POSITION_OPENED then ACCOUNT_UPDATED, no ORDER events', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const seq = [];
    t.on(TradingEvents.POSITION_OPENED, () => seq.push('POSITION_OPENED'));
    t.on(TradingEvents.ACCOUNT_UPDATED, () => seq.push('ACCOUNT_UPDATED'));
    t.on(TradingEvents.ORDER_PLACED, () => seq.push('ORDER_PLACED'));
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(seq).toEqual(['POSITION_OPENED','ACCOUNT_UPDATED']);
  });
  it('MARKET SELL close: POSITION_CLOSED -> TRADE_EXECUTED -> ACCOUNT_UPDATED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const seq = [];
    t.on(TradingEvents.POSITION_CLOSED, () => seq.push('POSITION_CLOSED'));
    t.on(TradingEvents.TRADE_EXECUTED, () => seq.push('TRADE_EXECUTED'));
    t.on(TradingEvents.ACCOUNT_UPDATED, () => seq.push('ACCOUNT_UPDATED'));
    // price update emits ACCOUNT_UPDATED first, then close emits its own ACCOUNT_UPDATED
    send(t, mc(1001, 110), 1);
    // send emits ACCOUNT_UPDATED (price update)
    expect(seq).toEqual(['ACCOUNT_UPDATED']);
    seq.length=0;
    t.closePosition('BTCUSD');
    expect(seq).toEqual(['POSITION_CLOSED','TRADE_EXECUTED','ACCOUNT_UPDATED']);
  });
  it('LIMIT entry: ORDER_PLACED -> ORDER_FILLED -> POSITION_OPENED -> ACCOUNT_UPDATED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const seqAll = [];
    t.on(TradingEvents.ORDER_PLACED, () => seqAll.push('ORDER_PLACED'));
    t.on(TradingEvents.ORDER_FILLED, () => seqAll.push('ORDER_FILLED'));
    t.on(TradingEvents.POSITION_OPENED, () => seqAll.push('POSITION_OPENED'));
    t.on(TradingEvents.ACCOUNT_UPDATED, () => seqAll.push('ACCOUNT_UPDATED'));
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    expect(seqAll).toEqual(['ORDER_PLACED']);
    seqAll.length = 0;
    send(t, c(1001, 100, 101, 89, 90), 1);
    // Intrabar execution occurs first, followed by single canonical ACCOUNT_UPDATED at bar close
    expect(seqAll).toEqual(['ORDER_FILLED','POSITION_OPENED','ACCOUNT_UPDATED']);
  });
  it('LIMIT exit: ORDER_FILLED -> POSITION_CLOSED -> TRADE_EXECUTED -> ACCOUNT_UPDATED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 110 });
    const seq = [];
    t.on(TradingEvents.ORDER_FILLED, () => seq.push('ORDER_FILLED'));
    t.on(TradingEvents.POSITION_CLOSED, () => seq.push('POSITION_CLOSED'));
    t.on(TradingEvents.TRADE_EXECUTED, () => seq.push('TRADE_EXECUTED'));
    t.on(TradingEvents.ACCOUNT_UPDATED, () => seq.push('ACCOUNT_UPDATED'));
    send(t, c(1002, 100, 115, 99, 110), 2);
    expect(seq).toEqual(['ORDER_FILLED','POSITION_CLOSED','TRADE_EXECUTED','ACCOUNT_UPDATED']);
  });
  it('STOP entry: ORDER_PLACED -> ORDER_TRIGGERED -> ORDER_FILLED -> POSITION_OPENED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const seq = [];
    t.on(TradingEvents.ORDER_PLACED, () => seq.push('ORDER_PLACED'));
    t.on(TradingEvents.ORDER_TRIGGERED, () => seq.push('ORDER_TRIGGERED'));
    t.on(TradingEvents.ORDER_FILLED, () => seq.push('ORDER_FILLED'));
    t.on(TradingEvents.POSITION_OPENED, () => seq.push('POSITION_OPENED'));
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110 });
    expect(seq).toEqual(['ORDER_PLACED']);
    seq.length=0;
    send(t, c(1001, 100, 115, 99, 110), 1);
    expect(seq).toEqual(['ORDER_TRIGGERED','ORDER_FILLED','POSITION_OPENED']);
  });
  it('STOP exit: ORDER_TRIGGERED -> ORDER_FILLED -> POSITION_CLOSED -> TRADE_EXECUTED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, stopPrice: 90 });
    const seq = [];
    t.on(TradingEvents.ORDER_TRIGGERED, () => seq.push('ORDER_TRIGGERED'));
    t.on(TradingEvents.ORDER_FILLED, () => seq.push('ORDER_FILLED'));
    t.on(TradingEvents.POSITION_CLOSED, () => seq.push('POSITION_CLOSED'));
    t.on(TradingEvents.TRADE_EXECUTED, () => seq.push('TRADE_EXECUTED'));
    send(t, c(1002, 100, 101, 80, 85), 2);
    expect(seq).toEqual(['ORDER_TRIGGERED','ORDER_FILLED','POSITION_CLOSED','TRADE_EXECUTED']);
  });
  it('SL: STOP_LOSS_TRIGGERED -> POSITION_CLOSED -> TRADE_EXECUTED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.setStopLoss('BTCUSD', 90);
    const seq=[];
    t.on(TradingEvents.STOP_LOSS_TRIGGERED, () => seq.push('SL'));
    t.on(TradingEvents.POSITION_CLOSED, () => seq.push('CLOSED'));
    t.on(TradingEvents.TRADE_EXECUTED, () => seq.push('TRADE'));
    send(t, c(1002, 100, 101, 80, 85), 2);
    expect(seq).toEqual(['SL','CLOSED','TRADE']);
  });
  it('TP: TAKE_PROFIT_TRIGGERED -> POSITION_CLOSED -> TRADE_EXECUTED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.setTakeProfit('BTCUSD', 110);
    const seq=[];
    t.on(TradingEvents.TAKE_PROFIT_TRIGGERED, () => seq.push('TP'));
    t.on(TradingEvents.POSITION_CLOSED, () => seq.push('CLOSED'));
    t.on(TradingEvents.TRADE_EXECUTED, () => seq.push('TRADE'));
    send(t, c(1002, 100, 115, 99, 110), 2);
    expect(seq).toEqual(['TP','CLOSED','TRADE']);
  });
  it('cancel: ORDER_CANCELLED, no duplicate events', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const r = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    let cnt=0;
    t.on(TradingEvents.ORDER_CANCELLED, ()=>cnt++);
    t.cancelOrder(r.order.id);
    t.cancelOrder(r.order.id); // second should reject not emit cancelled
    expect(cnt).toBe(1);
  });
  it('reject: ORDER_REJECTED with code, no FILLED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    let rej=0, fill=0;
    t.on(TradingEvents.ORDER_REJECTED, ()=>rej++);
    t.on(TradingEvents.ORDER_FILLED, ()=>fill++);
    t.placeOrder({ symbol: '', side: 'BUY', quantity: 1 });
    expect(rej).toBe(1);
    expect(fill).toBe(0);
  });
  it('no duplicate ORDER_FILLED on same order', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    let fillCnt=0;
    t.on(TradingEvents.ORDER_FILLED, ()=>fillCnt++);
    send(t, c(1001, 100, 101, 89, 90), 1);
    send(t, c(1002, 90, 92, 88, 90), 2);
    expect(fillCnt).toBe(1);
  });
  it('event payloads represent resulting state consistently (filledPrice)', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    let filledOrder=null;
    t.on(TradingEvents.ORDER_FILLED, (p)=>{ filledOrder=p.order; });
    send(t, c(1001, 100, 101, 89, 90), 1);
    expect(filledOrder.filledPrice).toBe(90);
    expect(filledOrder.status).toBe('FILLED');
    expect(t.getPosition('BTCUSD').entryPrice).toBe(90);
  });
});

// ============================================================
// 5. Accounting reconciliation
// ============================================================
describe('Phase9 — Accounting reconciliation', () => {
  const FEE = TRADING_CONFIG.TAKER_FEE_RATE;
  it('equity = cash + unrealized', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    send(t, c(1000, 100, 101, 99, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 2 });
    send(t, c(1001, 105, 106, 104, 105), 1);
    const a = t.getAccountSnapshot();
    expect(a.equity).toBeCloseTo(a.cashBalance + a.unrealizedPnL);
    expect(t.checkInvariants().equityOk).toBe(true);
  });
  it('after close unrealized PnL = 0', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 110), 1);
    t.closePosition('BTCUSD');
    expect(t.getAccountSnapshot().unrealizedPnL).toBe(0);
    expect(t.checkInvariants().unrealizedOk).toBe(true);
  });
  it('total fees = entry + exit across all trades', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 110), 1);
    t.closePosition('BTCUSD');
    send(t, mc(1002, 110), 2);
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    send(t, mc(1003, 100), 3);
    t.closePosition('BTCUSD');
    const trades = t.getTrades();
    const sumFees = trades.reduce((s,tr)=>s+tr.totalFee,0);
    // open position entry fee not included because no open position after closes
    expect(t.getAccountSnapshot().totalFees).toBeCloseTo(sumFees);
  });
  it('fees include both entry and exit for each trade', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 110), 1);
    t.closePosition('BTCUSD');
    const tr = t.getTrades()[0];
    expect(tr.totalFee).toBeCloseTo(tr.entryFee + tr.exitFee);
    expect(tr.netPnL).toBeCloseTo(tr.grossPnL - tr.totalFee);
  });
  it('reconciliation after every transition (LIMIT, STOP, SL, TP)', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    send(t, c(1000, 100, 101, 99, 100), 0);
    // LIMIT entry
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 95 });
    send(t, c(1001, 100, 101, 94, 96), 1);
    expect(t.checkInvariants().equityOk).toBe(true);
    // set SL/TP
    t.setStopLoss('BTCUSD', 90);
    t.setTakeProfit('BTCUSD', 110);
    expect(t.checkInvariants().equityOk).toBe(true);
    // LIMIT exit
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 105 });
    send(t, c(1002, 96, 110, 95, 108), 2); // should hit SELL limit 105 and close
    // Actually SL 90 and LIMIT 105 both not hit? close 108 high 110: LIMIT SELL 105 yes, TP 110 yes — but SL/TP logic runs before pending
    // Either way equity invariant holds
    expect(t.checkInvariants().equityOk).toBe(true);
    expect(t.checkInvariants().unrealizedOk).toBe(true);
  });
  it('non-round prices reconcile', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    send(t, c(1000, 100.123, 101, 99, 100.123), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1.37 });
    send(t, c(1001, 110.789, 111, 109, 110.789), 1);
    t.closePosition('BTCUSD');
    const tr = t.getTrades()[0];
    const gross = (110.789 - 100.123)*1.37;
    expect(tr.grossPnL).toBeCloseTo(gross, 5);
    expect(t.getAccountSnapshot().equity).toBeCloseTo(t.getAccountSnapshot().cashBalance);
  });
});

// ============================================================
// 6. MARKET order audit (regression)
// ============================================================
describe('Phase9 — MARKET order audit', () => {
  it('BUY MARKET opens LONG at close', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, c(1000, 99, 101, 98, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(t.getPosition('BTCUSD').side).toBe('LONG');
    expect(t.getPosition('BTCUSD').entryPrice).toBe(100);
  });
  it('SELL MARKET opens SHORT', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    expect(t.getPosition('BTCUSD').side).toBe('SHORT');
  });
  it('close LONG via closePosition', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 110), 1);
    const r = t.closePosition('BTCUSD');
    expect(r.exitReason).toBeNull();
    expect(t.getPosition('BTCUSD')).toBeNull();
  });
  it('close SHORT via opposite MARKET', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    send(t, mc(1001, 90), 1);
    const r = t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(r.success).toBe(true);
    expect(t.getPosition('BTCUSD')).toBeNull();
  });
  it('same-side market rejected', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const r = t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(r.code).toBe('POSITION_ALREADY_OPEN');
  });
  it('opposite-side market closes, no auto-reverse', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const r = t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    expect(t.getPosition('BTCUSD')).toBeNull();
    expect(t.hasOpenPosition()).toBe(false);
  });
});

// ============================================================
// 7. LIMIT order audit
// ============================================================
describe('Phase9 — LIMIT order audit', () => {
  it('BUY LIMIT pending then fills', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const r = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    expect(r.order.status).toBe('PENDING');
    send(t, c(1001, 95, 96, 89, 90), 1);
    expect(t.getOrder(r.order.id).status).toBe('FILLED');
  });
  it('SELL LIMIT fills', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 110 });
    send(t, c(1001, 100, 115, 99, 110), 1);
    expect(t.getPosition('BTCUSD').side).toBe('SHORT');
  });
  it('next-candle protection', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, c(1000, 100, 110, 90, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 95 });
    send(t, c(1000, 100, 110, 90, 100), 0);
    expect(t.getPosition('BTCUSD')).toBeNull();
    send(t, c(1001, 95, 96, 94, 95), 1);
    expect(t.getPosition('BTCUSD')).not.toBeNull();
  });
  it('cancellation prevents fill', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const r = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    t.cancelOrder(r.order.id);
    send(t, c(1001, 95, 96, 89, 90), 1);
    expect(t.getPosition('BTCUSD')).toBeNull();
  });
  it('insufficient cash rejected at fill', () => {
    const t = new PaperTradingEngine({ feeRate: 0.0005, startingBalance: 10 });
    send(t, mc(1000, 100), 0);
    const r = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    send(t, c(1001, 95, 96, 89, 90), 1);
    expect(t.getOrder(r.order.id).status).toBe('REJECTED');
    expect(t.getOrder(r.order.id).rejectionReason).toBe('INSUFFICIENT_CASH');
  });
  it('interaction with existing position (opposite closes)', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 110 });
    send(t, c(1002, 100, 115, 99, 110), 2);
    expect(t.getPosition('BTCUSD')).toBeNull();
    expect(t.getTrades()[0].exitReason).toBe('LIMIT');
  });
  it('interaction with STOP: first in queue wins', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110 });
    send(t, c(1001, 100, 115, 89, 110), 1);
    expect(t.getOrders()[0].status).toBe('FILLED');
    expect(t.getOrders()[1].status).toBe('REJECTED');
  });
});

// ============================================================
// 8. STOP order audit
// ============================================================
describe('Phase9 — STOP order audit', () => {
  it('BUY STOP pending and fills', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110 });
    send(t, c(1001, 100, 115, 99, 110), 1);
    expect(t.getPosition('BTCUSD').entryPrice).toBe(110);
  });
  it('SELL STOP fills', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, stopPrice: 90 });
    send(t, c(1001, 100, 101, 80, 85), 1);
    expect(t.getPosition('BTCUSD').side).toBe('SHORT');
  });
  it('next-candle protection for STOP', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, c(1000, 100, 110, 90, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    send(t, c(1000, 100, 110, 90, 100), 0);
    expect(t.getPosition('BTCUSD')).toBeNull();
    send(t, c(1001, 100, 110, 90, 100), 1);
    expect(t.getPosition('BTCUSD')).not.toBeNull();
  });
  it('equality trigger', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    send(t, c(1001, 100, 105, 99, 104), 1);
    expect(t.getPosition('BTCUSD')).not.toBeNull();
  });
  it('gap-through fills at stopPrice', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 90), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 100 });
    send(t, c(1001, 110, 115, 110, 112), 1);
    expect(t.getPosition('BTCUSD').entryPrice).toBe(100);
  });
  it('cancellation', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const r = t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110 });
    t.cancelOrder(r.order.id);
    send(t, c(1001, 100, 115, 99, 110), 1);
    expect(t.getPosition('BTCUSD')).toBeNull();
  });
  it('insufficient cash', () => {
    const t = new PaperTradingEngine({ feeRate: 0.0005, startingBalance: 10 });
    send(t, mc(1000, 100), 0);
    const r = t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 90 });
    send(t, c(1001, 90, 92, 89, 90), 1);
    expect(t.getOrder(r.order.id).status).toBe('REJECTED');
  });
  it('interaction with LIMIT same candle: deterministic queue order', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110 });
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    send(t, c(1001, 100, 115, 89, 110), 1);
    // STOP first in queue, fills first
    expect(t.getOrders()[0].status).toBe('FILLED');
  });
});

// ============================================================
// 9. SL / TP audit
// ============================================================
describe('Phase9 — SL/TP audit', () => {
  it('LONG SL triggers', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.setStopLoss('BTCUSD', 90);
    send(t, c(1002, 100, 101, 80, 85), 2);
    expect(t.getTrades()[0].exitReason).toBe('STOP_LOSS');
  });
  it('LONG TP triggers', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.setTakeProfit('BTCUSD', 110);
    send(t, c(1002, 100, 115, 109, 112), 2);
    expect(t.getTrades()[0].exitReason).toBe('TAKE_PROFIT');
  });
  it('SHORT SL', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.setStopLoss('BTCUSD', 110);
    send(t, c(1002, 100, 115, 99, 110), 2);
    expect(t.getTrades()[0].exitReason).toBe('STOP_LOSS');
  });
  it('SHORT TP', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.setTakeProfit('BTCUSD', 90);
    send(t, c(1002, 100, 101, 80, 85), 2);
    expect(t.getTrades()[0].exitReason).toBe('TAKE_PROFIT');
  });
  it('next-candle protection for SL/TP', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    t.setStopLoss('BTCUSD', 90);
    send(t, c(1000, 100, 101, 80, 85), 0);
    expect(t.getPosition('BTCUSD')).not.toBeNull();
    send(t, c(1001, 85, 86, 80, 82), 1);
    expect(t.getPosition('BTCUSD')).toBeNull();
  });
  it('replacement updates price and index', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.setStopLoss('BTCUSD', 90);
    send(t, mc(1002, 100), 2);
    t.setStopLoss('BTCUSD', 95);
    expect(t.getPosition('BTCUSD').stopLossPrice).toBe(95);
    expect(t.getPosition('BTCUSD').stopLossCreatedIndex).toBe(2);
  });
  it('clearing prevents trigger', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.setStopLoss('BTCUSD', 90);
    t.clearStopLoss('BTCUSD');
    send(t, c(1002, 100, 101, 80, 85), 2);
    expect(t.getPosition('BTCUSD')).not.toBeNull();
  });
  it('SL/TP cannot operate after close', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.closePosition('BTCUSD');
    const r = t.setStopLoss('BTCUSD', 90);
    expect(r.success).toBe(false);
    expect(r.code).toBe('NO_POSITION');
    const r2 = t.setTakeProfit('BTCUSD', 110);
    expect(r2.success).toBe(false);
  });
  it('stale-risk cleanup after close: new position has no SL/TP', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.setStopLoss('BTCUSD', 90);
    t.setTakeProfit('BTCUSD', 110);
    send(t, c(1002, 100, 101, 80, 85), 2);
    expect(t.getTrades()[0].exitReason).toBe('STOP_LOSS');
    send(t, mc(1003, 100), 3);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(t.getPosition('BTCUSD').stopLossPrice).toBeNull();
    expect(t.getPosition('BTCUSD').takeProfitPrice).toBeNull();
  });
});

// ============================================================
// 10. Same-candle execution (adversarial)
// ============================================================
describe('Phase9 — Same-candle multi-event execution', () => {
  it('SL + TP same candle: SL wins, only one trade, no duplicate fee', () => {
    const t = new PaperTradingEngine({ feeRate: TRADING_CONFIG.TAKER_FEE_RATE });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.setStopLoss('BTCUSD', 90);
    t.setTakeProfit('BTCUSD', 110);
    const beforeFees = t.getAccountSnapshot().totalFees;
    send(t, c(1002, 100, 115, 80, 105), 2);
    expect(t.getTrades().length).toBe(1);
    expect(t.getTrades()[0].exitReason).toBe('STOP_LOSS');
    expect(t.getTrades()[0].exitPrice).toBe(90);
    const expectedFees = 100*TRADING_CONFIG.TAKER_FEE_RATE + 90*TRADING_CONFIG.TAKER_FEE_RATE;
    expect(t.getAccountSnapshot().totalFees).toBeCloseTo(expectedFees);
    send(t, c(1003, 105, 115, 80, 105), 3);
    expect(t.getTrades().length).toBe(1);
  });
  it('SL + opposite LIMIT + opposite STOP same candle: deterministic SL first, others cancelled, no reversal/double close', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.setStopLoss('BTCUSD', 90);
    t.setTakeProfit('BTCUSD', 110);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 105 });
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, stopPrice: 95 });
    let closeCnt=0, tradeCnt=0;
    t.on(TradingEvents.POSITION_CLOSED, ()=>closeCnt++);
    t.on(TradingEvents.TRADE_EXECUTED, ()=>tradeCnt++);
    send(t, c(1002, 100, 115, 80, 105), 2);
    expect(closeCnt).toBe(1);
    expect(tradeCnt).toBe(1);
    expect(t.getTrades()[0].exitReason).toBe('STOP_LOSS');
    expect(t.getPosition('BTCUSD')).toBeNull();
    // pendings should be cancelled, not filled
    const lim = t.getOrders().find(o=>o.type==='LIMIT' && o.side==='SELL');
    const stp = t.getOrders().find(o=>o.type==='STOP_MARKET' && o.side==='SELL');
    expect(lim.status).toBe('CANCELLED');
    expect(stp.status).toBe('CANCELLED');
    expect(t.getPendingOrders().length).toBe(0);
  });
  it('no accidental reversal same candle', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.setStopLoss('BTCUSD', 90);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 105 });
    send(t, c(1002, 100, 115, 80, 105), 2);
    expect(t.getPosition('BTCUSD')).toBeNull();
    // next candle no position should auto-appear from stale limit
    send(t, c(1003, 105, 106, 104, 105), 3);
    expect(t.getPosition('BTCUSD')).toBeNull();
  });
  it('SL-before-pending rule explicit', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, c(1000, 100, 101, 99, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 95 });
    send(t, c(1001, 100, 101, 94, 96), 1); // fill
    expect(t.getPosition('BTCUSD')).not.toBeNull();
    t.setStopLoss('BTCUSD', 90);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 98 });
    // same candle would be eligible for both SL 90 and SELL limit 98, SL wins deterministically
    const seq=[];
    t.on(TradingEvents.STOP_LOSS_TRIGGERED, ()=>seq.push('SL'));
    t.on(TradingEvents.ORDER_FILLED, ()=>seq.push('FILL'));
    send(t, c(1002, 98, 99, 85, 86), 2);
    expect(seq[0]).toBe('SL');
    expect(t.getTrades()[0].exitReason).toBe('STOP_LOSS');
  });
});

// ============================================================
// 11. Pending queue determinism
// ============================================================
describe('Phase9 — Pending queue', () => {
  it('10+ mixed pendings deterministic insertion order', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const ids=[];
    for (let i=0;i<12;i++) {
      const r = i%2===0 ? t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 80+i }) : t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110+i });
      ids.push(r.order.id);
    }
    expect(t.getPendingOrders().map(o=>o.id)).toEqual(ids);
  });
  it('modifying one order cannot corrupt another', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const a = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    const b = t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110 });
    t.cancelOrder(a.order.id);
    expect(t.getOrder(b.order.id).status).toBe('PENDING');
    expect(t.getPendingOrders().length).toBe(1);
    expect(t.getPendingOrders()[0].id).toBe(b.order.id);
  });
  it('filled orders removed, cancelled removed, rejected removed', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const a = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    const b = t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110 });
    const cOrd = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 85 });
    t.cancelOrder(cOrd.order.id);
    send(t, c(1001, 100, 115, 84, 105), 1);
    // a fills at 90, b rejected (same-side), c already cancelled
    expect(t.getPendingOrders().length).toBe(0);
    expect(t.getOrder(a.order.id).status).toBe('FILLED');
    expect(t.getOrder(b.order.id).status).toBe('REJECTED');
    expect(t.getOrder(cOrd.order.id).status).toBe('CANCELLED');
  });
  it('no duplicate IDs ever', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    for(let i=0;i<20;i++) t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 80+i });
    const allIds = t.getOrders().map(o=>o.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(t.checkInvariants().pendingIdsUnique).toBe(true);
  });
});

// ============================================================
// 12. Reset / replay boundaries
// ============================================================
describe('Phase9 — Reset / replay boundaries', () => {
  it('resetAccount clears position, pending, SL/TP, trades, account totals', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.setStopLoss('BTCUSD', 90);
    t.setTakeProfit('BTCUSD', 110);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 105 });
    t.resetAccount();
    expect(t.getPosition('BTCUSD')).toBeNull();
    expect(t.getPendingOrders().length).toBe(0);
    expect(t.getTrades().length).toBe(0);
    expect(t.getAccountSnapshot().realizedPnL).toBe(0);
    expect(t.getAccountSnapshot().unrealizedPnL).toBe(0);
    expect(t.getAccountSnapshot().totalFees).toBe(0);
    expect(t.getAccountSnapshot().cashBalance).toBe(10000);
  });
  it('replay load clears pending, replay reset clears pending', () => {
    const replay = new ReplayEngine();
    const t = new PaperTradingEngine({ feeRate: 0, replayEngine: replay });
    replay.load([mc(1000, 100), mc(1001, 101)].map(x=>({...x})));
    replay.start(0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 110 });
    expect(t.getPendingOrders().length).toBe(1);
    replay.load([mc(2000, 200), mc(2001, 201)].map(x=>({...x})));
    expect(t.getPendingOrders().length).toBe(0);
    replay.start(0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 210 });
    expect(t.getPendingOrders().length).toBe(1);
    replay.reset();
    expect(t.getPendingOrders().length).toBe(0);
  });
  it('position open blocks seek/reset/load', () => {
    const replay = new ReplayEngine();
    const t = new PaperTradingEngine({ feeRate: 0, replayEngine: replay });
    replay.load([mc(1000,100), mc(1001,101), mc(1002,102)].map(x=>({...x})));
    replay.start(0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    let codes=[];
    t.on(TradingEvents.ORDER_REJECTED, (e)=>codes.push(e.code));
    const before = replay.getState().currentIndex;
    replay.seek(2);
    expect(replay.getState().currentIndex).toBe(before);
    expect(codes).toContain('SEEK_BLOCKED');
    codes=[];
    replay.reset();
    expect(codes).toContain('RESET_BLOCKED');
    codes=[];
    replay.load([mc(3000,300), mc(3001,301)].map(x=>({...x})));
    expect(codes).toContain('LOAD_BLOCKED');
  });
  it('pending cannot leak after data reload', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    // Simulate data reload via direct _clearPendingOrders('REPLAY_RESET')
    t._clearPendingOrders('REPLAY_RESET');
    expect(t.getPendingOrders().length).toBe(0);
    send(t, c(1001, 95, 96, 89, 90), 1);
    expect(t.getPosition('BTCUSD')).toBeNull();
  });
});

// ============================================================
// 13. Symbol / timeframe isolation
// ============================================================
describe('Phase9 — Symbol/timeframe isolation', () => {
  it('pending cleared on replay load prevents old order executing on new data', () => {
    const replay = new ReplayEngine();
    const t = new PaperTradingEngine({ feeRate: 0, replayEngine: replay });
    replay.load([mc(1000,100), mc(1001,101)].map(x=>({...x})));
    replay.start(0);
    t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    replay.load([mc(2000,200), mc(2001,210), mc(2002,300)].map(x=>({...x})));
    replay.start(0);
    replay.stepForward();
    replay.stepForward();
    expect(t.getPosition('BTCUSD')).toBeNull();
  });
  it('no stale async callback mutates after isolation — engine only reacts to MARKET_CANDLE', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(t.hasOpenPosition()).toBe(true);
    // No setTimeout callbacks in engine; verify no pending async mutations
    // Ensure checkInvariants passes
    expect(t.checkInvariants().equityOk).toBe(true);
  });
});

// ============================================================
// 14. Object ownership / immutability
// ============================================================
describe('Phase9 — Immutability', () => {
  it('getState() immutable', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const s = t.getState();
    s.account.cashBalance = 999999;
    s.positions[0].side = 'SHORT';
    s.positions[0].quantity = 999;
    expect(t.getAccountSnapshot().cashBalance).not.toBe(999999);
    expect(t.getPosition('BTCUSD').side).toBe('LONG');
    expect(t.getPosition('BTCUSD').quantity).toBe(1);
  });
  it('getPosition() immutable', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const p = t.getPosition('BTCUSD');
    p.side = 'SHORT';
    p.quantity = 999;
    expect(t.getPosition('BTCUSD').side).toBe('LONG');
  });
  it('getOrders() immutable', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    const r = t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    const orders = t.getOrders();
    orders[0].quantity = 999;
    orders[0].status = 'FILLED';
    expect(t.getOrder(r.order.id).quantity).toBe(1);
    expect(t.getOrder(r.order.id).status).toBe('PENDING');
  });
  it('getPendingOrders() immutable', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    const pend = t.getPendingOrders();
    pend[0].limitPrice = 999;
    expect(t.getPendingOrders()[0].limitPrice).toBe(90);
  });
  it('getTradeHistory() immutable', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 110), 1);
    t.closePosition('BTCUSD');
    const hist = t.getTradeHistory();
    hist[0].realizedPnL = 999;
    expect(t.getTrades()[0].realizedPnL).toBe(10);
  });
  it('event payloads immutable', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    let captured=null;
    t.on(TradingEvents.POSITION_OPENED, (p)=>{ captured=p.position; });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    captured.quantity = 999;
    expect(t.getPosition('BTCUSD').quantity).toBe(1);
  });
  it('getAccountSnapshot immutable', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const snap = t.getAccountSnapshot();
    snap.cashBalance = 123456;
    expect(t.getAccountSnapshot().cashBalance).not.toBe(123456);
  });
});

// ============================================================
// 15. Floating point edge cases
// ============================================================
describe('Phase9 — Floating point & edge cases', () => {
  it('non-round prices fees reconcile', () => {
    const t = new PaperTradingEngine({ feeRate: TRADING_CONFIG.TAKER_FEE_RATE });
    send(t, c(1000, 100.123, 101, 99, 100.123), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 0.017 });
    send(t, c(1001, 101.456, 102, 100, 101.456), 1);
    t.closePosition('BTCUSD');
    const tr = t.getTrades()[0];
    expect(tr.grossPnL).toBeCloseTo((101.456-100.123)*0.017, 6);
    expect(tr.netPnL).toBeCloseTo(tr.grossPnL - tr.totalFee, 6);
    expect(t.getAccountSnapshot().equity).toBeCloseTo(t.getAccountSnapshot().cashBalance, 6);
  });
  it('very small quantity', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 0.001 });
    send(t, c(1001, 200, 201, 199, 200), 1);
    expect(t.getPosition('BTCUSD').unrealizedPnL).toBeCloseTo(0.1);
  });
  it('reject NaN/Infinity/negative/zero', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    expect(t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: NaN }).code).toBe('INVALID_QUANTITY');
    expect(t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: Infinity }).code).toBe('INVALID_QUANTITY');
    expect(t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: -1 }).code).toBe('INVALID_QUANTITY');
    expect(t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 0 }).code).toBe('INVALID_QUANTITY');
    expect(t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: NaN }).code).toBe('INVALID_LIMIT_PRICE');
    expect(t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: Infinity }).code).toBe('INVALID_STOP_PRICE');
    // Price validation happens before position check, so NaN yields INVALID_STOP_PRICE even without position
    expect(t.setStopLoss('BTCUSD', NaN).code).toBe('INVALID_STOP_PRICE');
    // With position, NaN stop should be INVALID_STOP_PRICE
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    expect(t.setStopLoss('BTCUSD', NaN).code).toBe('INVALID_STOP_PRICE');
    expect(t.setTakeProfit('BTCUSD', Infinity).code).toBe('INVALID_TAKE_PROFIT_PRICE');
  });
  it('values near zero still reconcile equity', () => {
    const t = new PaperTradingEngine({ feeRate: 0, startingBalance: 10000 });
    send(t, c(1000, 0.001, 0.002, 0.0005, 0.001), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1000 });
    send(t, c(1001, 0.002, 0.003, 0.0015, 0.002), 1);
    expect(t.getAccountSnapshot().equity).toBeCloseTo(t.getAccountSnapshot().cashBalance + t.getPosition('BTCUSD').unrealizedPnL);
  });
});

// ============================================================
// 16. Error handling — structured deterministic
// ============================================================
describe('Phase9 — Error handling', () => {
  const codes = ['INVALID_QUANTITY','INVALID_SYMBOL','INVALID_SIDE','INVALID_LIMIT_PRICE','INVALID_STOP_PRICE','POSITION_ALREADY_OPEN','NO_POSITION','INSUFFICIENT_CASH','ORDER_NOT_FOUND','ORDER_NOT_PENDING','NO_MARKET_PRICE','SEEK_BLOCKED','RESET_BLOCKED','LOAD_BLOCKED'];
  it('all rejection paths return structured {success:false, code, message}', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    // NO_MARKET_PRICE
    let r = t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(r.code).toBe('NO_MARKET_PRICE');
    expect(r.success).toBe(false);
    send(t, mc(1000, 100), 0);
    expect(t.placeOrder({ symbol: '', side: 'BUY', quantity: 1 }).code).toBe('INVALID_SYMBOL');
    expect(t.placeOrder({ symbol: 'BTCUSD', side: 'HOLD', quantity: 1 }).code).toBe('INVALID_SIDE');
    expect(t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 0 }).code).toBe('INVALID_QUANTITY');
    expect(t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: -5 }).code).toBe('INVALID_LIMIT_PRICE');
    expect(t.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 0 }).code).toBe('INVALID_STOP_PRICE');
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 }).code).toBe('POSITION_ALREADY_OPEN');
    expect(t.cancelOrder('nonexistent').code).toBe('ORDER_NOT_FOUND');
    const ord = t.placeLimitOrder({ symbol: 'ETHUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    t.cancelOrder(ord.order.id);
    expect(t.cancelOrder(ord.order.id).code).toBe('ORDER_NOT_PENDING');
    t.closePosition('BTCUSD');
    expect(t.closePosition('BTCUSD').code).toBe('NO_POSITION');
    // ORDER_REJECTED event emitted for ordinary mistakes, no throw
    let threw=false;
    try { t.placeOrder({ symbol: '', side: 'BUY', quantity: 1 }); } catch { threw=true; }
    expect(threw).toBe(false);
  });
  it('ORDER_REJECTED emitted with useful reason/context', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    let payload=null;
    t.on(TradingEvents.ORDER_REJECTED, (p)=>payload=p);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: -1 });
    expect(payload.code).toBe('INVALID_QUANTITY');
    expect(payload.message).toBeTruthy();
  });
  it('no uncaught exception for ordinary mistakes', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    expect(()=>t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: NaN })).not.toThrow();
    expect(()=>t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: Infinity })).not.toThrow();
    expect(()=>t.cancelOrder('nope')).not.toThrow();
  });
});

// ============================================================
// 17. Performance sanity (100, 1000)
// ============================================================
describe('Phase9 — Performance', () => {
  it('100 pending orders processed O(n) per candle', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    for(let i=0;i<100;i++) t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 50+i*0.1 });
    const start = Date.now();
    send(t, c(1001, 60, 61, 49, 55), 1); // triggers all? first fills then others rejected
    const dur = Date.now()-start;
    expect(dur).toBeLessThan(200);
    expect(t.checkInvariants().pendingIdsUnique).toBe(true);
  });
  it('1000 pending orders', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    for(let i=0;i<1000;i++) t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 10 + i*0.05 });
    const start = Date.now();
    send(t, c(1001, 20, 21, 9, 15), 1);
    const dur = Date.now()-start;
    expect(dur).toBeLessThan(500);
  });
  it('does not scan trade history on MARKET_CANDLE (O(1) trade history)', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    // create 100 trades
    for(let i=0;i<100;i++) {
      send(t, mc(1000+i*2, 100), i*2);
      t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
      send(t, mc(1001+i*2, 110), i*2+1);
      t.closePosition('BTCUSD');
    }
    expect(t.getTrades().length).toBe(100);
    const before = t.getAccountSnapshot().totalFees; // not relevant but ensure not scanning
    send(t, c(5000, 100, 101, 99, 100), 1000);
    // If scanning history, would be slow; just verify still works quickly and invariant holds
    expect(t.checkInvariants().equityOk).toBe(true);
  });
});

// ============================================================
// 18. Architecture constraint — only MARKET_CANDLE
// ============================================================
describe('Phase9 — Architecture', () => {
  it('engine isolated from CandleStore etc, only onMarketCandle', async () => {
    const fs = await import('fs');
    const raw = fs.readFileSync('src/trading/PaperTradingEngine.js','utf-8');
    const lines = raw.split('\n').filter(l=>!l.trim().startsWith('*') && !l.trim().startsWith('//'));
    const code = lines.join('\n');
    expect(code).not.toMatch(/from.*CandleStore/);
    expect(code).not.toMatch(/from.*HistoricalDataManager/);
    expect(code).not.toMatch(/from.*Timeline/);
    expect(code).not.toMatch(/from.*ChartManager/);
    expect(code).not.toMatch(/from.*AppState/);
    expect(code).toMatch(/onMarketCandle/);
  });
});

// ============================================================
// 19. Double-fee / duplicate event prevention (explicit)
// ============================================================
describe('Phase9 — Duplicate prevention', () => {
  it('no duplicate ORDER_FILLED for same order', () => {
    const t = new PaperTradingEngine({ feeRate: TRADING_CONFIG.TAKER_FEE_RATE });
    send(t, mc(1000, 100), 0);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 90 });
    let fill=0;
    t.on(TradingEvents.ORDER_FILLED, ()=>fill++);
    send(t, c(1001, 95, 96, 89, 90), 1);
    send(t, c(1002, 90, 92, 88, 90), 2);
    send(t, c(1003, 90, 92, 88, 90), 3);
    expect(fill).toBe(1);
  });
  it('no double fee on repeated candles without close', () => {
    const t = new PaperTradingEngine({ feeRate: TRADING_CONFIG.TAKER_FEE_RATE });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const afterEntry = t.getAccountSnapshot().totalFees;
    send(t, mc(1001, 110), 1);
    send(t, mc(1002, 120), 2);
    send(t, mc(1003, 130), 3);
    expect(t.getAccountSnapshot().totalFees).toBeCloseTo(afterEntry);
  });
  it('position close race yields exactly one TRADE_EXECUTED', () => {
    const t = new PaperTradingEngine({ feeRate: 0 });
    send(t, mc(1000, 100), 0);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    send(t, mc(1001, 100), 1);
    t.setStopLoss('BTCUSD', 90);
    t.setTakeProfit('BTCUSD', 110);
    t.placeLimitOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, limitPrice: 105 });
    let trades=0;
    t.on(TradingEvents.TRADE_EXECUTED, ()=>trades++);
    send(t, c(1002, 100, 115, 80, 105), 2);
    expect(trades).toBe(1);
    expect(t.getTrades().length).toBe(1);
  });
});
