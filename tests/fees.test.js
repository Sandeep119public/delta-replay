import { describe, it, expect } from 'vitest';
import { PaperTradingEngine } from '../src/trading/PaperTradingEngine.js';
import { TRADING_CONFIG, calcFee } from '../src/trading/TradingConfig.js';

function c(time, close) { return { time, open: close, high: close+1, low: close-1, close, volume: 10 }; }
const FEE = TRADING_CONFIG.TAKER_FEE_RATE; // 0.0005

describe('Fees — config and formula', () => {
  it('authoritative config', () => {
    expect(TRADING_CONFIG.TAKER_FEE_RATE).toBe(0.0005);
    expect(calcFee(100 * 1)).toBeCloseTo(0.05);
    expect(calcFee(110 * 1)).toBeCloseTo(0.055);
  });
  it('fee always non-negative', () => {
    expect(calcFee(-100)).toBe(0);
    expect(calcFee(0)).toBe(0);
    expect(calcFee(NaN)).toBe(0);
  });
});

describe('Fees — entry and exit accounting', () => {
  it('entry fee deducted from cashBalance immediately', () => {
    const t = new PaperTradingEngine({ feeRate: FEE, startingBalance: 10000 });
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const entryFee = 100 * 0.0005; // 0.05
    expect(t.getAccountSnapshot().cashBalance).toBeCloseTo(10000 - entryFee);
    expect(t.getAccountSnapshot().totalFees).toBeCloseTo(entryFee);
    expect(t.getAccountSnapshot().realizedPnL).toBe(0);
  });

  it('example from spec: buy 100 qty1 fee0.05, price 110 unreal 10 equity 10009.95, close net 9.895', () => {
    const t = new PaperTradingEngine({ feeRate: FEE, startingBalance: 10000 });
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const entryFee = 0.05;
    expect(t.getAccountSnapshot().cashBalance).toBeCloseTo(9999.95);
    t.onMarketCandle({ candle: c(1001, 110) });
    // gross unreal 10
    expect(t.getPosition('BTCUSD').unrealizedPnL).toBe(10);
    // equity = cash + unreal (gross, fee already in cash)
    expect(t.getAccountSnapshot().equity).toBeCloseTo(10009.95);
    // close
    const res = t.closePosition('BTCUSD');
    const exitFee = 110 * 0.0005; // 0.055
    const gross = 10;
    const net = gross - entryFee - exitFee; // 9.895
    expect(res.grossPnL).toBeCloseTo(gross);
    expect(res.entryFee).toBeCloseTo(entryFee);
    expect(res.exitFee).toBeCloseTo(exitFee);
    expect(res.netPnL).toBeCloseTo(net);
    expect(res.trade.totalFee).toBeCloseTo(entryFee + exitFee);
    expect(t.getAccountSnapshot().cashBalance).toBeCloseTo(10000 + net);
    expect(t.getAccountSnapshot().realizedPnL).toBeCloseTo(net);
    expect(t.getAccountSnapshot().totalFees).toBeCloseTo(entryFee + exitFee);
    expect(t.getAccountSnapshot().equity).toBeCloseTo(10000 + net);
  });

  it('long profit with fees', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 2 });
    t.onMarketCandle({ candle: c(1001, 150) });
    const res = t.closePosition('BTCUSD');
    const gross = (150-100)*2; //100
    const totalFee = (100*2*FEE)+(150*2*FEE);
    expect(res.netPnL).toBeCloseTo(gross - totalFee);
  });

  it('long loss with fees', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    t.onMarketCandle({ candle: c(1001, 80) });
    const res = t.closePosition('BTCUSD');
    expect(res.grossPnL).toBe(-20);
    expect(res.netPnL).toBeLessThan(-20);
  });

  it('long breakeven gross 0 becomes loss net', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    t.onMarketCandle({ candle: c(1001, 100) });
    const res = t.closePosition('BTCUSD');
    expect(res.grossPnL).toBe(0);
    expect(res.netPnL).toBeCloseTo(-0.1);
    expect(res.netPnL).toBeLessThan(0);
  });

  it('short profit with fees', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    t.onMarketCandle({ candle: c(1001, 80) });
    const res = t.closePosition('BTCUSD');
    expect(res.grossPnL).toBe(20);
    expect(res.netPnL).toBeCloseTo(20 - (100*FEE + 80*FEE));
  });

  it('short loss', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    t.onMarketCandle({ candle: c(1001, 120) });
    const res = t.closePosition('BTCUSD');
    expect(res.grossPnL).toBe(-20);
    expect(res.netPnL).toBeLessThan(-20);
  });

  it('short breakeven becomes loss', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    t.onMarketCandle({ candle: c(1001, 100) });
    const res = t.closePosition('BTCUSD');
    expect(res.grossPnL).toBe(0);
    expect(res.netPnL).toBeLessThan(0);
  });
});

