import { describe, it, expect } from 'vitest';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { ReplayStatus } from '../src/replay/ReplayState.js';
import { ChartAdapter } from '../src/chart/ChartAdapter.js';

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

describe('Audit regression: mutation isolation', () => {
  it('load clones candles: mutating original does not affect engine', () => {
    const e = new ReplayEngine();
    const orig = makeCandles(5);
    e.load(orig);
    orig[0].close = 9999;
    e.start(0);
    expect(e.getVisibleCandles()[0].close).not.toBe(9999);
  });
  it('getVisibleCandles returns clones', () => {
    const e = new ReplayEngine();
    e.load(makeCandles(5));
    e.start(2);
    const vis = e.getVisibleCandles();
    vis[0].close = 12345;
    expect(e.getVisibleCandles()[0].close).not.toBe(12345);
  });
  it('event payload mutation does not corrupt engine', () => {
    const e = new ReplayEngine();
    e.load(makeCandles(5));
    e.start(0);
    e.on('marketCandle', ({candle})=> { candle.close = 7777; });
    const before = e.getVisibleCandles()[1]?.close; // not yet revealed
    e.stepForward();
    expect(e.getVisibleCandles()[1].close).not.toBe(7777);
  });
});

describe('Audit regression: future leak through events', () => {
  it('SEEKED visibleCandles never contains future', () => {
    const e = new ReplayEngine();
    const candles = makeCandles(20);
    e.load(candles);
    e.start(5);
    let payload = null;
    e.on('seeked', p=> payload = p);
    e.seek(10);
    expect(payload.visibleCandles.length).toBe(11);
    expect(payload.visibleCandles.every(c=> c.time <= candles[10].time)).toBe(true);
  });
  it('MARKET_CANDLE never exposes future', () => {
    const e = new ReplayEngine();
    const candles = makeCandles(10);
    e.load(candles);
    e.start(5);
    const seen = [];
    e.on('marketCandle', ({index})=> seen.push(index));
    e.stepForward();
    e.stepForward();
    expect(seen.every(idx => idx <= e.getState().currentIndex)).toBe(true);
    expect(e.getVisibleCandles().length).toBe(e.getState().currentIndex+1);
    expect(e.getVisibleCandles().length).toBeLessThan(candles.length); // not full
  });
});

describe('Audit regression: timer / rapid sequences', () => {
  it('rapid play/pause/setSpeed does not create duplicate timers', async () => {
    const e = new ReplayEngine();
    e.load(makeCandles(20));
    e.start(0);
    e.setSpeed(10);
    e.play(); e.play(); e.pause(); e.play(); e.setSpeed(5); e.pause(); e.play();
    await new Promise(r=>setTimeout(r, 350));
    const idx = e.getState().currentIndex;
    // At 5x (200ms per candle) for 350ms after final play => 1-2 ticks
    expect(idx).toBeGreaterThanOrEqual(1);
    expect(idx).toBeLessThanOrEqual(4);
    e.pause();
    const after = e.getState().currentIndex;
    await new Promise(r=>setTimeout(r, 200));
    expect(e.getState().currentIndex).toBe(after);
  });
  it('stale timer does not fire after pause', async () => {
    const e = new ReplayEngine();
    e.load(makeCandles(20));
    e.start(0);
    e.setSpeed(10);
    e.play();
    await new Promise(r=>setTimeout(r, 50));
    e.pause();
    const idx = e.getState().currentIndex;
    await new Promise(r=>setTimeout(r, 300));
    expect(e.getState().currentIndex).toBe(idx);
  });
  it('seek while playing stops timer', async () => {
    const e = new ReplayEngine();
    e.load(makeCandles(20));
    e.start(0);
    e.setSpeed(10);
    e.play();
    await new Promise(r=>setTimeout(r, 120));
    e.seek(5);
    expect(e.getState().status).toBe(ReplayStatus.PAUSED);
    const after = e.getState().currentIndex;
    await new Promise(r=>setTimeout(r, 250));
    expect(e.getState().currentIndex).toBe(after);
  });
  it('reset while playing stops timer', async () => {
    const e = new ReplayEngine();
    e.load(makeCandles(20));
    e.start(2);
    e.setSpeed(10);
    e.play();
    await new Promise(r=>setTimeout(r, 120));
    const startIdx = e.getState().startIndex;
    e.reset();
    expect(e.getState().currentIndex).toBe(startIdx);
    expect(e.getState().status).toBe(ReplayStatus.PAUSED);
    const after = e.getState().currentIndex;
    await new Promise(r=>setTimeout(r, 250));
    expect(e.getState().currentIndex).toBe(after);
  });
  it('reload while playing clears timer and resets state', async () => {
    const e = new ReplayEngine();
    e.load(makeCandles(20));
    e.start(0);
    e.setSpeed(10);
    e.play();
    await new Promise(r=>setTimeout(r, 120));
    e.load(makeCandles(10, 1800000000));
    expect(e.getState().status).toBe(ReplayStatus.READY);
    expect(e.getState().currentIndex).toBe(-1);
    // ensure old timer not firing
    await new Promise(r=>setTimeout(r, 250));
    expect(e.getState().currentIndex).toBe(-1);
  });
});

describe('Audit regression: listener error isolation', () => {
  it('exception in one listener does not stop others', () => {
    const e = new ReplayEngine();
    e.load(makeCandles(5));
    e.start(0);
    let second = false;
    e.on('marketCandle', ()=> { throw new Error('boom'); });
    e.on('marketCandle', ()=> { second = true; });
    e.stepForward();
    expect(second).toBe(true);
  });
});

describe('Audit regression: repeated load and state', () => {
  it('repeated load resets currentIndex and startIndex', () => {
    const e = new ReplayEngine();
    e.load(makeCandles(10));
    e.start(5);
    e.stepForward();
    expect(e.getState().currentIndex).toBe(6);
    e.load(makeCandles(8, 1800000000));
    expect(e.getState().currentIndex).toBe(-1);
    expect(e.getState().startIndex).toBe(-1);
    expect(e.getState().totalCandles).toBe(8);
  });
});

describe('Audit regression: chart subscription duplication', () => {
  it('ChartAdapter SEEKED does not duplicate update', () => {
    let setDataCalls = 0; let updateCalls = 0;
    const mockChart = { setData(){ setDataCalls++; }, update(){ updateCalls++; }, clear(){}, destroy(){} };
    const e = new ReplayEngine();
    e.load(makeCandles(10));
    const adapter = new ChartAdapter(e, mockChart);
    adapter.attach();
    e.start(0);
    expect(setDataCalls).toBe(1);
    expect(updateCalls).toBe(0);
    setDataCalls=0; updateCalls=0;
    e.seek(5);
    expect(setDataCalls).toBe(1);
    expect(updateCalls).toBe(0);
    setDataCalls=0; updateCalls=0;
    e.reset();
    expect(setDataCalls).toBe(1);
    expect(updateCalls).toBe(0);
    adapter.detach();
  });
  it('detach removes listeners (no further chart updates)', () => {
    let updateCalls = 0;
    const mockChart = { setData(){}, update(){ updateCalls++; }, clear(){}, destroy(){} };
    const e = new ReplayEngine();
    e.load(makeCandles(10));
    const adapter = new ChartAdapter(e, mockChart);
    adapter.attach();
    e.start(0);
    adapter.detach();
    updateCalls=0;
    e.stepForward();
    expect(updateCalls).toBe(0);
  });
});
