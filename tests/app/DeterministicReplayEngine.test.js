import { describe, expect, it, vi } from 'vitest';
import { DeterministicReplayEngine } from '../../src/app/DeterministicReplayEngine.js';

class TestCandleStore {
  constructor() { this.candles = []; this.symbol = null; }
  load(candles, metadata = {}) { this.candles = candles.map((c) => ({ ...c })); this.symbol = metadata.symbol || null; }
  clear() { this.candles = []; this.symbol = null; }
  getCount() { return this.candles.length; }
  get(index) { return this.candles[index] ? { ...this.candles[index] } : null; }
  getTimes() { return this.candles.map((c) => c.time); }
  getSymbol() { return this.symbol; }
  sliceWindow(start, end) { return this.candles.slice(start, end + 1).map((c) => ({ ...c })); }
}

const candles = Array.from({ length: 6 }, (_, i) => ({
  time: (i + 1) * 60, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10,
}));

describe('DeterministicReplayEngine', () => {
  it('loads the complete dataset and starts at the selected candle', async () => {
    const engine = new DeterministicReplayEngine({ candleStore: new TestCandleStore() });
    await engine.loadDataset(candles, { metadata: { symbol: 'BTCUSDT' } });
    expect(engine.getTotalCandles()).toBe(6);
    expect(engine.getState().currentIndex).toBe(-1);
    await engine.start(3);
    expect(engine.getState()).toMatchObject({ status: 'paused', currentIndex: 3, startIndex: 3, totalCandles: 6 });
    expect(engine.getVisibleCandles()).toHaveLength(4);
    expect(engine.getTimelineTimes()).toEqual([60, 120, 180, 240, 300, 360]);
  });

  it('awaits the candle processor before advancing', async () => {
    let resolveCandle;
    const onCandle = vi.fn(() => new Promise((resolve) => { resolveCandle = resolve; }));
    const engine = new DeterministicReplayEngine({ candleStore: new TestCandleStore(), onCandle });
    await engine.loadDataset(candles);
    const startPromise = engine.start(1);
    await Promise.resolve();
    expect(onCandle).toHaveBeenCalledOnce();
    expect(engine.getState().currentIndex).toBe(1);
    resolveCandle();
    await startPromise;

    let stepResolved = false;
    const step = engine.stepForward();
    await Promise.resolve();
    expect(engine.getState().currentIndex).toBe(2);
    expect(stepResolved).toBe(false);
    resolveCandle = () => { stepResolved = true; };
    await step;
    expect(stepResolved).toBe(true);
  });

  it('clears stale candles when an empty dataset is loaded', async () => {
    const store = new TestCandleStore();
    const engine = new DeterministicReplayEngine({ candleStore: store });
    await engine.loadDataset(candles);
    expect(engine.getTotalCandles()).toBe(6);
    await engine.loadDataset([]);
    expect(engine.getTotalCandles()).toBe(0);
    expect(engine.getState().status).toBe('idle');
  });

  it('steps exactly one candle with no ordering race', async () => {
    const seen = [];
    const engine = new DeterministicReplayEngine({
      candleStore: new TestCandleStore(),
      symbolProvider: () => 'SOLUSDT',
      onCandle: async ({ index, symbol }) => { seen.push({ index, symbol }); },
    });
    await engine.loadDataset(candles);
    await engine.start(1);
    await engine.stepForward();
    expect(seen).toEqual([{ index: 1, symbol: 'SOLUSDT' }, { index: 2, symbol: 'SOLUSDT' }]);
  });

  it('prefers loaded dataset symbol over mutable application state', async () => {
    const seen = [];
    const provider = vi.fn(() => 'ETHUSDT');
    const engine = new DeterministicReplayEngine({
      candleStore: new TestCandleStore(),
      symbolProvider: provider,
      onCandle: ({ symbol }) => { seen.push(symbol); },
    });
    await engine.loadDataset(candles, { metadata: { symbol: 'BTCUSDT' } });
    await engine.start(0);
    expect(seen).toEqual(['BTCUSDT']);
    expect(provider).not.toHaveBeenCalled();
  });

  it('seeks deterministically without altering the dataset', async () => {
    const engine = new DeterministicReplayEngine();
    await engine.loadDataset(candles);
    await engine.start(1);
    await engine.seek(4);
    expect(engine.getState().currentIndex).toBe(4);
    expect(engine.getState().candle.time).toBe(300);
    expect(engine.getTotalCandles()).toBe(6);
  });

  it('never exposes candles after the replay cursor', async () => {
    const engine = new DeterministicReplayEngine();
    await engine.loadDataset(candles);
    await engine.start(1);
    const visible = engine.getVisibleCandles();
    expect(visible.map((c) => c.time)).toEqual([60, 120]);
  });

  it('resets to ready without losing the chosen start index', async () => {
    const engine = new DeterministicReplayEngine();
    await engine.loadDataset(candles);
    await engine.start(2);
    await engine.stepForward();
    await engine.reset();
    expect(engine.getState()).toMatchObject({ status: 'ready', currentIndex: -1, startIndex: 2, totalCandles: 6 });
  });

  it('ends cleanly at the final candle', async () => {
    const engine = new DeterministicReplayEngine();
    await engine.loadDataset(candles);
    await engine.start(5);
    expect(engine.getState().status).toBe('ended');
    await engine.stepForward();
    expect(engine.getState().currentIndex).toBe(5);
  });

  it('changes playback speed without changing the cursor', async () => {
    const engine = new DeterministicReplayEngine();
    await engine.loadDataset(candles);
    await engine.start(2);
    engine.setSpeed(5);
    expect(engine.getState()).toMatchObject({ currentIndex: 2, speed: 5 });
  });
});
