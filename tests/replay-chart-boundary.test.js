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

describe('ChartAdapter revealed boundary', () => {
  it('advances revealed max before each replay update', () => {
    const engine = new ReplayEngine();
    let revealedMax = null;
    const chart = {
      setData: vi.fn(),
      update: vi.fn(c => {
        if (revealedMax != null && c.time > revealedMax) return;
      }),
      clear: vi.fn(),
      followCurrent: vi.fn(),
      setRevealedMax: vi.fn(t => { revealedMax = t; })
    };

    new ChartAdapter(engine, chart).attach();
    const data = candles(5);
    engine.load(data);
    engine.start(0);
    engine.stepForward();
    engine.stepForward();

    expect(chart.update).toHaveBeenCalledTimes(2);
    expect(chart.update.mock.calls.map(([c]) => c.time)).toEqual([data[1].time, data[2].time]);
    expect(chart.setRevealedMax.mock.calls.map(([t]) => t)).toEqual([data[0].time, data[1].time, data[2].time]);
  });
});
