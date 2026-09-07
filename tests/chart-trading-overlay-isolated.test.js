import { describe, it, expect, vi } from 'vitest';
import { ChartTradingOverlay } from '../src/chart/ChartTradingOverlay.js';
import { createChartTradingActions } from '../src/app/ChartTradingActions.js';

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

  function createTradingView(positions = []) {
    return {
      snapshot: () => Object.freeze({
        account: null,
        positions: positions.map((position) => Object.freeze({ ...position })),
        pendingOrders: [],
        orders: [],
        trades: [],
        stats: {},
        hasMarket: true,
        markPrice: 60000,
      }),
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
      color: '#10B981',
      title: 'LONG 1.000 @ 60,000.00  |  +$0.00',
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

  it('does not resolve trading intent: the overlay renders presentation data only', () => {
    const overlay = new ChartTradingOverlay();
    expect(overlay.resolveClickIntent).toBeUndefined();
  });

  it('resolves click intent for Long position in the application layer', () => {
    const actions = createChartTradingActions({
      trading: createTradingView([{ symbol: 'BTCUSDT', side: 'LONG', entryPrice: 60000 }]),
      executeTrade: vi.fn(),
      reportError: vi.fn(),
    });
    const longPos = { symbol: 'BTCUSDT', side: 'LONG', entryPrice: 60000 };

    const tpIntent = actions.resolveClick(65000, longPos);
    expect(tpIntent.action).toBe('SET_TP');
    expect(tpIntent.isTP).toBe(true);

    const slIntent = actions.resolveClick(58000, longPos);
    expect(slIntent.action).toBe('SET_SL');
    expect(slIntent.isTP).toBe(false);
  });

  it('resolves click intent for Short position in the application layer', () => {
    const actions = createChartTradingActions({
      trading: createTradingView([{ symbol: 'BTCUSDT', side: 'SHORT', entryPrice: 60000 }]),
      executeTrade: vi.fn(),
      reportError: vi.fn(),
    });

    const tpIntent = actions.resolveClick(55000);
    expect(tpIntent.action).toBe('SET_TP');
    expect(tpIntent.isTP).toBe(true);

    const slIntent = actions.resolveClick(63000);
    expect(slIntent.action).toBe('SET_SL');
    expect(slIntent.isTP).toBe(false);
  });

  it('resolves click intent to PRICE_SELECT when no position is open', () => {
    const actions = createChartTradingActions({
      trading: createTradingView([]),
      executeTrade: vi.fn(),
      reportError: vi.fn(),
    });
    const intent = actions.resolveClick(60500);
    expect(intent.action).toBe('PRICE_SELECT');
    expect(intent.price).toBe(60500);
  });
});
