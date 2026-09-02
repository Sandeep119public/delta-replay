import { describe, it, expect, vi } from 'vitest';
import { ChartManager } from '../src/chart/ChartManager.js';

function createMockChartManager() {
  const priceLines = [];
  const mockSeries = {
    createPriceLine: vi.fn((opts) => {
      const line = {
        opts,
        applyOptions: vi.fn((newOpts) => {
          Object.assign(line.opts, newOpts);
        }),
      };
      priceLines.push(line);
      return line;
    }),
    removePriceLine: vi.fn((line) => {
      const idx = priceLines.indexOf(line);
      if (idx !== -1) priceLines.splice(idx, 1);
    }),
    coordinateToPrice: vi.fn((y) => 65000 - y * 10),
    setData: vi.fn(),
  };

  const cm = Object.create(ChartManager.prototype);
  cm.series = mockSeries;
  cm._positionLine = null;
  cm._stopLossLine = null;
  cm._takeProfitLine = null;
  cm._orderLines = new Map();
  cm._onChartClickCallbacks = [];
  return { cm, mockSeries, priceLines };
}

describe('ChartManager Trading Overlays and Price Lines', () => {
  it('creates a live position entry line on LONG position', () => {
    const { cm, mockSeries } = createMockChartManager();
    cm.updatePositionLines({
      symbol: 'BTCUSDT',
      side: 'LONG',
      quantity: 1.5,
      entryPrice: 65000,
    });
    expect(mockSeries.createPriceLine).toHaveBeenCalledTimes(1);
    expect(mockSeries.createPriceLine).toHaveBeenCalledWith(expect.objectContaining({
      price: 65000,
      color: '#10b981',
      title: 'LONG 1.5 @ 65000.00',
    }));
  });

  it('creates entry line, Stop Loss line, and Take Profit line when risk is set', () => {
    const { cm, mockSeries } = createMockChartManager();
    cm.updatePositionLines({
      symbol: 'BTCUSDT',
      side: 'LONG',
      quantity: 1.0,
      entryPrice: 65000,
      stopLossPrice: 63500,
      takeProfitPrice: 68000,
    });
    expect(mockSeries.createPriceLine).toHaveBeenCalledTimes(3);
    expect(cm._positionLine.opts.price).toBe(65000);
    expect(cm._stopLossLine.opts.price).toBe(63500);
    expect(cm._stopLossLine.opts.color).toBe('#ef4444');
    expect(cm._takeProfitLine.opts.price).toBe(68000);
    expect(cm._takeProfitLine.opts.color).toBe('#10b981');
  });

  it('updates existing price lines in-place on position update without re-creating', () => {
    const { cm, mockSeries } = createMockChartManager();
    cm.updatePositionLines({
      symbol: 'BTCUSDT',
      side: 'LONG',
      quantity: 1.0,
      entryPrice: 65000,
      stopLossPrice: 63500,
    });
    expect(mockSeries.createPriceLine).toHaveBeenCalledTimes(2);
    cm.updatePositionLines({
      symbol: 'BTCUSDT',
      side: 'LONG',
      quantity: 1.0,
      entryPrice: 65000,
      stopLossPrice: 64000,
    });
    expect(mockSeries.createPriceLine).toHaveBeenCalledTimes(2);
    expect(cm._stopLossLine.applyOptions).toHaveBeenCalledWith(expect.objectContaining({
      price: 64000,
      title: 'SL: 64000.00',
    }));
  });

  it('removes all position lines cleanly when position is closed (null)', () => {
    const { cm, mockSeries } = createMockChartManager();
    cm.updatePositionLines({
      symbol: 'BTCUSDT',
      side: 'LONG',
      quantity: 1.0,
      entryPrice: 65000,
      stopLossPrice: 63500,
      takeProfitPrice: 68000,
    });
    expect(cm._positionLine).not.toBeNull();
    expect(cm._stopLossLine).not.toBeNull();
    expect(cm._takeProfitLine).not.toBeNull();
    cm.updatePositionLines(null);
    expect(mockSeries.removePriceLine).toHaveBeenCalledTimes(3);
    expect(cm._positionLine).toBeNull();
    expect(cm._stopLossLine).toBeNull();
    expect(cm._takeProfitLine).toBeNull();
  });

  it('renders and cleans up pending limit and stop order lines', () => {
    const { cm, mockSeries, priceLines } = createMockChartManager();
    const orders = [
      { id: 'ord_1', type: 'LIMIT', side: 'BUY', quantity: 0.5, limitPrice: 64000, status: 'PENDING' },
      { id: 'ord_2', type: 'STOP_MARKET', side: 'SELL', quantity: 0.5, stopPrice: 62000, status: 'PENDING' },
      { id: 'ord_3', type: 'MARKET', side: 'BUY', quantity: 0.5, status: 'FILLED' },
    ];
    cm.updateOrderLines(orders);
    expect(mockSeries.createPriceLine).toHaveBeenCalledTimes(2);
    expect(cm._orderLines.size).toBe(2);
    cm.updateOrderLines([
      { id: 'ord_2', type: 'STOP_MARKET', side: 'SELL', quantity: 0.5, stopPrice: 62000, status: 'PENDING' }
    ]);
    expect(mockSeries.removePriceLine).toHaveBeenCalledTimes(1);
    expect(cm._orderLines.size).toBe(1);
    expect(cm._orderLines.has('ord_2')).toBe(true);
  });

  it('converts coordinate Y to price accurately and triggers click listeners', () => {
    const { cm } = createMockChartManager();
    const clickHandler = vi.fn();
    cm.onChartClick(clickHandler);
    const price = cm.coordinateToPrice(100);
    expect(price).toBe(64000);
    cm._onChartClickCallbacks.forEach(cb => cb({ price: 64000, point: { x: 50, y: 100 }, time: 1700000000 }));
    expect(clickHandler).toHaveBeenCalledWith({ price: 64000, point: { x: 50, y: 100 }, time: 1700000000 });
  });

  it('clears all trading price lines on clear() and destroy()', () => {
    const { cm, mockSeries } = createMockChartManager();
    cm.updatePositionLines({
      symbol: 'BTCUSDT',
      side: 'SHORT',
      quantity: 2.0,
      entryPrice: 65000,
    });
    cm.updateOrderLines([
      { id: 'ord_1', type: 'LIMIT', side: 'BUY', quantity: 1.0, limitPrice: 64000, status: 'PENDING' }
    ]);
    expect(cm._positionLine).not.toBeNull();
    expect(cm._orderLines.size).toBe(1);
    cm.clear();
    expect(cm._positionLine).toBeNull();
    expect(cm._orderLines.size).toBe(0);
  });
});