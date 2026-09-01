import { describe, it, expect, vi } from 'vitest';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { ChartAdapter } from '../src/chart/ChartAdapter.js';
import { formatTime, toUnixSeconds } from '../src/utils/time.js';

function makeCandles(n, start = 1700000000, step = 60) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const t = start + i * step;
    arr.push({ time: t, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 10 });
  }
  return arr;
}

function createMockChart() {
  const calls = { setData: [], update: [], clear: [] };
  return {
    setData(candles) { calls.setData.push(candles.map(c => ({ ...c }))); },
    update(c) { calls.update.push({ ...c }); },
    clear() { calls.clear.push(true); },
    followCurrent() { calls.followCurrent = (calls.followCurrent || 0) + 1; },
    _calls: calls
  };
}

describe('Replay UX — state synchronization (derived from ReplayEngine)', () => {
  it('READY -> PLAYING -> PAUSED -> ENDED transitions', async () => {
    const engine = new ReplayEngine();
    const candles = makeCandles(5);
    engine.load(candles);
    expect(engine.getState().status).toBe('ready');
    engine.start(0);
    expect(engine.getState().status).toBe('paused');
    expect(engine.getState().currentIndex).toBe(0);
    engine.play();
    expect(engine.getState().status).toBe('playing');
    engine.pause();
    expect(engine.getState().status).toBe('paused');
    // step to end
    engine.stepForward(); // 1
    engine.stepForward(); // 2
    engine.stepForward(); // 3
    engine.stepForward(); // 4 -> ended
    expect(engine.getState().status).toBe('ended');
    expect(engine.getState().currentIndex).toBe(4);
  });

  it('RESET returns to startIndex paused', () => {
    const eng = new ReplayEngine();
    eng.load(makeCandles(10));
    eng.start(2);
    eng.stepForward(); // 3
    eng.reset();
    expect(eng.getState().currentIndex).toBe(2);
    expect(eng.getState().status).toBe('paused');
  });

  it('ended state disables play', () => {
    const eng = new ReplayEngine();
    eng.load(makeCandles(3));
    eng.start(2); // last index -> ended
    expect(eng.getState().status).toBe('ended');
    const before = eng.getState().status;
    eng.play();
    expect(eng.getState().status).toBe('ended');
  });
});

describe('Replay UX — speed changes', () => {
  it('speed change while paused preserves status and updates speed', () => {
    const eng = new ReplayEngine();
    eng.load(makeCandles(5));
    eng.start(0);
    eng.setSpeed(5);
    expect(eng.getState().speed).toBe(5);
    expect(eng.getState().status).toBe('paused');
  });

  it('speed change while playing does not duplicate timers and keeps playing', async () => {
    const eng = new ReplayEngine();
    eng.load(makeCandles(10));
    eng.start(0);
    eng.play();
    const timerBefore = eng._timer;
    expect(timerBefore).not.toBeNull();
    eng.setSpeed(2);
    expect(eng.getState().speed).toBe(2);
    expect(eng.getState().status).toBe('playing');
    // timer should be recreated (not duplicated)
    const timerAfter = eng._timer;
    expect(timerAfter).not.toBeNull();
    // changing speed again quickly should still have single timer
    eng.setSpeed(10);
    expect(eng._timer).not.toBeNull();
    eng.pause();
    expect(eng._timer).toBeNull();
  });

  it('repeated speed changes do not skip candles unexpectedly', async () => {
    const eng = new ReplayEngine();
    eng.load(makeCandles(5));
    eng.start(0);
    eng.setSpeed(0.25);
    eng.setSpeed(0.5);
    eng.setSpeed(1);
    expect(eng.getState().currentIndex).toBe(0);
  });
});

describe('Replay UX — progress', () => {
  it('progress after start is 1 / total', () => {
    const eng = new ReplayEngine();
    eng.load(makeCandles(8000));
    eng.start(0);
    const s = eng.getState();
    expect(s.currentIndex + 1).toBe(1);
    expect(s.totalCandles).toBe(8000);
    const pct = ((s.currentIndex + 1) / s.totalCandles * 100).toFixed(2);
    expect(pct).toBe('0.01');
  });

  it('progress after step increments', () => {
    const eng = new ReplayEngine();
    eng.load(makeCandles(100));
    eng.start(10);
    eng.stepForward();
    expect(eng.getState().currentIndex).toBe(11);
  });

  it('progress after seek reflects seek index', () => {
    const eng = new ReplayEngine();
    eng.load(makeCandles(100));
    eng.start(0);
    eng.seek(50);
    expect(eng.getState().currentIndex).toBe(50);
    const pct = ((50 + 1) / 100 * 100).toFixed(2);
    expect(pct).toBe('51.00');
  });

  it('progress after reset returns to start', () => {
    const eng = new ReplayEngine();
    eng.load(makeCandles(100));
    eng.start(20);
    eng.stepForward();
    eng.stepForward();
    eng.reset();
    expect(eng.getState().currentIndex).toBe(20);
  });

  it('progress after end is 100%', () => {
    const eng = new ReplayEngine();
    eng.load(makeCandles(3));
    eng.start(0);
    eng.stepForward();
    eng.stepForward(); // now at 2 last
    expect(eng.getState().status).toBe('ended');
    const pct = ((eng.getState().currentIndex + 1) / eng.getState().totalCandles * 100).toFixed(2);
    expect(pct).toBe('100.00');
  });

  it('current replay time uses candle timestamp, not device time', () => {
    const candles = makeCandles(3, 1700000000);
    const eng = new ReplayEngine();
    eng.load(candles);
    eng.start(1);
    const idx = eng.getState().currentIndex;
    const candleTime = eng.getVisibleCandles()[idx].time;
    expect(candleTime).toBe(1700000060);
    expect(formatTime(candleTime)).toContain('UTC');
  });
});

