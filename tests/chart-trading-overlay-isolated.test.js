import { describe, it, expect, vi } from 'vitest';
import { ChartTradingOverlay } from '../src/chart/ChartTradingOverlay.js';

describe('ChartTradingOverlay — Isolated Component', () => {
  function createMockSeries() {
    const lines = [];
    return {
      createPriceLine: vi.fn((opts) => {
        const line = {
          opts,
          applyOptions: vi.fn((newOpts) => Object.assign(line.opts, newOpts)),
        };
        lines.push(line);
        return line;
      }),
      removePriceLine: vi.fn((line) => {
        const idx = lines.indexOf(line);
        if (idx !== -1) lines.splice(idx, 1);
      }),
      lines,
    };
  }

  it('renders position line on Long position with entry price', () => {
    const mockSeries = createMockSeries();
    const overlay = new ChartTradingOverlay({ series: mockSeries });

    overlay.updatePositionLines({
      symbol: 'BTCUSDT',
      side: 'LONG',
      quantity: 1.0,
      entryPrice: 60000,
    });

    expect(mockSeries.createPriceLine).toHaveBeenCalledTimes(1);
    expect(mockSeries.createPriceLine).toHaveBeenCalledWith(expect.objectContaining({
      price: 60000,
      color: '#2f7d58',
      title: 'LONG 1 @ 60000.00',
    }));
  });

  it('renders SL and TP lines when risk parameters are present', () => {
    const mockSeries = createMockSeries();
    const overlay = new ChartTradingOverlay({ series: mockSeries });

    overlay.updatePositionLines({
      symbol: 'BTCUSDT',
      side: 'LONG',
      quantity: 2.0,
      entryPrice: 60000,
      stopLossPrice: 58000,
      takeProfitPrice: 65000,
    });

    expect(mockSeries.createPriceLine).toHaveBeenCalledTimes(3);
    expect(overlay._stopLossLine).not.toBeNull();
    expect(overlay._takeProfitLine).not.toBeNull();
  });

  it('resolves click intent for Long position: higher price is TP, lower price is SL', () => {
    const overlay = new ChartTradingOverlay();
    const longPos = { symbol: 'BTCUSDT', side: 'LONG', entryPrice: 60000 };

    const tpIntent = overlay.resolveClickIntent(65000, longPos);
    expect(tpIntent.action).toBe('SET_TP');
    expect(tpIntent.isTP).toBe(true);

    const slIntent = overlay.resolveClickIntent(58000, longPos);
    expect(slIntent.action).toBe('SET_SL');
    expect(slIntent.isTP).toBe(false);
  });

  it('resolves click intent for Short position: lower price is TP, higher price is SL', () => {
    const overlay = new ChartTradingOverlay();
    const shortPos = { symbol: 'BTCUSDT', side: 'SHORT', entryPrice: 60000 };

    const tpIntent = overlay.resolveClickIntent(55000, shortPos);
    expect(tpIntent.action).toBe('SET_TP');
    expect(tpIntent.isTP).toBe(true);

    const slIntent = overlay.resolveClickIntent(63000, shortPos);
    expect(slIntent.action).toBe('SET_SL');
    expect(slIntent.isTP).toBe(false);
  });

  it('resolves click intent to PRICE_SELECT when no position is open', () => {
    const overlay = new ChartTradingOverlay();
    const intent = overlay.resolveClickIntent(60500, null);
    expect(intent.action).toBe('PRICE_SELECT');
    expect(intent.price).toBe(60500);
  });
});
