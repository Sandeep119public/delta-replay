import { describe, expect, it } from 'vitest';
import { Position } from '../src/trading/Position.js';

describe('Position maintenance margin', () => {
  it('tracks mark-to-market maintenance margin while preserving the entry rate', () => {
    const position = new Position({
      symbol: 'BTCUSD',
      side: 'LONG',
      quantity: 10,
      entryPrice: 100,
      currentPrice: 100,
      openedAt: 1000,
      maintenanceMargin: 50,
    });

    expect(position.maintenanceMargin).toBe(50);
    position.currentPrice = 150;
    expect(position.maintenanceMargin).toBe(75);
    expect(position.clone().maintenanceMargin).toBe(75);
    expect(position.toJSON().maintenanceMargin).toBe(75);
  });

  it('supports an explicit maintenance margin rate', () => {
    const position = new Position({
      symbol: 'BTCUSD',
      side: 'SHORT',
      quantity: 2,
      entryPrice: 100,
      currentPrice: 120,
      openedAt: 1000,
      maintenanceMarginRate: 0.1,
    });

    expect(position.maintenanceMargin).toBe(24);
  });
});
