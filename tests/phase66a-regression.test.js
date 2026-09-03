import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DeltaClient, DeltaError } from '../src/data/DeltaClient.js';
import { DeltaCandleProvider } from '../src/data/DeltaCandleProvider.js';
import { HistoricalDataManager } from '../src/data/HistoricalDataManager.js';
import { CandleStore } from '../src/data/CandleStore.js';
import { CandleCache } from '../src/data/CandleCache.js';

// Helper — mock fetch that returns response
function mockFetchResponse({ ok = true, status = 200, jsonData = {}, textData = null } = {}) {
  return async (url, opts) => {
    if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      headers: new Map(),
      json: async () => jsonData,
      text: async () => textData ?? JSON.stringify(jsonData),
    };
  };
}
function c(time, close) { return { time, open: close, high: close+1, low: close-1, close, volume: 10 }; }

describe('PHASE 6.6A — Regression: Illegal invocation & data path', () => {

  // A. DeltaClient successfully invokes fetch in real browser-style environment
  describe('A. Real browser-style fetch invocation', () => {
    let originalFetch;
    beforeEach(() => { originalFetch = globalThis.fetch; });
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('bound fetch succeeds where unbound would throw Illegal invocation', async () => {
      // Native-like fetch that enforces this === globalThis (browser behavior)
      function strictFetch(url, opts) {
        if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
        return {
          ok: true, status: 200, statusText: 'OK',
          json: async () => ({ success: true, result: [c(1700000060,100)] }),
          text: async () => JSON.stringify({ success: true, result: [c(1700000060,100)] }),
        };
      }
      globalThis.fetch = strictFetch;

      // Direct unbound call should throw (synchronous)
      const unbound = globalThis.fetch;
      expect(() => unbound('https://api.delta.exchange/v2/history/candles?x', {})).toThrow(/Illegal invocation/);

      // DeltaClient with default (bound) fetch should NOT throw
      const client = new DeltaClient({ baseUrl: 'https://api.delta.exchange', timeoutMs: 0 });
      const res = await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1700000000, end: 1700000600 });
      expect(res.length).toBe(1);
      expect(res[0].time).toBe(1700000060);
    });

    it('uses window.fetch safe form (fetch.call)', async () => {
      let calledWithThis = null;
      function checkThisFetch(url, opts) {
        calledWithThis = this;
        return { ok:true,status:200, json: async()=>({success:true,result:[c(1700000120,101)]}), text: async()=>'' };
      }
      globalThis.fetch = checkThisFetch;
      const client = new DeltaClient({ timeoutMs: 0 });
      await client.fetchCandles({ symbol:'BTCUSDT', resolution:'1m', start:1700000000, end:1700000600 });
      expect(calledWithThis).toBe(globalThis);
    });
  });

  // B. An unbound fetch reference cannot occur
  describe('B. Unbound fetch reference must not occur', () => {
    it('new DeltaClient().fetchFn is bound and detached call succeeds', async () => {
      let seenThis = null;
      const orig = globalThis.fetch;
      function tracked(url, opts) {
        seenThis = this;
        return { ok:true,status:200, json: async()=>({success:true,result:[c(1700000060,100)]}), text: async()=>'' };
      }
      globalThis.fetch = tracked;
      try {
        const client = new DeltaClient({ timeoutMs:0 });
        const detached = client.fetchFn;
        // Calling detached should still have this === globalThis (bound)
        await detached('https://api.delta.exchange/v2/history/candles?x', { signal: undefined, headers:{} });
        expect(seenThis).toBe(globalThis);
      } finally { globalThis.fetch = orig; }
    });

    it('DeltaClient never stores raw globalThis.fetch unbound', async () => {
      const orig = globalThis.fetch;
      // Replace with strict version that throws if unbound
      function strict(url, opts) {
        if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
        return { ok:true,status:200, json: async()=>({success:true,result:[]}), text: async()=>'' };
      }
      globalThis.fetch = strict;
      try {
        const client = new DeltaClient({ timeoutMs:0 });
        // If client stored unbound, this would throw
        await expect(client.fetchCandles({ symbol:'BTCUSDT', resolution:'1m', start:1700000000, end:1700000100 })).resolves.toBeDefined();
      } finally { globalThis.fetch = orig; }
    });
  });

  // C. AbortController cancellation works
  describe('C. AbortController cancellation', () => {
    it('DeltaClient aborts via signal', async () => {
      const fetchFn = (url, { signal }) => new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')));
      });
      const client = new DeltaClient({ fetchFn, timeoutMs:0 });
      const ac = new AbortController();
      const p = client.fetchCandles({ symbol:'BTCUSDT', resolution:'1m', start:1700000000, end:1700000600, signal: ac.signal });
      ac.abort();
      await expect(p).rejects.toHaveProperty('name','AbortError');
    });

    it('HistoricalDataManager aborts mid-fetch', async () => {
      const store = new CandleStore();
      const cache = new CandleCache({ enableIDB:false });
      const client = {
        fetchCandles: async ({ signal }) => {
          await new Promise((res, rej) => {
            const t=setTimeout(()=>res([c(1000,100)]),100);
            signal?.addEventListener('abort',()=>{clearTimeout(t); rej(new DOMException('Aborted','AbortError'));},{once:true});
          });
          return [c(1000,100)];
        }
      };
      const provider = new DeltaCandleProvider({ client });
      const mgr = new HistoricalDataManager({ provider, store, cache });
      const ac = new AbortController();
      const p = mgr.load({ symbol:'BTCUSD', timeframe:'1m', from:1000, to:5000, signal: ac.signal });
      ac.abort();
      await expect(p).rejects.toHaveProperty('name','AbortError');
      expect(store.getCount()).toBe(0);
    });
  });

  // D. HTTP errors preserve useful status/context
  describe('D. HTTP errors preserve status/context', () => {
    it('API 400 preserves status, url, symbol', async () => {
      const fetchFn = mockFetchResponse({ ok:false, status:400, jsonData:{ error:{code:'bad_schema'}}, textData:'{"error":{"code":"bad_schema"}}' });
      const client = new DeltaClient({ fetchFn, timeoutMs:0 });
      try {
        await client.fetchCandles({ symbol:'BTCUSDT', resolution:'1m', start:1, end:2 });
        expect.fail('should throw');
      } catch (err) {
        expect(err.code).toBe('API_ERROR');
        expect(err.details.status).toBe(400);
        expect(err.details.url).toContain('/v2/history/candles');
        expect(err.details.symbol).toBe('BTCUSDT');
        expect(err.details.resolution).toBe('1m');
        expect(err.message).toContain('400');
      }
    });

    it('success:false preserves payload', async () => {
      const fetchFn = mockFetchResponse({ jsonData:{ success:false, error:{ code:'invalid_resolution', context:{resolution:'99m'}}}});
      const client = new DeltaClient({ fetchFn, timeoutMs:0 });
      await expect(client.fetchCandles({ symbol:'BTCUSDT', resolution:'1m', start:1, end:2 })).rejects.toMatchObject({ code:'API_ERROR' });
      try { await client.fetchCandles({ symbol:'BTCUSDT', resolution:'1m', start:1, end:2 }); } catch(err){ expect(err.details.data).toBeDefined(); }
    });

    it('Illegal invocation error preserves URL, symbol, resolution, start, end', async () => {
      const fetchFn = async () => { throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"); };
      const client = new DeltaClient({ fetchFn, timeoutMs:0 });
      try {
        await client.fetchCandles({ symbol:'BTCUSDT', resolution:'1m', start:1700000000, end:1700000600 });
        expect.fail('should throw');
      } catch (err) {
        expect(err.code).toBe('INVALID_REQUEST');
        expect(err.message).toMatch(/Illegal invocation/i);
        expect(err.details.url).toContain('BTCUSDT');
        expect(err.details.symbol).toBe('BTCUSDT');
        expect(err.details.start).toBe(1700000000);
      }
    });
  });

  // E. malformed responses fail validation cleanly
  describe('E. Malformed responses', () => {
    it('result not array throws INVALID_RESPONSE', async () => {
      const fetchFn = mockFetchResponse({ jsonData:{ success:true, result:'not-array' }});
      const client = new DeltaClient({ fetchFn, timeoutMs:0 });
      await expect(client.fetchCandles({ symbol:'BTCUSDT', resolution:'1m', start:1, end:2 })).rejects.toMatchObject({ code:'INVALID_RESPONSE' });
    });

    it('invalid JSON throws INVALID_RESPONSE with context', async () => {
      const fetchFn = async ()=>({ ok:true, status:200, json: async()=>{ throw new SyntaxError('Unexpected token'); }, text: async()=> 'not-json' });
      const client = new DeltaClient({ fetchFn, timeoutMs:0 });
      try { await client.fetchCandles({ symbol:'BTCUSDT', resolution:'1m', start:1, end:2 }); expect.fail(); } catch(err){ expect(err.code).toBe('INVALID_RESPONSE'); expect(err.details.url).toBeDefined(); }
    });

    it('response not object throws INVALID_RESPONSE', async () => {
      const fetchFn = mockFetchResponse({ jsonData: null });
      const client = new DeltaClient({ fetchFn, timeoutMs:0 });
      await expect(client.fetchCandles({ symbol:'BTCUSDT', resolution:'1m', start:1, end:2 })).rejects.toMatchObject({ code:'INVALID_RESPONSE' });
    });
  });

  // F. retry behavior distinguishes retryable vs non-retryable
  describe('F. Retry classification', () => {
    it('does NOT retry Illegal invocation', async () => {
      let calls=0;
      const client = {
        fetchCandles: async () => { calls++; throw new DeltaError('INVALID_REQUEST', "Fetch Illegal invocation: Failed to execute 'fetch' on 'Window': Illegal invocation", { url:'https://api.delta.exchange/v2/history/candles?x' }); }
      };
      const provider = new DeltaCandleProvider({ client });
      const store = new CandleStore(); const cache = new CandleCache({ enableIDB:false });
      const mgr = new HistoricalDataManager({ provider, store, cache, maxRetries:3, chunkSize:2000, concurrency:1 });
      await expect(mgr.load({ symbol:'BTCUSD', timeframe:'1m', from:1000, to:1060 })).rejects.toMatchObject({ code:'INVALID_REQUEST' });
      expect(calls).toBe(1);
    });

    it('does NOT retry INVALID_REQUEST (unsupported resolution)', async () => {
      let calls=0;
      const client = { fetchCandles: async()=>{ calls++; throw new DeltaError('INVALID_REQUEST','Unsupported timeframe',{status:400}); } };
      const provider = new DeltaCandleProvider({ client });
      const store=new CandleStore(); const cache=new CandleCache({enableIDB:false});
      const mgr=new HistoricalDataManager({provider,store,cache,maxRetries:3, concurrency:1});
      await expect(mgr.load({symbol:'BTCUSD', timeframe:'1m', from:1000, to:1060})).rejects.toMatchObject({code:'INVALID_REQUEST'});
      expect(calls).toBe(1);
    });

    it('does NOT retry 400 API_ERROR', async () => {
      let calls=0;
      const client = { gridOrigin: 1000, fetchCandles: async()=>{ calls++; throw new DeltaError('API_ERROR','bad', {status:400, url:'https://api.delta.exchange/x'}); } };
      const provider=new DeltaCandleProvider({client}); const mgr=new HistoricalDataManager({provider, store:new CandleStore(), cache:new CandleCache({enableIDB:false}), maxRetries:3, concurrency:1});
      await expect(mgr.load({symbol:'BTCUSD', timeframe:'1m', from:1000,to:1060})).rejects.toMatchObject({code:'API_ERROR'});
      expect(calls).toBe(1);
    });

    it('does retry NETWORK_ERROR', async () => {
      let calls=0;
      const client = { gridOrigin: 1000, fetchCandles: async()=>{ calls++; if(calls<3){ throw new DeltaError('NETWORK_ERROR','net',{url:'https://api/x'});} return [c(1000,100)]; } };
      const provider=new DeltaCandleProvider({client}); const mgr=new HistoricalDataManager({provider, store:new CandleStore(), cache:new CandleCache({enableIDB:false}), maxRetries:3, concurrency:1});
      const {candles}=await mgr.load({symbol:'BTCUSD', timeframe:'1m', from:1000,to:1060});
      expect(calls).toBe(3);
      expect(candles.length).toBe(1);
    });

    it('does retry 408, 429, 5xx', async () => {
      for (const status of [408,429,500,502,503]) {
        let calls=0;
        const client={ gridOrigin: 1000, fetchCandles: async()=>{ calls++; if(calls===1) throw new DeltaError('API_ERROR',`err ${status}`,{status, url:'https://api/x'}); return [c(1000,100)]; } };
        const mgr=new HistoricalDataManager({ provider:new DeltaCandleProvider({client}), store:new CandleStore(), cache:new CandleCache({enableIDB:false}), maxRetries:2, concurrency:1 });
        const {candles}=await mgr.load({symbol:'BTCUSD', timeframe:'1m', from:1000,to:1060});
        expect(calls).toBe(2);
        expect(candles.length).toBe(1);
      }
    });

    it('does NOT retry INVALID_RESPONSE', async () => {
      let calls=0;
      const client={ gridOrigin: 1000, fetchCandles: async()=>{ calls++; throw new DeltaError('INVALID_RESPONSE','bad',{url:'https://api/x'}); } };
      const mgr=new HistoricalDataManager({ provider:new DeltaCandleProvider({client}), store:new CandleStore(), cache:new CandleCache({enableIDB:false}), maxRetries:3, concurrency:1 });
      await expect(mgr.load({symbol:'BTCUSD', timeframe:'1m', from:1000,to:1060})).rejects.toMatchObject({code:'INVALID_RESPONSE'});
      expect(calls).toBe(1);
    });

    it('retries TIMEOUT', async () => {
      let calls=0;
      const client={ gridOrigin: 1000, fetchCandles: async()=>{ calls++; if(calls<2) throw new DeltaError('TIMEOUT','timeout',{url:'https://api/x'}); return [c(1000,100)]; } };
      const mgr=new HistoricalDataManager({ provider:new DeltaCandleProvider({client}), store:new CandleStore(), cache:new CandleCache({enableIDB:false}), maxRetries:3, concurrency:1 });
      const {candles}=await mgr.load({symbol:'BTCUSD', timeframe:'1m', from:1000,to:1060});
      expect(calls).toBe(2);
      expect(candles[0].time).toBe(1000);
    });
  });

  // G. successful Delta responses reach HistoricalDataManager
  describe('G. End-to-end: Delta response → HistoricalDataManager', () => {
    it('fetches and populates store', async () => {
      const raw = [
        { time:1700000120, open:102, high:103, low:101, close:102, volume:5 },
        { time:1700000060, open:101, high:102, low:100, close:101, volume:5 },
      ];
      const fetchFn = mockFetchResponse({ jsonData:{ success:true, result: raw }});
      const client = new DeltaClient({ fetchFn, timeoutMs:0 });
      const provider = new DeltaCandleProvider({ client });
      const store = new CandleStore(); const cache = new CandleCache({ enableIDB:false });
      const mgr = new HistoricalDataManager({ provider, store, cache });
      const { candles, metadata } = await mgr.load({ symbol:'BTCUSD', timeframe:'1m', from:1700000000, to:1700000200 });
      expect(candles.length).toBe(2);
      expect(store.getCount()).toBe(2);
      expect(metadata.count).toBe(2);
      expect(candles[0].time).toBeLessThan(candles[1].time);
    });
  });

  // H. HistoricalDataManager produces candles in chronological order
  describe('H. Chronological order', () => {
    it('returns sorted ascending even when API returns descending', async () => {
      const raw = [
        { time:1700000180, open:103, high:104, low:102, close:103, volume:5 },
        { time:1700000120, open:102, high:103, low:101, close:102, volume:5 },
        { time:1700000060, open:101, high:102, low:100, close:101, volume:5 },
      ];
      const fetchFn = mockFetchResponse({ jsonData:{ success:true, result: raw }});
      const client = new DeltaClient({ fetchFn, timeoutMs:0 });
      client.gridOrigin = 1700000000;
      const provider = new DeltaCandleProvider({ client });
      const mgr = new HistoricalDataManager({ provider, store:new CandleStore(), cache:new CandleCache({enableIDB:false}) });
      const { candles } = await mgr.load({ symbol:'BTCUSD', timeframe:'1m', from:1700000000, to:1700000200 });
      for (let i=1;i<candles.length;i++) expect(candles[i].time).toBeGreaterThan(candles[i-1].time);
    });

    it('handles chunked multi-fetch still sorted', async () => {
      const tfSec=60;
      const client = {
        gridOrigin: 1000,
        fetchCandles: async ({ start, end }) => {
          const res=[];
          for(let t=start; t<=end; t+=tfSec){
            if (t>=1000 && t<=1180) res.push(c(t,100+ (t-1000)/60));
          }
          // Return descending to simulate API
          return res.reverse();
        }
      };
      const provider = new DeltaCandleProvider({ client, chunkSize:2 });
      const mgr = new HistoricalDataManager({ provider, store:new CandleStore(), cache:new CandleCache({enableIDB:false}), chunkSize:2, concurrency:1 });
      const { candles } = await mgr.load({ symbol:'BTCUSD', timeframe:'1m', from:1000, to:1180 });
      expect(candles.length).toBe(4);
      expect(candles.map(x=>x.time)).toEqual([1000,1060,1120,1180]);
    });
  });

  // I. empty API results are handled correctly
  describe('I. Empty results', () => {
    it('DeltaCandleProvider throws NO_DATA on empty', async () => {
      const fetchFn = mockFetchResponse({ jsonData:{ success:true, result:[] }});
      const client = new DeltaClient({ fetchFn, timeoutMs:0 });
      const provider = new DeltaCandleProvider({ client });
      await expect(provider.loadCandles({ symbol:'BTCUSDT', timeframe:'1m', from:1700000000, to:1700003600 })).rejects.toMatchObject({ code:'NO_DATA' });
    });

    it('HistoricalDataManager surfaces EMPTY DATA (NO_DATA) distinct from network error', async () => {
      const client = { fetchCandles: async()=>[] }; // raw empty array
      const provider = new DeltaCandleProvider({ client });
      const mgr = new HistoricalDataManager({ provider, store:new CandleStore(), cache:new CandleCache({enableIDB:false}) });
      try {
        await mgr.load({ symbol:'BTCUSD', timeframe:'1m', from:1000, to:1060 });
        expect.fail('should throw');
      } catch (err) {
        expect(err.code).toBe('NO_DATA');
        // Should NOT be classified as NETWORK_ERROR or API_ERROR
        expect(['NETWORK_ERROR','API_ERROR','TIMEOUT']).not.toContain(err.code);
      }
    });

    it('cache still works after empty not cached', async () => {
      let calls=0;
      const client = { fetchCandles: async()=>{ calls++; return []; } };
      const provider = new DeltaCandleProvider({ client });
      const cache = new CandleCache({ enableIDB:false });
      const mgr = new HistoricalDataManager({ provider, store:new CandleStore(), cache, concurrency:1 });
      await expect(mgr.load({ symbol:'BTCUSD', timeframe:'1m', from:1000, to:1060 })).rejects.toMatchObject({ code:'NO_DATA' });
      expect(calls).toBe(1);
      // Second load should retry fetch (empty not cached)
      await expect(mgr.load({ symbol:'BTCUSD', timeframe:'1m', from:1000, to:1060 })).rejects.toMatchObject({ code:'NO_DATA' });
      expect(calls).toBe(2);
    });
  });

  // Additional: DeltaClient request construction invariants
  describe('Request construction invariants', () => {
    it('encodes symbol/resolution and uses seconds, correct base URL, AbortSignal', async () => {
      let capturedUrl, capturedSignal;
      const fetchFn = async (url, opts) => {
        capturedUrl = url; capturedSignal = opts.signal;
        return { ok:true, status:200, json: async()=>({success:true, result:[c(1700000060,100)]}), text: async()=>'' };
      };
      const client = new DeltaClient({ baseUrl:'https://api.delta.exchange/', fetchFn, timeoutMs:0 });
      const ac = new AbortController();
      await client.fetchCandles({ symbol:'BTCUSDT', resolution:'1m', start:1700000000.9, end:1700000600.1, signal: ac.signal });
      expect(capturedUrl).toBe('https://api.delta.exchange/v2/history/candles?resolution=1m&symbol=BTCUSDT&start=1700000000&end=1700000600');
      expect(capturedUrl).not.toContain('1700000000.9');
      expect(capturedSignal).toBeDefined();
    });

    it('start/end are integer seconds (no milliseconds leak)', async () => {
      let url;
      const fetchFn = async (u)=>{ url=u; return { ok:true,status:200, json: async()=>({success:true,result:[c(1700000000,100)]}), text: async()=>'' }; };
      const client=new DeltaClient({fetchFn, timeoutMs:0});
      // Pass millisecond-like value accidentally? Should floor to seconds
      await client.fetchCandles({ symbol:'BTCUSDT', resolution:'1m', start:1700000000123/1000, end:1700000600123/1000 });
      expect(url).toContain('start=1700000000');
      expect(url).not.toContain('1700000000123');
    });
  });

});
