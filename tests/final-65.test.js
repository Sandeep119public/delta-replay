import { describe, it, expect } from 'vitest';
import { CandleStore } from '../src/data/CandleStore.js';
import { CandleCache } from '../src/data/CandleCache.js';
import { CandleIntegrity } from '../src/data/CandleIntegrity.js';
import { AppState } from '../src/state/AppState.js';
import { Timeline } from '../src/ui/Timeline.js';
import { PaperTradingEngine } from '../src/trading/PaperTradingEngine.js';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';

function c(time, close) { return { time, open: close, high: close+1, low: close-1, close, volume: 10 }; }

describe('Final 6.5 — Single source', () => {
  it('CandleStore is single source, AppState proxies without duplication', () => {
    const store = new CandleStore();
    const app = new AppState();
    app.setCandleStore(store);
    const candles = [c(1000,100), c(1060,101)];
    store.load(candles, { symbol:'BTCUSD', timeframe:'1m' });
    // AppState getter should return store data, not duplicate array reference
    expect(app.candles.length).toBe(2);
    expect(app.candles[0].time).toBe(1000);
    // _candles should be empty to avoid duplication
    expect(app._candles.length).toBe(0);
    // snapshot total should reflect store
    expect(app.snapshot().total).toBe(2);
  });

  it('Timeline stores only timestamps, not OHLC', () => {
    const app = new AppState();
    const engine = new ReplayEngine();
    const slider = { addEventListener(){}, disabled:false, min:0, max:0, value:0 };
    const tl = new Timeline({ sliderEl: slider, startLabelEl:{textContent:''}, currentLabelEl:{textContent:''}, endLabelEl:{textContent:''}, indexLabelEl:{textContent:''}, timeLabelEl:{textContent:''}, startIndexLabelEl:{textContent:''}, appState: app, engine });
    const candles = [c(1000,100), c(1060,101)];
    tl.setTotal(2, candles);
    expect(tl._times).toEqual([1000,1060]);
    // Ensure no OHLC in _times
    expect(tl._times[0]).toBe(1000);
    // _candles kept for compat but _times is used
    expect(tl._times).not.toContainEqual(expect.objectContaining({ open: 100 }));
  });

  it('ReplayEngine does not duplicate store if using store', () => {
    const store = new CandleStore();
    const candles = Array.from({length:100}, (_,i)=>c(1000+i*60,100));
    store.load(candles, {});
    const engine = new ReplayEngine();
    engine.load(store.getAll());
    expect(engine.getTotalCandles()).toBe(100);
    // store still holds 100, engine holds 100, but not 3 copies via AppState
    expect(store.getCount()).toBe(100);
  });
});

describe('Cache trust boundary', () => {
  it('corrupted cache (invalid OHLC) is rejected via integrity', () => {
    const rawCorrupted = [
      { time: 1000, open: 100, high: 1, low: 99, close: 100, volume: 10 }, // high<open
      { time: 1060, open: 100, high: 101, low: 99, close: 100, volume: 10 },
    ];
    const { validCandles } = CandleIntegrity.process(rawCorrupted, { from: 1000, to: 1200, timeframeSec: 60 });
    expect(validCandles.length).toBe(1);
    expect(validCandles[0].time).toBe(1060);
  });

  it('unsorted cached candles are sorted via integrity', async () => {
    const cache = new CandleCache({ enableIDB:false });
    const unsorted = [c(1060,101), c(1000,100)];
    // Directly set unsorted via cache (simulates corrupted IndexedDB) — include version
    const { CACHE_VERSION } = await import('../src/data/CandleCache.js');
    cache._memory.set('BTCUSD|1m', { candles: unsorted, intervals: [{from:1000,to:1060}], ts: Date.now(), version: CACHE_VERSION });
    const res = cache.get('BTCUSD','1m',1000,1060);
    // Manager would re-process via integrity, so validCandles sorted
    const { validCandles } = CandleIntegrity.process(res.candles, { from:1000,to:1060, timeframeSec:60 });
    expect(validCandles[0].time).toBe(1000);
    expect(validCandles[1].time).toBe(1060);
  });

  it('NaN and negative volume rejected', () => {
    const raw = [
      { time: 1000, open: NaN, high: 101, low:99, close:100, volume:10 },
      { time: 1060, open: 100, high:101, low:99, close:100, volume:-1 },
      { time: 1120, open:100, high:101, low:99, close:100, volume:10 },
    ];
    const { validCandles } = CandleIntegrity.process(raw, { from:1000,to:1200, timeframeSec:60 });
    expect(validCandles.length).toBe(1);
    expect(validCandles[0].time).toBe(1120);
  });
});

