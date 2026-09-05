import { describe, it, expect } from 'vitest';
import { MarginEngine } from '../src/trading/MarginEngine.js';

describe('MarginEngine — Futures Margin & Liquidation Math', () => {
  it('calculates initial margin and maintenance margin correctly', () => {
    const me = new MarginEngine({ marginRate: 0.1, maintMarginRate: 0.05 }); // 10x leverage
    const res = me.calcPositionMargins(50000, 2, 'LONG');

    // Notional = 100,000
    expect(res.initialMargin).toBe(10000);
    expect(res.maintenanceMargin).toBe(5000);
  });

  it('validates margin availability based on wallet and available margin', () => {
    const me = new MarginEngine({ marginRate: 0.2 }); // 5x leverage
    const res = me.checkMarginAvailable({
      price: 100,
      quantity: 10,
      fee: 5,
      availableMargin: 205, // required 200 + 5 = 205
      walletBalance: 100,
    });
    expect(res.valid).toBe(true);
    expect(res.requiredMargin).toBe(205);

    const fail = me.checkMarginAvailable({
      price: 100,
      quantity: 10,
      fee: 5,
      availableMargin: 200, // short 5
      walletBalance: 100,
    });
    expect(fail.valid).toBe(false);
  });

  it('calculates isolated liquidation price for Long position', () => {
    const me = new MarginEngine({ marginRate: 0.1, maintMarginRate: 0.05 });
    // Long 1 unit @ 100, Wallet = 100
    const pos = { symbol: 'BTCUSD', side: 'LONG', quantity: 1, entryPrice: 100 };
    const positions = new Map([['BTCUSD', pos]]);
    const liq = me.calcLiquidationPrice(pos, positions, 100);

    // W = 100, Q = 1, mm = 0.05
    // liqPrice = (100 * 1 - 100) / (1 * (1 - 0.05)) = 0 -> null
    expect(liq).toBeNull();

    // Now wallet = 10 (10x leveraged)
    // liqPrice = (100 * 1 - 10) / (1 * 0.95) = 90 / 0.95 = 94.7368...
    const liqLev = me.calcLiquidationPrice(pos, positions, 10);
    expect(liqLev).toBeCloseTo(94.74, 1);
  });

  it('calculates isolated liquidation price for Short position', () => {
    const me = new MarginEngine({ marginRate: 0.1, maintMarginRate: 0.05 });
    // Short 1 unit @ 100, Wallet = 10
    const pos = { symbol: 'BTCUSD', side: 'SHORT', quantity: 1, entryPrice: 100 };
    const positions = new Map([['BTCUSD', pos]]);
    // liqPrice = (10 + 100 * 1) / (1 * 1.05) = 110 / 1.05 = 104.76...
    const liq = me.calcLiquidationPrice(pos, positions, 10);
    expect(liq).toBeCloseTo(104.76, 1);
  });
});
