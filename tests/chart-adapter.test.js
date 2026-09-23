import { describe, expect, it, vi } from 'vitest';
import { ChartAdapter } from '../src/chart/ChartAdapter.js';

function port() {
  const listeners = new Map();
  const state = { status: 'ready', currentIndex: -1, totalCandles: 4 };
  const candles = [
    { time: 60, open: 1, high: 2, low: 0, close: 1.5, volume: 1 },
    { time: 120, open: 1.5, high: 2.5, low: 1, close: 2, volume: 1 },
    { time: 180, open: 2, high: 3, low: 1.5, close: 2.5, volume: 1 },
    { time: 240, open: 2.5, high: 3.5, low: 2, close: 3, volume: 1 },
  ];
  const on = (event, handler) => {
    listeners.set(event, handler);
    return () => listeners.delete(event);
  };
  return {
    getTotalCandles: () => candles.length,
    getState: () => ({ ...state }),
    getVisibleCandles: () => state.currentIndex >= 0 ? candles.slice(0, state.currentIndex + 1).map((c) => ({ ...c })) : [],
    getCandleWindow: (index, size = 1000) => candles.slice(Math.max(0, index - size + 1), index + 1).map((c) => ({ ...c })),
    onStarted: (h) => on('started', h),
    onSeeked: (h) => on('seeked', h),
    onStepped: (h) => on('stepped', h),
    onReset: (h) => on('reset', h),
    emit(event, payload) { if (state && event === 'state') Object.assign(state, payload); listeners.get(event)?.(payload); },
  };
}

function makeChart() {
  return {
    setRevealedMax: vi.fn(),
    setData: vi.fn(),
    updateRevealedCandle: vi.fn(() => true),
    followCurrent: vi.fn(),
    clear: vi.fn(),
  };
}

describe('ChartAdapter', () => {
  it('renders a full window on start and only updates one candle on normal steps', () => {
    const replay = port();
    const chart = makeChart();
    const adapter = new ChartAdapter(replay, chart);
    adapter.attach();

    replay.emit('state', { status: 'paused', currentIndex: 1 });
    replay.emit('started', { index: 1 });
    expect(chart.setData).toHaveBeenCalledTimes(1);

    replay.emit('state', { status: 'paused', currentIndex: 2 });
    replay.emit('stepped', { index: 2 });
    expect(chart.updateRevealedCandle).toHaveBeenCalledWith(candlesAt(replay, 2));
    expect(chart.setData).toHaveBeenCalledTimes(1);

    adapter.destroy();

    function candlesAt(p, index) { return p.getCandleWindow(index, 1)[0]; }
  });

  it('uses the port for preview instead of a store', () => {
    const replay = port();
    const chart = makeChart();
    const adapter = new ChartAdapter(replay, chart);
    adapter.showPreview(2, 2);
    expect(chart.setData).toHaveBeenCalledWith(replay.getCandleWindow(2, 2), { fit: true });
    adapter.destroy();
  });
});