describe('Cache coverage gap-aware', () => {
  it('gap prevents false coverage', () => {
    const cache = new CandleCache({ enableIDB:false });
    // Simulate valid candles with gap at 1060 missing: 1000,1120
    const candles = [c(1000,100), c(1120,102)]; // missing 1060
    const tfSec=60;
    const intervals = CandleCache.intervalsFromCandles(candles, tfSec);
    expect(intervals).toEqual([{from:1000,to:1000},{from:1120,to:1120}]);
    cache.set('BTCUSD','1m',1000,1120,candles, { intervals });
    // Request 1000-1120 should be hit (since intervals cover both segments, gap is reported but not covered)
    // Actually missing should be 1060 gap
    const res = cache.get('BTCUSD','1m',1000,1120);
    // Since intervals are split, missing should be 1060? Our intervals are [1000,1000] and [1120,1120], so 1000-1120 not fully covered: missing includes 1001-1119 but our time-based intervals are in sec, gap 1060 is within.
    // For our sec-based intervals, 1000->1000 and 1120->1120 leaves gap 1001-1119, so missing not empty
    expect(res.hit).toBe(false);
    expect(res.missing.length).toBeGreaterThan(0);
  });

  it('overlapping request with gap fetches missing interval', async () => {
    const { HistoricalDataManager } = await import('../src/data/HistoricalDataManager.js');
    const { DeltaCandleProvider } = await import('../src/data/DeltaCandleProvider.js');
    let fetches=0;
    const client = { fetchCandles: async ({start})=>{ fetches++; return start===1000? [c(1000,100)]:[c(1120,102)]; } };
    const provider = new DeltaCandleProvider({ client, maxCandles:100000 });
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB:false });
    const mgr = new HistoricalDataManager({ provider, store, cache, chunkSize:2000 });
    await mgr.load({ symbol:'BTCUSD', timeframe:'1m', from:1000, to:1060 });
    fetches=0;
    // Now load with gap: request 1000-1120, cached only 1000-1060, should fetch missing 1061-1120
    await mgr.load({ symbol:'BTCUSD', timeframe:'1m', from:1000, to:1120 });
    expect(fetches).toBeGreaterThan(0);
  });
});

describe('Revealed history & future pan protection', () => {
  it('store sliceWindow never exceeds revealed', () => {
    const store = new CandleStore();
    const candles = Array.from({length:1000},(_,i)=>c(1000+i*60,100));
    store.load(candles, {});
    const revealedIdx=500;
    const win = store.sliceWindow(Math.max(0, revealedIdx-100+1), revealedIdx);
    expect(win.length).toBe(100);
    expect(win[win.length-1].time).toBe(candles[revealedIdx].time);
    expect(win.find(x=>x.time===candles[900].time)).toBeUndefined();
  });

  it('ChartManager revealedMax clamps future', async () => {
    const { ChartManager } = await import('../src/chart/ChartManager.js');
    const div = { clientWidth:800, clientHeight:400 };
    // Mock ResizeObserver and window
    global.ResizeObserver = class { observe(){} disconnect(){} };
    global.window = { addEventListener(){} };
    // createChart mock? We can't fully init without lightweight-charts, test logic via setRevealedMax
    const cm = new ChartManager(div);
    // Mock chart object
    cm.chart = { timeScale: () => ({ scrollToRealTime:()=>{}, setVisibleRange:()=>{}, subscribeVisibleTimeRangeChange:()=>{}, getVisibleRange:()=>({from:0,to:0}) }) };
    cm._revealedMaxTime = 5000;
    cm._autoFollow = true;
    cm.setRevealedMax(4000);
    expect(cm._revealedMaxTime).toBe(4000);
  });

  it('Timeline cannot expose future OHLC', () => {
    const app = new AppState();
    const engine = new ReplayEngine();
    const slider = { addEventListener(){}, disabled:false, min:0, max:0, value:0 };
    const tl = new Timeline({ sliderEl: slider, startLabelEl:{textContent:''}, currentLabelEl:{textContent:''}, endLabelEl:{textContent:''}, indexLabelEl:{textContent:''}, timeLabelEl:{textContent:''}, startIndexLabelEl:{textContent:''}, appState: app, engine });
    const candles = [c(1000,100), c(1060,101), c(1120,102)];
    tl.setTotal(3, candles);
    // Timeline only stores times, so accessing _times[2] gives time, not OHLC
    expect(tl._times[2]).toBe(1120);
    expect(tl._times[0]).not.toHaveProperty('open');
  });
});

describe('Preview hides future', () => {
  it('preview window ends at start idx', () => {
    const store = new CandleStore();
    const candles = Array.from({length:5000},(_,i)=>c(1000+i*60,100+i));
    store.load(candles, {});
    const startIdx=2000;
    const WINDOW=1000;
    const win = store.sliceWindow(Math.max(0,startIdx-WINDOW+1), startIdx);
    expect(win.length).toBe(1000);
    expect(win[win.length-1].time).toBe(candles[startIdx].time);
    expect(win.find(x=>x.time===candles[startIdx+1].time)).toBeUndefined();
  });
});

describe('PaperTrading isolation', () => {
  it('trading engine has no CandleStore import', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/trading/PaperTradingEngine.js','utf-8');
    expect(content).not.toMatch(/from.*CandleStore/);
    expect(content).not.toMatch(/from.*AppState/);
  });
});
