import { describe, expect, it } from 'vitest';
import { MarginEngine } from '../src/trading/MarginEngine.js';

describe('MarginEngine characterization', () => {
  it('calculates initial and maintenance margin from notional', () => {
    const engine = new MarginEngine({ marginRate: 0.1, maintMarginRate: 0.05 });
    expect(engine.calcPositionMargins(200, 3, 'LONG')).toEqual({
      initialMargin: 60,
      maintenanceMargin: 30,
      liquidationPrice: null,
    });
    expect(engine.calcRequiredEntryCash(200, 3, 1.5)).toBe(61.5);
  });

  it('rejects entry when available margin cannot cover initial margin plus fee', () => {
    const engine = new MarginEngine({ marginRate: 0.1, maintMarginRate: 0.05 });
    expect(engine.checkMarginAvailable({
      price: 200,
      quantity: 3,
      fee: 1.5,
      availableMargin: 60,
      walletBalance: 60,
    }).valid).toBe(false);
    expect(engine.checkMarginAvailable({
      price: 200,
      quantity: 3,
      fee: 1.5,
      availableMargin: 61.5,
      walletBalance: 61.5,
    }).valid).toBe(true);
  });

  it('aggregates cross-margin equity and maintenance margin across symbols', () => {
    const engine = new MarginEngine({ marginRate: 0.1, maintMarginRate: 0.05 });
    const positions = new Map([
      ['BTCUSDT', { symbol: 'BTCUSDT', side: 'LONG', quantity: 1, entryPrice: 100, currentPrice: 110 }],
      ['ETHUSDT', { symbol: 'ETHUSDT', side: 'SHORT', quantity: 2, entryPrice: 50, currentPrice: 45 }],
    ]);
    const state = engine.calcPortfolioMarginState('BTCUSDT', 120, positions, 100);
    expect(state.equity).toBe(130);
    expect(state.maintenanceMargin).toBeCloseTo(8.5, 10);
    expect(engine.isPortfolioLiquidatable('BTCUSDT', 120, positions, 100)).toBe(false);
  });

  it('includes other open positions when deriving liquidation price', () => {
    const engine = new MarginEngine({ marginRate: 0.1, maintMarginRate: 0.05 });
    const primary = { symbol: 'BTCUSDT', side: 'LONG', quantity: 1, entryPrice: 100, currentPrice: 100 };
    const positions = new Map([
      ['BTCUSDT', primary],
      ['ETHUSDT', { symbol: 'ETHUSDT', side: 'LONG', quantity: 1, entryPrice: 50, currentPrice: 60 }],
    ]);
    const withoutOther = engine.calcLiquidationPrice(primary, new Map([['BTCUSDT', primary]]), 40);
    const withOther = engine.calcLiquidationPrice(primary, positions, 40);
    expect(withOther).toBeGreaterThan(withoutOther);
  });
});
