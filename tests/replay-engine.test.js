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
    bad[2] = { ...bad[2], high: 1 };
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
    e.setSpeed(10);
    e.play();
    expect(e.getState().status).toBe(ReplayStatus.PLAYING);
    await new Promise(r => setTimeout(r, 250));
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
    e.play();
    e.play();
    await new Promise(r => setTimeout(r, 250));
    const idx = e.getState().currentIndex;
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
    e.stepForward();
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

  it('action guards block state-changing navigation and can be removed', () => {
    const e = new ReplayEngine();
    e.load(makeCandles(10));
    e.start(2);
    const before = e.getState();
    const seen = [];
    const unregister = e.registerActionGuard((action) => {
      seen.push(action);
      return { allowed: false, reason: `${action} blocked for test` };
    });

    expect(e.seek(7)).toEqual(before);
    expect(e.getState().currentIndex).toBe(2);
    expect(seen).toContain('seek');

    unregister();
    expect(e.seek(7).currentIndex).toBe(7);
  });

  it('guard exceptions fail closed without mutating state', () => {
    const e = new ReplayEngine();
    e.load(makeCandles(10));
    e.start(2);
    const before = e.getState();
    e.registerActionGuard(() => { throw new Error('guard exploded'); });

    expect(e.reset()).toEqual(before);
    expect(e.getState()).toEqual(before);
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
    order.length = 0;
    e.start(2);
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
