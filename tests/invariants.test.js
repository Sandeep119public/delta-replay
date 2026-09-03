import { describe, it, expect, vi } from 'vitest';
import { CandleStore } from '../src/data/CandleStore.js';
import { CandleCache } from '../src/data/CandleCache.js';
import { CandleIntegrity, DATA_POLICY, INTEGRITY_STATUS } from '../src/data/CandleIntegrity.js';
import { HistoricalDataManager } from '../src/data/HistoricalDataManager.js';
import { BinanceClient } from '../src/data/BinanceClient.js';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { resolveVenueSymbol, VENUES } from '../src/data/InstrumentConfig.js';
import { computeGridMissing, mergeGridIntervals, intervalsFromCandles } from '../src/data/CandleGrid.js';

function makeCandle(time, close = 100) {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 10 };
}

describe('High-Value Invariant Tests (Audit Section 18)', () => {
  describe('1. Range Grid & Discrete Lattice Invariants', () => {
    it('request [1000, 1180] produces only discrete timestamps on the 1m grid (never 1061)', async () => {
      const tfSec = 60;
      const requestedChunks = [];
      const mockProvider = {
        fetchChunk: vi.fn(async ({ from, to }) => {
          requestedChunks.push({ from, to });
          const res = [];
          for (let t = from; t <= to; t += tfSec) {
            res.push(makeCandle(t, 100));
          }
          return res;
        }),
      };

      const mgr = new HistoricalDataManager({
        provider: mockProvider,
        store: new CandleStore(),
        cache: new CandleCache({ enableIDB: false }),
        chunkSize: 2, // 2 candles per chunk
      });

      const { candles } = await mgr.load({
        symbol: 'BTCUSD',
        timeframe: '1m',
        from: 1000,
        to: 1180,
      });

      // Expected timestamps: 1000, 1060, 1120, 1180
      const timestamps = candles.map(c => c.time);
      expect(timestamps).toEqual([1000, 1060, 1120, 1180]);
      expect(timestamps).not.toContain(1061);
      expect(timestamps).not.toContain(1062);

      // Verify every chunk boundary requested from provider is an exact candle timestamp
      for (const chunk of requestedChunks) {
        expect((chunk.from - 1000) % tfSec).toBe(0);
        expect((chunk.to - 1000) % tfSec).toBe(0);
      }
    });

    it('computeGridMissing returns exact discrete grid intervals instead of arbitrary seconds', () => {
      const tfSec = 60;
      // Cached: 1000 and 1060. Missing: 1120..1180
      const cached = [{ from: 1000, to: 1060 }];
      const missing = computeGridMissing(1000, 1180, cached, tfSec);

      expect(missing).toEqual([{ from: 1120, to: 1180 }]);
      expect(missing[0].from).not.toBe(1061);
    });
  });

  describe('2. Cache Coverage Invariant', () => {
    it('after caching 1000, 1060, 1180 with 1120 missing, subsequent request identifies exactly 1120 as missing', () => {
      const cache = new CandleCache({ enableIDB: false });
      const candles = [makeCandle(1000), makeCandle(1060), makeCandle(1180)];
      const intervals = [
        { from: 1000, to: 1060 },
        { from: 1180, to: 1180 },
      ];

      cache.set('BTCUSD', '1m', 1000, 1180, candles, { intervals, timeframeSec: 60 });
      const res = cache.get('BTCUSD', '1m', 1000, 1180, { timeframeSec: 60 });

      expect(res.hit).toBe(false);
      expect(res.missing).toEqual([{ from: 1120, to: 1120 }]);
      expect(res.candles.map(c => c.time)).toEqual([1000, 1060, 1180]);
    });

    it('intervalsFromCandles strictly enforces run count invariant', () => {
      const candles = [makeCandle(1000), makeCandle(1060), makeCandle(1120)];
      const runs = intervalsFromCandles(candles, 60);

      expect(runs).toEqual([{ from: 1000, to: 1120 }]);
      // Invariant: count === ((end - start) / tf) + 1
      const count = runs[0].count;
      expect(count).toBe(((1120 - 1000) / 60) + 1);
      expect(count).toBe(3);
    });
  });

  describe('3. Binance Client Complete Pagination Invariant', () => {
    it('paginates across 1500-candle page limit and returns all contiguous requested candles', async () => {
      const totalRequested = 3500;
      const startSec = 1700000000;
      const endSec = startSec + (totalRequested - 1) * 60;

      let callCount = 0;
      const mockFetch = vi.fn(async (url) => {
        callCount++;
        const parsedUrl = new URL(url);
        const startTime = parseInt(parsedUrl.searchParams.get('startTime'), 10);
        const limit = parseInt(parsedUrl.searchParams.get('limit'), 10);

        const pageCandles = [];
        for (let i = 0; i < limit; i++) {
          const tMs = startTime + i * 60 * 1000;
          const tSec = Math.floor(tMs / 1000);
          if (tSec > endSec) break;
          pageCandles.push([
            tMs,
            '100.0',
            '101.0',
            '99.0',
            '100.5',
            '50.0'
          ]);
        }

        return {
          ok: true,
          status: 200,
          json: async () => pageCandles,
        };
      });

      const client = new BinanceClient({
        baseUrl: 'https://fapi.binance.com',
        timeoutMs: 5000,
        fetchFn: mockFetch,
      });

      const candles = await client.fetchCandles({
        symbol: 'BTCUSD',
        resolution: '1m',
        start: startSec,
        end: endSec,
      });

      // Page limit is 1500: 3500 candles require ceil(3500 / 1500) = 3 pages
      expect(callCount).toBe(3);
      expect(candles.length).toBe(3500);
      expect(candles[0].time).toBe(startSec);
      expect(candles[candles.length - 1].time).toBe(endSec);
    });
  });

  describe('4. Binance Timeout vs Caller Abort Invariant', () => {
    it('internal timeout throws error with code TIMEOUT (retryable)', async () => {
      const mockSlowFetch = vi.fn(async (_url, { signal }) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ ok: true, json: async () => [] }), 200);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      });

      const client = new BinanceClient({
        baseUrl: 'https://fapi.binance.com',
        timeoutMs: 20, // 20ms timeout
        fetchFn: mockSlowFetch,
      });

      await expect(
        client.fetchCandles({ symbol: 'BTCUSD', resolution: '1m', start: 1000, end: 1060 })
      ).rejects.toMatchObject({
        code: 'TIMEOUT',
        name: 'TimeoutError',
      });
    });

    it('caller cancellation throws standard AbortError', async () => {
      const controller = new AbortController();
      const mockSlowFetch = vi.fn(async (_url, { signal }) => {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      });

      const client = new BinanceClient({
        baseUrl: 'https://fapi.binance.com',
        timeoutMs: 5000,
        fetchFn: mockSlowFetch,
      });

      const promise = client.fetchCandles({
        symbol: 'BTCUSD',
        resolution: '1m',
        start: 1000,
        end: 1060,
        signal: controller.signal,
      });

      controller.abort();
      await expect(promise).rejects.toHaveProperty('name', 'AbortError');
    });
  });

  describe('5. Store Query Semantics Invariant', () => {
    it('splits exact-time vs nearest-time queries unambiguously', () => {
      const store = new CandleStore();
      const candles = [makeCandle(1000), makeCandle(1060), makeCandle(1120)];
      store.load(candles, { symbol: 'BTCUSD', timeframe: '1m' });

      // Exact query
      expect(store.findExactIndexByTime(1060)).toBe(1);
      expect(store.findExactIndexByTime(1070)).toBe(-1);
      expect(store.findExactIndexByTime(900)).toBe(-1);

      // Nearest query
      expect(store.findNearestIndexByTime(1070)).toBe(1); // 1060 is closer to 1070 than 1120
      expect(store.findNearestIndexByTime(1110)).toBe(2); // 1120 is closer to 1110 than 1060

      // Range boundary queries
      expect(store.findAtOrAfterIndex(1070)).toBe(2); // 1120
      expect(store.findAtOrAfterIndex(1120)).toBe(2); // 1120
      expect(store.findAtOrAfterIndex(1200)).toBe(-1); // out of upper range

      expect(store.findAtOrBeforeIndex(1070)).toBe(1); // 1060
      expect(store.findAtOrBeforeIndex(1000)).toBe(0); // 1000
      expect(store.findAtOrBeforeIndex(950)).toBe(-1); // out of lower range
    });
  });

  describe('6. Data Integrity Policy Invariants (STRICT, REPAIR, LENIENT)', () => {
    const corruptDataset = [
      makeCandle(1000),
      { time: 1060, open: 100, high: 90, low: 95, close: 98, volume: 10 }, // corrupt: high < open/low
      makeCandle(1120),
    ];

    it('STRICT policy immediately throws on corrupt candle', () => {
      expect(() => {
        CandleIntegrity.process(corruptDataset, {
          from: 1000,
          to: 1120,
          timeframeSec: 60,
          policy: DATA_POLICY.STRICT,
        });
      }).toThrow(/Integrity error: dataset contains 1 invalid candle/);
    });

    it('REPAIR policy drops corrupt candle and populates repairRanges for targeted refetching', () => {
      const res = CandleIntegrity.process(corruptDataset, {
        from: 1000,
        to: 1120,
        timeframeSec: 60,
        policy: DATA_POLICY.REPAIR,
      });

      expect(res.validCandles.length).toBe(2);
      expect(res.validCandles.map(c => c.time)).toEqual([1000, 1120]);
      expect(res.metadata.invalidCount).toBe(1);
      expect(res.metadata.repairRanges).toEqual([{ from: 1060, to: 1060 }]);
      expect(res.metadata.integrityStatus).toBe(INTEGRITY_STATUS.INVALID);
    });

    it('LENIENT policy drops corrupt candle and marks dataset as DEGRADED', () => {
      const res = CandleIntegrity.process(corruptDataset, {
        from: 1000,
        to: 1120,
        timeframeSec: 60,
        policy: DATA_POLICY.LENIENT,
      });

      expect(res.validCandles.length).toBe(2);
      expect(res.metadata.invalidCount).toBe(1);
      expect(res.metadata.integrityStatus).toBe(INTEGRITY_STATUS.DEGRADED);
    });
  });

  describe('7. Synchronous Simulation Step Invariant', () => {
    it('step(), stepCount(n), and stepTo(index) advance replay synchronously without setTimeout', () => {
      const engine = new ReplayEngine();
      const candles = Array.from({ length: 10 }, (_, i) => makeCandle(1000 + i * 60));
      engine.load(candles, 'BTCUSD');
      engine.start(0);

      expect(engine.getState().currentIndex).toBe(0);

      // Single synchronous step
      engine.step();
      expect(engine.getState().currentIndex).toBe(1);

      // Multi-step
      engine.stepCount(3);
      expect(engine.getState().currentIndex).toBe(4);

      // Step to specific index
      engine.stepTo(8);
      expect(engine.getState().currentIndex).toBe(8);
    });
  });

  describe('8. Instrument & Symbol Mapping Formalization', () => {
    it('resolves explicit venue symbols without implicit mutation', () => {
      expect(resolveVenueSymbol('BTCUSD', VENUES.BINANCE_FUTURES)).toBe('BTCUSDT');
      expect(resolveVenueSymbol('BTCUSD', VENUES.DELTA_EXCHANGE)).toBe('BTCUSD');
      expect(resolveVenueSymbol('ETHUSD', VENUES.BINANCE_FUTURES)).toBe('ETHUSDT');
      expect(resolveVenueSymbol('CUSTOM_PAIR', VENUES.BINANCE_FUTURES)).toBe('CUSTOM_PAIR');
    });
  });
});
