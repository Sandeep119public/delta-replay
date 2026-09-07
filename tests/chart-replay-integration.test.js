import { describe, it, expect, vi } from 'vitest';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { ChartAdapter } from '../src/chart/ChartAdapter.js';
import { createReplayUIPort } from '../src/app/ReplayUIPort.js';

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
      volume: 10,
    };
  });
}

function chartMock() {
  return {
    setData: vi.fn(),
    update: vi.fn(),
    clear: vi.fn(),
    followCurrent: vi.fn(),
    setRevealedMax: vi.fn(),
  };
}

describe('Chart replay integration', () => {
  it('renders the starting candle, then renders each replay step', () => {
    const engine = new ReplayEngine();
    const port = createReplayUIPort(engine);
    const chart = chartMock();
    new ChartAdapter(port, chart).attach();
    const data = candles(6);
    engine.load(data);
    engine.start(2);

    expect(chart.setData).toHaveBeenCalledTimes(1);
    expect(chart.setData.mock.calls[0][0]).toHaveLength(3);
    expect(chart.setData.mock.calls[0][0][2].time).toBe(data[2].time);

    engine.stepForward();
    engine.stepForward();

    expect(chart.setData).toHaveBeenCalledTimes(3);
    expect(chart.setData.mock.calls[1][0]).toHaveLength(4);
    expect(chart.setData.mock.calls[1][0][3].time).toBe(data[3].time);
    expect(chart.setData.mock.calls[2][0]).toHaveLength(5);
    expect(chart.setData.mock.calls[2][0][4].time).toBe(data[4].time);
    expect(chart.followCurrent).toHaveBeenCalledTimes(2);
    expect(chart.setRevealedMax).toHaveBeenCalledWith(data[4].time);
    engine.destroy();
  });

  it('keeps the rendered window bounded at 1000 candles', () => {
    const engine = new ReplayEngine();
    const port = createReplayUIPort(engine);
    const chart = chartMock();
    new ChartAdapter(port, chart).attach();
    const data = candles(1105);
    engine.load(data);
    engine.start(1000);
    engine.stepForward();

    const latest = chart.setData.mock.calls.at(-1)[0];
    expect(latest).toHaveLength(1000);
    expect(latest[0].time).toBe(data[2].time);
    expect(latest.at(-1).time).toBe(data[1001].time);
    engine.destroy();
  });

  it('rebuilds the chart on seek instead of trying to append backwards', () => {
    const engine = new ReplayEngine();
    const port = createReplayUIPort(engine);
    const chart = chartMock();
    new ChartAdapter(port, chart).attach();
    engine.load(candles(6));
    engine.start(4);
    chart.setData.mockClear();
    chart.update.mockClear();

    port.seek(1);

    expect(chart.setData).toHaveBeenCalledTimes(1);
    expect(chart.setData.mock.calls[0][0]).toHaveLength(2);
    expect(chart.update).not.toHaveBeenCalled();
    engine.destroy();
  });

  it('does not render the starting candle twice', () => {
    const engine = new ReplayEngine();
    const port = createReplayUIPort(engine);
    const chart = chartMock();
    new ChartAdapter(port, chart).attach();
    engine.load(candles(4));

    engine.start(1);

    expect(chart.setData).toHaveBeenCalledTimes(1);
    engine.destroy();
  });

  it('reset rebuilds the visible replay window', () => {
    const engine = new ReplayEngine();
    const port = createReplayUIPort(engine);
    const chart = chartMock();
    new ChartAdapter(port, chart).attach();
    const data = candles(5);
    engine.load(data);
    engine.start(1);
    engine.stepForward();
    chart.setData.mockClear();
    port.reset();

    expect(chart.setData).toHaveBeenCalledTimes(1);
    expect(chart.setData.mock.calls[0][0]).toHaveLength(2);
    expect(chart.setData.mock.calls[0][0][1].time).toBe(data[1].time);
    engine.destroy();
  });
});