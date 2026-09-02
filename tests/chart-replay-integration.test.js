import { describe, it, expect, vi } from 'vitest';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { ChartAdapter } from '../src/chart/ChartAdapter.js';

function candles(n, start = 1700000000) {
  return Array.from({ length: n }, (_, i) => {
    const open = 100 + i;
    const close = open + 0.5;
    return {
      time: start + i * 60,
      open,
      high: close + 0.5,
      low: open - 0.5,
      close,
      volume: 10
    };
  });
}

function chartMock() {
  return {
    setData: vi.fn(),
    update: vi.fn(),
    clear: vi.fn(),
    followCurrent: vi.fn()
  };
}

describe('Chart replay integration', () => {
  it('renders the starting candle, then follows each replay step', () => {
    const engine = new ReplayEngine();
    const chart = chartMock();
    new ChartAdapter(engine, chart).attach();
    const data = candles(6);
    engine.load(data);
    engine.start(2);

    expect(chart.setData).toHaveBeenCalledTimes(1);
    expect(chart.setData.mock.calls[0][0]).toHaveLength(3);
    expect(chart.setData.mock.calls[0][0][2].time).toBe(data[2].time);

    engine.stepForward();
    engine.stepForward();

    expect(chart.update).toHaveBeenCalledTimes(2);
    expect(chart.update.mock.calls[0][0].time).toBe(data[3].time);
    expect(chart.update.mock.calls[1][0].time).toBe(data[4].time);
    expect(chart.followCurrent).toHaveBeenCalledTimes(2);
  });

  it('rebuilds the chart on seek instead of trying to append backwards', () => {
    const engine = new ReplayEngine();
    const chart = chartMock();
    new ChartAdapter(engine, chart).attach();
    engine.load(candles(6));
    engine.start(4);
    chart.setData.mockClear();
    chart.update.mockClear();

    engine.seek(1);

    expect(chart.setData).toHaveBeenCalledTimes(1);
    expect(chart.setData.mock.calls[0][0]).toHaveLength(2);
    expect(chart.update).not.toHaveBeenCalled();
  });

  it('does not double-render the starting candle from MARKET_CANDLE', () => {
    const engine = new ReplayEngine();
    const chart = chartMock();
    new ChartAdapter(engine, chart).attach();
    engine.load(candles(4));

    engine.start(1);

    expect(chart.setData).toHaveBeenCalledTimes(1);
    expect(chart.update).not.toHaveBeenCalled();
  });

  it('reset rebuilds the visible replay window', () => {
    const engine = new ReplayEngine();
    const chart = chartMock();
    new ChartAdapter(engine, chart).attach();
    engine.load(candles(5));
    engine.start(1);
    engine.stepForward();
    chart.setData.mockClear();
    engine.reset();

    expect(chart.setData).toHaveBeenCalledTimes(1);
    expect(chart.setData.mock.calls[0][0]).toHaveLength(2);
    expect(chart.setData.mock.calls[0][0][1].time).toBe(candles(5)[1].time);
  });
});
