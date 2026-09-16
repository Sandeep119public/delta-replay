import { describe, expect, it } from 'vitest';
import { ChartManager } from '../src/chart/ChartManager.js';

describe('ChartManager trading overlay lifecycle', () => {
  it('does not lazily construct a trading overlay while clearing before first use', () => {
    const manager = new ChartManager({});

    manager.clearTradingLines();

    expect(manager._tradingOverlay).toBeUndefined();
  });

  it('keeps an existing overlay available for explicit cleanup', () => {
    const manager = new ChartManager({});
    const overlay = manager.tradingOverlay;

    expect(manager._tradingOverlay).toBe(overlay);
    manager.clearTradingLines();
    expect(manager._tradingOverlay).toBe(overlay);
  });
});
