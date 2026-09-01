import { describe, it, expect, vi } from 'vitest';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { ReplayStatus } from '../src/replay/ReplayState.js';

function makeCandles(n, start = 1700000000) {
  const arr = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const time = start + i * 60;
    const open = p;
    const close = p + 1;
    const high = Math.max(open, close) + 0.5;
    const low = Math.min(open, close) - 0.5;
    arr.push({ time, open, high, low, close, volume: 10 });
    p = close;
  }
  return arr;
}

describe('ReplayEngine', () => {
  it('load valid candles', () => {
    const e = new ReplayEngine();
    const candles = makeCandles(10);
    e.load(candles);
    expect(e.getState().status).toBe(ReplayStatus.READY);
    expect(e.getTotalCandles()).toBe(10);
    expect(e.getVisibleCandles()).toEqual([]);
  });

  it('reject invalid candles', () => {
    const e = new ReplayEngine();
    const bad = makeCandles(5);
    bad[2] = { ...bad[2], high: 1 }; // high < open
    expect(() => e.load(bad)).toThrow(/Invalid candle/);
  });

  it('reject invalid start index', () => {
    const e = new ReplayEngine();
    e.load(makeCandles(10));
    expect(() => e.start(-1)).toThrow();
    expect(() => e.start(10)).toThrow();
    expect(() => e.start(1.5)).toThrow();
  });

  it('future candles not exposed via getVisibleCandles', () => {
    const e = new ReplayEngine();
    const candles = makeCandles(100);
    e.load(candles);
    e.start(50);
    expect(e.getVisibleCandles().length).toBe(51);
    expect(e.getVisibleCandles()[50].time).toBe(candles[50].time);
    // ensure future not exposed
    expect(e.getVisibleCandles().every(c => c.time <= candles[50].time)).toBe(true);
  });

  it('step reveals exactly one candle', () => {
    const e = new ReplayEngine();
    e.load(makeCandles(10));
    e.start(5);
    expect(e.getState().currentIndex).toBe(5);
    e.stepForward();
    expect(e.getState().currentIndex).toBe(6);
    expect(e.getVisibleCandles().length).toBe(7);
    e.stepForward();
    expect(e.getState().currentIndex).toBe(7);
  });

  it('play advances candles', async () => {
    const e = new ReplayEngine();
    e.load(makeCandles(10));
    e.start(0);
    e.setSpeed(10); // 10 candles/sec => 100ms per candle
    e.play();
    expect(e.getState().status).toBe(ReplayStatus.PLAYING);
    await new Promise(r => setTimeout(r, 250));
    // should have advanced at least 2 candles
    expect(e.getState().currentIndex).toBeGreaterThan(1);
    e.pause();
  });

  it('pause stops advancement', async () => {
    const e = new ReplayEngine();
    e.load(makeCandles(20));
    e.start(0);
    e.setSpeed(10);
    e.play();
    await new Promise(r => setTimeout(r, 150));
    e.pause();
    const idx = e.getState().currentIndex;
    await new Promise(r => setTimeout(r, 200));
    expect(e.getState().currentIndex).toBe(idx);
    expect(e.getState().status).toBe(ReplayStatus.PAUSED);
  });

  it('calling play twice does not create duplicate loops', async () => {
    const e = new ReplayEngine();
    e.load(makeCandles(20));
    e.start(0);
    e.setSpeed(10);
    e.play();
    e.play(); // second call idempotent
    e.play();
    await new Promise(r => setTimeout(r, 250));
    const idx = e.getState().currentIndex;
    // At 10x, ~2-3 ticks in 250ms. If duplicate timers, would be ~4-6. Check <5
    expect(idx).toBeLessThan(5);
    expect(idx).toBeGreaterThanOrEqual(2);
    e.pause();
  });

  it('replay ends correctly at final candle', async () => {
    const e = new ReplayEngine();
    e.load(makeCandles(3));
    e.start(0);
    e.setSpeed(10);
    let ended = false;
    e.on('ended', () => ended = true);
    e.play();
    await new Promise(r => setTimeout(r, 400));
    expect(e.getState().status).toBe(ReplayStatus.ENDED);
    expect(ended).toBe(true);
    expect(e.getState().currentIndex).toBe(2);
  });

  it('cannot step beyond final candle', () => {
    const e = new ReplayEngine();
    e.load(makeCandles(3));
    e.start(2);
    expect(e.getState().status).toBe(ReplayStatus.ENDED);
    const before = e.getState().currentIndex;
    e.stepForward(); // should stay at end
    expect(e.getState().currentIndex).toBe(before);
    expect(e.getState().status).toBe(ReplayStatus.ENDED);
  });

  it('seek works correctly', () => {
    const e = new ReplayEngine();
    e.load(makeCandles(10));
    e.start(5);
    e.seek(2);
    expect(e.getState().currentIndex).toBe(2);
    expect(e.getVisibleCandles().length).toBe(3);
    e.seek(9);
    expect(e.getState().status).toBe(ReplayStatus.ENDED);
  });

  it('reset restores to startIndex', () => {
    const e = new ReplayEngine();
    e.load(makeCandles(10));
    e.start(5);
    e.stepForward();
    e.stepForward();
    expect(e.getState().currentIndex).toBe(7);
    e.reset();
    expect(e.getState().currentIndex).toBe(5);
    expect(e.getState().status).toBe(ReplayStatus.PAUSED);
  });

  it('speed validation', () => {
    const e = new ReplayEngine();
    e.load(makeCandles(5));
    e.start(0);
    expect(() => e.setSpeed(3)).toThrow(/Invalid speed/);
    expect(() => e.setSpeed(0)).toThrow();
    e.setSpeed(5);
    expect(e.getState().speed).toBe(5);
  });

  it('events fire in correct order', () => {
    const e = new ReplayEngine();
    const order = [];
    e.on('loaded', () => order.push('loaded'));
    e.on('started', () => order.push('started'));
    e.on('marketCandle', () => order.push('marketCandle'));
    e.on('stateChanged', () => order.push('stateChanged'));
    e.load(makeCandles(5));
    // clear
    order.length = 0;
    e.start(2);
    // started -> marketCandle -> stateChanged (plus loaded already)
    expect(order[0]).toBe('started');
    expect(order).toContain('marketCandle');
    expect(order[order.length - 1]).toBe('stateChanged');
  });

  it('no progression after ended', async () => {
    const e = new ReplayEngine();
    e.load(makeCandles(3));
    e.start(2);
    expect(e.getState().status).toBe(ReplayStatus.ENDED);
    e.play();
    expect(e.getState().status).toBe(ReplayStatus.ENDED);
    await new Promise(r => setTimeout(r, 150));
    expect(e.getState().currentIndex).toBe(2);
  });
});