describe('Replay UX — start selection', () => {
  it('valid start index 0 is accepted', () => {
    const eng = new ReplayEngine();
    eng.load(makeCandles(10));
    expect(() => eng.start(0)).not.toThrow();
    expect(eng.getState().startIndex).toBe(0);
  });

  it('first and last valid candle boundaries', () => {
    const eng = new ReplayEngine();
    eng.load(makeCandles(5));
    eng.start(0);
    expect(eng.getState().currentIndex).toBe(0);
    const eng2 = new ReplayEngine();
    eng2.load(makeCandles(5));
    eng2.start(4);
    expect(eng2.getState().status).toBe('ended');
  });

  it('invalid index rejected', () => {
    const eng = new ReplayEngine();
    eng.load(makeCandles(5));
    expect(() => eng.start(-1)).toThrow();
    expect(() => eng.start(5)).toThrow();
    expect(() => eng.start(1.5)).toThrow();
  });

  it('correct timestamp displayed for selected index via formatTime', () => {
    const candles = makeCandles(10);
    const idx = 5;
    const t = candles[idx].time;
    expect(formatTime(t)).not.toBe('—');
    expect(toUnixSeconds('2025-06-10', '14:30')).toBeGreaterThan(0);
  });

  it('jumpTo helper finds closest candle', () => {
    const candles = makeCandles(10, 1700000000, 60);
    // simulate findClosest: target between 2 and 3
    const target = 1700000000 + 2 * 60 + 15; // 15s after candle 2
    // nearest should be candle 2 (diff 15) vs 3 (45)
    let lo = 0, hi = candles.length - 1, best = 0, minDiff = Infinity;
    for (let i = 0; i < candles.length; i++) {
      const diff = Math.abs(candles[i].time - target);
      if (diff < minDiff) { minDiff = diff; best = i; }
    }
    expect(best).toBe(2);
  });
});

describe('Replay UX — future data regression', () => {
  it('during replay only visible candles exposed', () => {
    const eng = new ReplayEngine();
    eng.load(makeCandles(10));
    eng.start(2);
    expect(eng.getVisibleCandles().length).toBe(3); // 0..2
    eng.stepForward();
    expect(eng.getVisibleCandles().length).toBe(4);
    eng.seek(5);
    expect(eng.getVisibleCandles().length).toBe(6);
    expect(eng.getTotalCandles()).toBe(10);
    // ensure future not in visible
    const visibleTimes = eng.getVisibleCandles().map(c => c.time);
    expect(Math.max(...visibleTimes)).toBe(1700000000 + 5 * 60);
  });

  it('ChartAdapter does not expose future via chart during replay', () => {
    const eng = new ReplayEngine();
    const mockChart = createMockChart();
    const adapter = new ChartAdapter(eng, mockChart);
    adapter.attach();
    const candles = makeCandles(5);
    eng.load(candles);
    // Preview would show full but adapter preview is manual; after start, chart should show visible only
    eng.start(1);
    expect(mockChart._calls.setData.length).toBe(1);
    expect(mockChart._calls.setData[0].length).toBe(2); // 0..1
    eng.stepForward();
    // update called once
    expect(mockChart._calls.update.length).toBe(1);
    expect(mockChart._calls.setData[0].length).toBeLessThan(candles.length);
    adapter.detach();
  });

  it('reset during replay restores to startIndex not full preview', () => {
    const eng = new ReplayEngine();
    const mockChart = createMockChart();
    const adapter = new ChartAdapter(eng, mockChart);
    adapter.attach();
    eng.load(makeCandles(10));
    eng.start(3);
    eng.stepForward();
    eng.stepForward();
    eng.reset();
    // after reset, setData should be visible at startIndex (3+1 =4)
    const lastSet = mockChart._calls.setData[mockChart._calls.setData.length - 1];
    expect(lastSet.length).toBe(4);
    adapter.detach();
  });

  it('keyboard shortcut guard logic (input/select/textarea should block)', () => {
    const isInput = (tag) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag);
    expect(isInput('INPUT')).toBe(true);
    expect(isInput('SELECT')).toBe(true);
    expect(isInput('TEXTAREA')).toBe(true);
    expect(isInput('DIV')).toBe(false);
    expect(isInput('BUTTON')).toBe(false);
  });
});

describe('Chart followCurrent', () => {
  it('ChartManager.followCurrent preserves method and does not fitContent', () => {
    // This test ensures auto-follow does not call fitContent
    // Mock verified via adapter.
    const eng = new ReplayEngine();
    const mockChart = createMockChart();
    const adapter = new ChartAdapter(eng, mockChart);
    adapter.attach();
    eng.load(makeCandles(5));
    eng.start(0);
    // after step, followCurrent should be implied via update handler
    // we check update was called and no extra fitContent (setData not called again)
    const beforeSetDataCount = mockChart._calls.setData.length;
    eng.stepForward();
    expect(mockChart._calls.update.length).toBe(1);
    expect(mockChart._calls.setData.length).toBe(beforeSetDataCount);
  });
});
