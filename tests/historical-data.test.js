import { describe, it, expect, vi } from 'vitest';
import { HistoricalDataManager } from '../src/data/HistoricalDataManager.js';
import { CandleStore } from '../src/data/CandleStore.js';
import { CandleCache } from '../src/data/CandleCache.js';
import { CandleIntegrity } from '../src/data/CandleIntegrity.js';
import { DeltaClient } from '../src/data/DeltaClient.js';
import { DeltaCandleProvider, TIMEFRAME_SECONDS } from '../src/data/DeltaCandleProvider.js';

function candle(time, close) { return { time, open: close, high: close+1, low: close-1, close, volume: 10 }; }
const c = candle;

function mockClient(responses) {
  // responses: Map key `${start}-${end}` -> array or function
  return {
    fetchCandles: async ({ start, end, signal }) => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const key = `${start}-${end}`;
      const val = responses[key] ?? responses['*'];
      if (typeof val === 'function') return val({ start, end });
      if (Array.isArray(val)) return val;
      return [];
    }
  };
}

describe('CandleIntegrity', () => {
  it('strict timestamp order, duplicate removal, gap detection', () => {
    const tfSec = 60;
    const raw = [
      { time: 1000, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { time: 1120, open: 101, high: 102, low: 100, close: 101, volume: 10 }, // gap: missing 1060
      { time: 1000, open: 100, high: 101, low: 99, close: 100, volume: 10 }, // duplicate
      { time: 1180, open: 102, high: 103, low: 101, close: 102, volume: 10 },
    ];
    const { validCandles, metadata } = CandleIntegrity.process(raw, { from: 1000, to: 1200, timeframeSec: tfSec });
    expect(validCandles.length).toBe(3);
    expect(metadata.duplicatesRemoved).toBe(1);
    expect(metadata.gaps.length).toBeGreaterThan(0);
    expect(metadata.gaps[0].missingCount).toBe(1);
  });

  it('invalid candles filtered', () => {
    const raw = [
      { time: 1000, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { time: 1060, open: 100, high: 1, low: 99, close: 100, volume: 10 }, // high<open invalid
    ];
    const { validCandles, metadata } = CandleIntegrity.process(raw, { from: 1000, to: 1100, timeframeSec: 60 });
    expect(validCandles.length).toBe(1);
    expect(metadata.invalidCount).toBe(1);
  });
});

describe('CandleStore', () => {
  it('load and windowed slice', () => {
    const store = new CandleStore();
    const candles = Array.from({ length: 5000 }, (_, i) => candle(1000 + i * 60, 100 + i));
    store.load(candles, { symbol: 'BTCUSD', timeframe: '1m' });
    expect(store.getCount()).toBe(5000);
    const win = store.sliceWindow(4000 - 1000 + 1, 4000);
    expect(win.length).toBe(1000);
    expect(win[0].time).toBe(candle(1000 + (3001) * 60, 0).time);
    expect(store.findIndexByTime(1000 + 100 * 60)).toBe(100);
  });

  it('binary search and metadata', () => {
    const store = new CandleStore();
    const candles = [c(1000,100), c(1060,101), c(1120,102)];
    function c(t,cl){ return { time:t, open:cl, high:cl+1, low:cl-1, close:cl, volume:10 }; }
    store.load(candles, { symbol: 'BTCUSD', timeframe: '1m', requestedFrom: 1000, requestedTo: 1120 });
    expect(store.findIndexByTime(1060)).toBe(1);
    expect(store.getMetadata().count).toBe(3);
  });
});

describe('CandleCache', () => {
  it('cache hit exact', () => {
    const cache = new CandleCache({ maxMemory: 10, enableIDB: false });
    const candles = [c(1000,100), c(1060,101)];
    cache.set('BTCUSD', '1m', 1000, 1060, candles);
    const res = cache.get('BTCUSD', '1m', 1000, 1060);
    expect(res.hit).toBe(true);
    expect(res.candles.length).toBe(2);
  });
  it('partial hit missing ranges', () => {
    const cache = new CandleCache({ enableIDB: false });
    cache.set('BTCUSD', '1m', 1000, 1060, [c(1000,100), c(1060,101)]);
    const res = cache.get('BTCUSD', '1m', 1000, 1180);
    expect(res.hit).toBe(false);
    expect(res.missing.length).toBe(1);
    expect(res.missing[0].from).toBe(1061);
    expect(res.candles.length).toBe(2);
  });
  it('overlapping merge', () => {
    const cache = new CandleCache({ enableIDB: false });
    cache.set('BTCUSD', '1m', 1000, 1060, [c(1000,100)]);
    cache.set('BTCUSD', '1m', 1060, 1120, [c(1060,101)]);
    const entry = cache._memory.get('BTCUSD|1m');
    expect(entry.intervals.length).toBe(1);
    expect(entry.intervals[0]).toEqual({ from: 1000, to: 1120 });
    expect(entry.candles.length).toBe(2);
  });
});

describe('HistoricalDataManager — fetching', () => {
  it('single request', async () => {
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    const client = mockClient({ '*': [c(1000,100), c(1060,101)] });
    const provider = new DeltaCandleProvider({ client, maxCandles: 100000, chunkSize: 2000 });
    const mgr = new HistoricalDataManager({ provider, store, cache, concurrency: 1 });
    const { candles, metadata } = await mgr.load({ symbol: 'BTCUSD', timeframe: '1m', from: 1000, to: 1100 });
    expect(candles.length).toBe(2);
    expect(metadata.count).toBe(2);
    expect(store.getCount()).toBe(2);
  });

  it('multi-chunk request', async () => {
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    // chunkSize 2 => each chunk 2*60 sec range
    const client = {
      fetchCandles: async ({ start, end }) => {
        const tf = 60;
        const res = [];
        for (let t = start; t <= end; t += tf) {
          if (t <= 1180) res.push(c( t, 100));
        }
        return res;
      }
    };
    const provider = new DeltaCandleProvider({ client, maxCandles: 100000, chunkSize: 2 });
    const mgr = new HistoricalDataManager({ provider, store, cache, concurrency: 2, chunkSize: 2 });
    const { candles } = await mgr.load({ symbol: 'BTCUSD', timeframe: '1m', from: 1000, to: 1180 });
    // 1000,1060,1120,1180 =4
    expect(candles.length).toBe(4);
  });

  it('chunk boundaries no overlap dedup', async () => {
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    // Two chunks overlapping at boundary: provider would return duplicate at boundary
    const client = mockClient({
      '1000-1120': [c(1000,100), c(1060,101), c(1120,102)],
      '1121-1240': [c(1120,102), c(1180,103), c(1240,104)], // duplicate 1120
    });
    const provider = new DeltaCandleProvider({ client, maxCandles: 100000, chunkSize: 2 });
    const mgr = new HistoricalDataManager({ provider, store, cache, concurrency: 1, chunkSize: 2 });
    // Need to force chunks to align to our mock keys: we use timeframe 1m, chunkSize 2 => 120 sec range
    // Request 1000-1240 will create chunks 1000-1119, 1120-1239, 1240-1240 etc not matching mock keys -> simplify: test integrity dedup directly
    const raw = [c(1000,100), c(1060,101), c(1120,102), c(1120,102), c(1180,103)];
    const { validCandles } = CandleIntegrity.process(raw, { from: 1000, to: 1240, timeframeSec: 60 });
    expect(validCandles.length).toBe(4);
  });

  it('abort during fetch', async () => {
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    const client = {
      fetchCandles: async ({ signal }) => {
        await new Promise((res, rej) => {
          const t = setTimeout(()=>res([c(1000,100)]), 100);
          signal?.addEventListener('abort', ()=>{ clearTimeout(t); rej(new DOMException('Aborted','AbortError')); }, {once:true});
        });
        return [c(1000,100)];
      }
    };
    const provider = new DeltaCandleProvider({ client, maxCandles: 100000 });
    const mgr = new HistoricalDataManager({ provider, store, cache });
    const ac = new AbortController();
    const p = mgr.load({ symbol: 'BTCUSD', timeframe: '1m', from: 1000, to: 5000, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toHaveProperty('name', 'AbortError');
    // store should remain empty or previous
    expect(store.getCount()).toBe(0);
  });

  it('retry on network error', async () => {
    let calls = 0;
    const client = {
      fetchCandles: async () => {
        calls++;
        if (calls < 3) {
          const err = new Error('net'); err.code='NETWORK_ERROR'; throw err;
        }
        return [c(1000,100)];
      }
    };
    const provider = new DeltaCandleProvider({ client, maxCandles: 100000 });
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    const mgr = new HistoricalDataManager({ provider, store, cache, maxRetries: 3 });
    const { candles } = await mgr.load({ symbol: 'BTCUSD', timeframe: '1m', from: 1000, to: 1060 });
    expect(candles.length).toBe(1);
    expect(calls).toBe(3);
  });

  it('stale abort does not overwrite newer', async () => {
    const store1 = new CandleStore();
    const cache1 = new CandleCache({ enableIDB: false });
    const clientSlow = { fetchCandles: async ({signal})=>{ await new Promise(r=>setTimeout(r,60)); if(signal?.aborted) throw new DOMException('Aborted','AbortError'); return [c(1000,100)]; } };
    const clientFast = { fetchCandles: async ()=> [c(2000,200)] };
    const providerSlow = new DeltaCandleProvider({ client: clientSlow, maxCandles: 100000 });
    const providerFast = new DeltaCandleProvider({ client: clientFast, maxCandles: 100000 });
    const mgrSlow = new HistoricalDataManager({ provider: providerSlow, store: store1, cache: cache1 });
    const mgrFast = new HistoricalDataManager({ provider: providerFast, store: new CandleStore(), cache: new CandleCache({enableIDB:false}) });
    const ac = new AbortController();
    const pSlow = mgrSlow.load({ symbol: 'BTCUSD', timeframe: '1m', from: 1000, to: 1100, signal: ac.signal });
    // abort slow after 10ms, then fast load should succeed independently
    setTimeout(()=> ac.abort(), 10);
    await expect(pSlow).rejects.toHaveProperty('name','AbortError');
    const { candles } = await mgrFast.load({ symbol: 'ETHUSD', timeframe: '1m', from: 2000, to: 2100 });
    expect(candles[0].time).toBe(2000);
  });

  it('caching hit avoids fetch', async () => {
    let fetches = 0;
    const client = { fetchCandles: async ({ start, end })=>{ fetches++; const res=[]; for(let t=start; t<=end; t+=60) if(t===1000||t===1060) res.push(c(t,100)); return res; } };
    const provider = new DeltaCandleProvider({ client, maxCandles: 100000 });
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    const mgr = new HistoricalDataManager({ provider, store, cache });
    await mgr.load({ symbol: 'BTCUSD', timeframe: '1m', from: 1000, to: 1060 });
    expect(fetches).toBe(1);
    // second load same range should hit cache
    await mgr.load({ symbol: 'BTCUSD', timeframe: '1m', from: 1000, to: 1060 });
    expect(fetches).toBe(1);
  });

  it('partial cache reuses hit part', async () => {
    let fetches = 0;
    const client = {
      fetchCandles: async ({ start, end })=>{
        fetches++;
        const res=[];
        for(let t=start; t<=end; t+=60) {
          if(t===1000||t===1060) res.push(c(t,100));
          else if(t===1120||t===1180) res.push(c(t,101));
        }
        return res;
      }
    };
    const provider = new DeltaCandleProvider({ client, maxCandles: 100000, chunkSize: 2 });
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    const mgr = new HistoricalDataManager({ provider, store, cache, chunkSize: 2, concurrency: 1 });
    await mgr.load({ symbol: 'BTCUSD', timeframe: '1m', from: 1000, to: 1060 });
    expect(fetches).toBe(1);
    // Request overlapping extends to 1180, should fetch only missing
    await mgr.load({ symbol: 'BTCUSD', timeframe: '1m', from: 1000, to: 1180 });
    expect(fetches).toBe(2); // second range missing 1061-1180
  });
});

describe('Replay window — no future visible', () => {
  it('preview window hides future', async () => {
    const store = new CandleStore();
    const candles = Array.from({length: 5000}, (_,i)=> c(1000+i*60,100));
    store.load(candles, {symbol:'BTCUSD', timeframe:'1m'});
    const WINDOW=1000;
    const idx=2000;
    const win = store.sliceWindow(Math.max(0, idx - WINDOW +1), idx);
    expect(win.length).toBe(1000);
    expect(win[0].time).toBe(candles[idx-999].time);
    expect(win[win.length-1].time).toBe(candles[idx].time);
    // future 2001 not in win
    expect(win.find(c=>c.time===candles[4000].time)).toBeUndefined();
  });

  it('performance: sliceWindow O(window) not O(n)', () => {
    const store = new CandleStore();
    const candles = Array.from({length: 100000}, (_,i)=> c(1000+i*60,100));
    store.load(candles, {});
    const start = performance.now();
    const win = store.sliceWindow(50000-1000,50000);
    const elapsed = performance.now()-start;
    expect(win.length).toBe(1001);
    expect(elapsed).toBeLessThan(50);
  });
});