describe('Fees — sequential trades', () => {
  it('three trades + fees reconcile', () => {
    const t = new PaperTradingEngine({ feeRate: FEE, startingBalance: 10000 });
    // Trade1: buy 100 -> 200 gross 100
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    t.onMarketCandle({ candle: c(1001, 200) });
    const r1 = t.closePosition('BTCUSD');
    const fee1 = r1.totalFee;
    // Trade2: sell 200 ->150 gross 50 (short profit)
    t.onMarketCandle({ candle: c(1002, 200) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    t.onMarketCandle({ candle: c(1003, 150) });
    const r2 = t.closePosition('BTCUSD');
    // Trade3: buy 150 ->175 gross 25
    t.onMarketCandle({ candle: c(1004, 150) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    t.onMarketCandle({ candle: c(1005, 175) });
    const r3 = t.closePosition('BTCUSD');
    const totalGross = r1.grossPnL + r2.grossPnL + r3.grossPnL;
    const totalNet = r1.netPnL + r2.netPnL + r3.netPnL;
    const totalFees = fee1 + r2.totalFee + r3.totalFee;
    expect(t.getAccountSnapshot().realizedPnL).toBeCloseTo(totalNet);
    expect(t.getAccountSnapshot().totalFees).toBeCloseTo(totalFees);
    expect(t.getAccountSnapshot().cashBalance).toBeCloseTo(10000 + totalNet);
    expect(t.getTrades().length).toBe(3);
  });
});

describe('Fees — no double counting', () => {
  it('entry fee charged once, exit once, total = entry+exit', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const entryFee = 0.05;
    expect(t.getAccountSnapshot().totalFees).toBeCloseTo(entryFee);
    t.onMarketCandle({ candle: c(1001, 110) });
    // ensure not charged again per candle
    expect(t.getAccountSnapshot().totalFees).toBeCloseTo(entryFee);
    const res = t.closePosition('BTCUSD');
    expect(res.totalFee).toBeCloseTo(entryFee + 0.055);
    expect(t.getAccountSnapshot().totalFees).toBeCloseTo(entryFee + 0.055);
  });

  it('fee not counted twice in realized', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    t.onMarketCandle({ candle: c(1001, 110) });
    const res = t.closePosition('BTCUSD');
    // net = gross - totalFee, realized = net
    expect(res.realizedPnL).toBeCloseTo(res.grossPnL - res.totalFee);
  });

  it('cash invariant gross - fees', () => {
    const start = 10000;
    const t = new PaperTradingEngine({ feeRate: FEE, startingBalance: start });
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    t.onMarketCandle({ candle: c(1001, 110) });
    const res = t.closePosition('BTCUSD');
    const expectedCash = start + res.grossPnL - res.totalFee;
    expect(t.getAccountSnapshot().cashBalance).toBeCloseTo(expectedCash);
  });
});

describe('Fees — opposite order closes with fees', () => {
  it('SELL while LONG closes with fees, no new position', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    t.onMarketCandle({ candle: c(1001, 120) });
    const res = t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    expect(res.success).toBe(true);
    expect(t.getPosition('BTCUSD')).toBeNull();
    expect(res.totalFee).toBeCloseTo(100*FEE + 120*FEE);
  });
});

describe('Fees — reset', () => {
  it('reset clears fees', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    t.onMarketCandle({ candle: c(1001, 110) });
    t.closePosition('BTCUSD');
    expect(t.getAccountSnapshot().totalFees).toBeGreaterThan(0);
    t.resetAccount();
    expect(t.getAccountSnapshot().totalFees).toBe(0);
    expect(t.getAccountSnapshot().realizedPnL).toBe(0);
    expect(t.getTrades().length).toBe(0);
  });
});

describe('Fees — determinism', () => {
  it('same sequence same fees', () => {
    function run() {
      const t = new PaperTradingEngine({ feeRate: FEE });
      t.onMarketCandle({ candle: c(1000, 100) });
      t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
      t.onMarketCandle({ candle: c(1001, 110) });
      t.closePosition('BTCUSD');
      return t.getAccountSnapshot();
    }
    expect(run()).toEqual(run());
  });
});

describe('Fees — trade model contains gross/net/fees', () => {
  it('trade has gross, entryFee, exitFee, totalFee, netPnL', () => {
    const t = new PaperTradingEngine({ feeRate: FEE });
    t.onMarketCandle({ candle: c(1000, 100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    t.onMarketCandle({ candle: c(1001, 110) });
    const tr = t.closePosition('BTCUSD').trade;
    expect(tr.grossPnL).toBe(10);
    expect(tr.entryFee).toBeCloseTo(0.05);
    expect(tr.exitFee).toBeCloseTo(0.055);
    expect(tr.totalFee).toBeCloseTo(0.105);
    expect(tr.netPnL).toBeCloseTo(9.895);
  });
});

describe('Fees — O(1)', () => {
  it('calcFee O(1) single helper', () => {
    expect(calcFee(100, 0.0005)).toBe(0.05);
    // PAPER engine uses calcFee internally, not scanning trades
    const t = new PaperTradingEngine({ feeRate: FEE });
    t.onMarketCandle({ candle: c(1000,100) });
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    // ensure fee calc not loop
    const before = t.getAccountSnapshot().totalFees;
    t.onMarketCandle({ candle: c(1001,200) });
    expect(t.getAccountSnapshot().totalFees).toBe(before);
  });
});
