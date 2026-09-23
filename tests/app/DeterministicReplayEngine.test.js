import { describe, expect, it, vi } from 'vitest';
import { DeterministicReplayEngine } from '../../src/app/DeterministicReplayEngine.js';

const candles = Array.from({ length: 6 }, (_, i) => ({
  time: (i + 1) * 60, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10,
}));

describe('DeterministicReplayEngine', () => {
  it('loads the complete dataset and starts at the selected candle', async () => {
    const engine = new DeterministicReplayEngine();
    await engine.loadDataset(candles);
    expect(engine.getTotalCandles()).toBe(6);
    expect(engine.getState().currentIndex).toBe(-1);
    await engine.start(3);
    expect(engine.getState()).toMatchObject({ status: 'paused', currentIndex: 3, startIndex: 3, totalCandles: 6 });
    expect(engine.getVisibleCandles()).toHaveLength(4);
  });

  it('steps exactly one candle with no network dependency', async () => {
    const onCandle = vi.fn();
    const engine = new DeterministicReplayEngine({ onCandle, symbolProvider: () => 'SOLUSDT' });
    await engine.loadDataset(candles);
    await engine.start(1);
    await engine.stepForward();
    expect(engine.getState().currentIndex).toBe(2);
    expect(onCandle).toHaveBeenLastCalledWith(expect.objectContaining({ index: 2, symbol: 'SOLUSDT' }));
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
