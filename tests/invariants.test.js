import { describe, it, expect, vi } from 'vitest';
import { CandleStore } from '../src/data/CandleStore.js';
import { CandleCache } from '../src/data/CandleCache.js';
import { CandleIntegrity, DATA_POLICY, INTEGRITY_STATUS } from '../src/data/CandleIntegrity.js';
import { HistoricalDataManager, DataEvents } from '../src/data/HistoricalDataManager.js';
import { CandleValidator } from '../src/data/CandleValidator.js';
import { BinanceClient } from '../src/data/BinanceClient.js';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { resolveVenueSymbol, VENUES } from '../src/data/InstrumentConfig.js';
import { computeGridMissing, mergeGridIntervals, intervalsFromCandles, normalizeRange } from '../src/data/CandleGrid.js';

function makeCandle(time, close = 100) {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 10 };
}

describe('High-Value Invariant Tests (Audit Section 18 & Second-Pass Hardening)', () => {
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
        chunkSize: 2,
      });

      const { candles } = await mgr.load({
        symbol: 'BTCUSD',
        timeframe: '1m',
        from: 1000,
        to: 1180,
        origin: 1000,
      });

      const timestamps = candles.map(c => c.time);
      expect(timestamps).toEqual([1000, 1060, 1120, 1180]);
      expect(timestamps).not.toContain(1061);
      expect(timestamps).not.toContain(1062);

      for (const chunk of requestedChunks) {
        expect((chunk.from - 1000) % tfSec).toBe(0);
        expect((chunk.to - 1000) % tfSec).toBe(0);
      }
    });

    it('normalizeRange aligns unaligned boundaries and produces requested vs effective ranges', () => {
      const range = normalizeRange(1001, 1181, 60, 0);
      expect(range.requestedFrom).toBe(1001);
      expect(range.requestedTo).toBe(1181);
      expect(range.effectiveFrom).toBe(1020);
      expect(range.effectiveTo).toBe(1140);
      expect(range.hasCandle).toBe(true);

      // Invariant: effectiveFrom >= requestedFrom && effectiveTo <= requestedTo
      expect(range.effectiveFrom).toBeGreaterThanOrEqual(range.requestedFrom);
      expect(range.effectiveTo).toBeLessThanOrEqual(range.requestedTo);

      // Narrow range containing no candle
      const narrow = normalizeRange(1001, 1010, 60, 0);
      expect(narrow.hasCandle).toBe(false);
      expect(narrow.effectiveFrom).toBe(1020);
      expect(narrow.effectiveTo).toBe(960);
    });

    it('computeGridMissing returns exact discrete grid intervals instead of arbitrary seconds', () => {
      const tfSec = 60;
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
      const count = runs[0].count;
      expect(count).toBe(((1120 - 1000) / 60) + 1);
      expect(count).toBe(3);
    });
  });

  describe('3. Binance Client Complete Pagination & Validation Invariants', () => {
    it('validates parameters strictly before making requests', async () => {
      const client = new BinanceClient();
      await expect(client.fetchCandles({ symbol: '', resolution: '1m', start: 1000, end: 2000 })).rejects.toThrow(/symbol is required/);
      await expect(client.fetchCandles({ symbol: 'BTCUSD', resolution: '', start: 1000, end: 2000 })).rejects.toThrow(/resolution is required/);
      await expect(client.fetchCandles({ symbol: 'BTCUSD', resolution: '1m', start: 2000, end: 1000 })).rejects.toThrow(/start must be <= end/);
    });

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
        timeoutMs: 20,
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
      expect(store.findNearestIndexByTime(1070)).toBe(1);
      expect(store.findNearestIndexByTime(1110)).toBe(2);

      // Range boundary queries
      expect(store.findAtOrAfterIndex(1070)).toBe(2);
      expect(store.findAtOrAfterIndex(1120)).toBe(2);
      expect(store.findAtOrAfterIndex(1200)).toBe(-1);

      expect(store.findAtOrBeforeIndex(1070)).toBe(1);
      expect(store.findAtOrBeforeIndex(1000)).toBe(0);
      expect(store.findAtOrBeforeIndex(950)).toBe(-1);
    });
  });

  describe('6. Data Integrity Policy & Active REPAIR Invariants', () => {
    const corruptDataset = [
      makeCandle(1000),
      { time: 1060, open: 100, high: 90, low: 95, close: 98, volume: 10 },
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

    it('HistoricalDataManager actively refetches repairRanges and repairs dataset to VALID', async () => {
      let repairRefetchCalled = false;
      const mockProvider = {
        fetchChunk: vi.fn(async ({ from, to }) => {
          if (from === 1060 && to === 1060) {
            repairRefetchCalled = true;
            return [makeCandle(1060, 101)]; // clean replacement candle
          }
          return [
            makeCandle(1000, 100),
            { time: 1060, open: 100, high: 90, low: 95, close: 98, volume: 10 }, // corrupt
            makeCandle(1120, 102),
          ];
        }),
      };

      const mgr = new HistoricalDataManager({
        provider: mockProvider,
        store: new CandleStore(),
        cache: new CandleCache({ enableIDB: false }),
      });

      const { candles, metadata } = await mgr.load({
        symbol: 'BTCUSD',
        timeframe: '1m',
        from: 1000,
        to: 1120,
        policy: 'REPAIR',
        origin: 1000,
      });

      expect(repairRefetchCalled).toBe(true);
      expect(candles.length).toBe(3);
      expect(candles.map(c => c.time)).toEqual([1000, 1060, 1120]);
      expect(metadata.repairRequested).toBe(1);
      expect(metadata.repairSucceeded).toBe(1);
      expect(metadata.repairFailed).toBe(0);
      expect(metadata.repairSuccess).toBe(true);
      expect(metadata.integrityStatus).toBe(INTEGRITY_STATUS.VALID);
    });

    it('failed repair marks dataset DEGRADED and does NOT contaminate cache', async () => {
      const mockFailingProvider = {
        fetchChunk: vi.fn(async ({ from, to }) => {
          if (from === 1060 && to === 1060) {
            // Repair fetch fails
            throw new Error('Exchange 500 error on repair');
          }
          return [
            makeCandle(1000, 100),
            { time: 1060, open: 100, high: 90, low: 95, close: 98, volume: 10 },
            makeCandle(1120, 102),
          ];
        }),
      };

      const cache = new CandleCache({ enableIDB: false });
      const mgr = new HistoricalDataManager({
        provider: mockFailingProvider,
        store: new CandleStore(),
        cache,
      });

      const { candles, metadata } = await mgr.load({
        symbol: 'BTCUSD',
        timeframe: '1m',
        from: 1000,
        to: 1120,
        policy: 'REPAIR',
        origin: 1000,
      });

      expect(candles.length).toBe(2);
      expect(metadata.repairSuccess).toBe(false);
      expect(metadata.integrityStatus).toBe(INTEGRITY_STATUS.DEGRADED);

      // Verify cache was NOT populated with degraded/failed coverage
      const cached = cache.get('BTCUSD', '1m', 1000, 1120, { timeframeSec: 60 });
      expect(cached.hit).toBe(false);
      expect(cached.candles.length).toBe(0);
    });

    it('repair replacement normalizes array-form and millisecond responses before matching', async () => {
      const mockArrayProvider = {
        fetchChunk: vi.fn(async ({ from, to }) => {
          if (from === 1060 && to === 1060) {
            // Returns raw array form candle
            return [[1060, '101.0', '102.0', '100.0', '101.5', '15.0']];
          }
          return [
            makeCandle(1000, 100),
            { time: 1060, open: 100, high: 90, low: 95, close: 98, volume: 10 },
            makeCandle(1120, 102),
          ];
        }),
      };

      const mgr = new HistoricalDataManager({
        provider: mockArrayProvider,
        store: new CandleStore(),
        cache: new CandleCache({ enableIDB: false }),
      });

      const { candles, metadata } = await mgr.load({
        symbol: 'BTCUSD',
        timeframe: '1m',
        from: 1000,
        to: 1120,
        policy: 'REPAIR',
        origin: 1000,
      });

      expect(candles.length).toBe(3);
      expect(candles.map(c => c.time)).toEqual([1000, 1060, 1120]);
      expect(metadata.repairSuccess).toBe(true);
      expect(metadata.integrityStatus).toBe(INTEGRITY_STATUS.VALID);
    });
  });

  describe('7. Synchronous Simulation Step Invariant', () => {
    it('step(), stepCount(n), and stepTo(index) advance replay synchronously without setTimeout', () => {
      const engine = new ReplayEngine();
      const candles = Array.from({ length: 10 }, (_, i) => makeCandle(1000 + i * 60));
      engine.load(candles, { symbol: 'BTCUSD' });
      expect(engine.getSymbol()).toBe('BTCUSD');

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

      // Step backwards should throw and direct caller to seek
      expect(() => engine.stepTo(5)).toThrow(/Cannot stepTo backwards/);
      expect(() => engine.stepCount(-2)).toThrow(/Invalid step count/);
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

  describe('9. Dataset Contract Invariants (Production Research Engine)', () => {
    it('verifies all 10 dataset invariants end-to-end on clean and degraded pipelines', async () => {
      const tfSec = 60;
      const origin = 1000;
      const cleanCandles = [
        makeCandle(1000, 100),
        makeCandle(1060, 101),
        makeCandle(1120, 102),
        makeCandle(1180, 103),
      ];

      const provider = {
        venue: 'TEST_VENUE',
        getGridSpec() {
          return { origin, timeframeUnit: 'seconds', alignment: 'CUSTOM' };
        },
        fetchChunk: vi.fn(async ({ from, to }) => {
          return cleanCandles.filter(c => c.time >= from && c.time <= to);
        }),
      };

      const cache = new CandleCache({ enableIDB: false });
      const store = new CandleStore();
      const mgr = new HistoricalDataManager({ provider, store, cache });

      let readyEmitted = null;
      let readyDegradedEmitted = false;
      mgr.on(DataEvents.READY, (evt) => { readyEmitted = evt; });
      mgr.on(DataEvents.READY_DEGRADED, () => { readyDegradedEmitted = true; });

      // Unaligned request [995, 1185]
      const { candles, metadata, quality } = await mgr.load({
        symbol: 'BTCUSD',
        timeframe: '1m',
        from: 995,
        to: 1185,
        origin,
      });

      // 1. effectiveFrom <= every candle.time <= effectiveTo
      expect(metadata.effectiveFrom).toBe(1000);
      expect(metadata.effectiveTo).toBe(1180);
      for (const c of candles) {
        expect(c.time).toBeGreaterThanOrEqual(metadata.effectiveFrom);
        expect(c.time).toBeLessThanOrEqual(metadata.effectiveTo);
      }

      // 2. Every candle.time is on the provider grid
      for (const c of candles) {
        expect((c.time - origin) % tfSec).toBe(0);
      }

      // 3. Timestamps are strictly increasing
      for (let i = 1; i < candles.length; i++) {
        expect(candles[i].time).toBeGreaterThan(candles[i - 1].time);
      }

      // 4. No duplicate timestamps
      const uniqueTimes = new Set(candles.map(c => c.time));
      expect(uniqueTimes.size).toBe(candles.length);

      // 5. No invalid OHLCV candle exists
      for (const c of candles) {
        const v = CandleValidator.validate(c);
        expect(v.valid).toBe(true);
      }

      // 6. Cache coverage exactly equals candle-derived coverage
      const cached = cache.get('BTCUSD', '1m', 1000, 1180, {
        timeframeSec: tfSec,
        venue: 'TEST_VENUE',
        gridOrigin: origin,
      });
      expect(cached.hit).toBe(true);
      expect(cached.intervals).toEqual(CandleCache.intervalsFromCandles(candles, tfSec));

      // 7. VALID means complete for requested effective range
      expect(quality).toBe('VALID');
      expect(metadata.integrityStatus).toBe(INTEGRITY_STATUS.VALID);
      expect(readyDegradedEmitted).toBe(false);

      // 10. Replay receives exactly the Store dataset, with no future leak
      const engine = new ReplayEngine();
      engine.load(store.getAll(), { symbol: 'BTCUSD' });
      engine.start(0);
      // Index 0 only sees the first candle
      const stream0 = [];
      engine.on('marketCandle', (c) => stream0.push(c));
      expect(engine.getCurrentCandle().time).toBe(1000);
      expect(stream0.length).toBe(0); // initial candle already emitted on start
      // Step forward 1
      engine.step();
      expect(engine.getCurrentCandle().time).toBe(1060);
      expect(stream0.length).toBe(1);
      expect(stream0[0].candle.time).toBe(1060);
    });

    it('asserts invariants 8 & 9: DEGRADED status, explicit READY_DEGRADED event, and exact repair accounting', async () => {
      const origin = 1000;
      const gappedProvider = {
        venue: 'TEST_VENUE',
        getGridSpec() { return { origin, timeframeUnit: 'seconds', alignment: 'CUSTOM' }; },
        fetchChunk: vi.fn(async ({ from, to }) => {
          if (from === 1060 && to === 1060) {
            throw new Error('Exchange unavailable for repair');
          }
          return [
            makeCandle(1000, 100),
            { time: 1060, open: 100, high: 90, low: 95, close: 95, volume: 10 }, // corrupt candle
            makeCandle(1120, 102),
          ];
        }),
      };

      const cache = new CandleCache({ enableIDB: false });
      const store = new CandleStore();
      const mgr = new HistoricalDataManager({ provider: gappedProvider, store, cache });

      let readyDegradedFired = false;
      mgr.on(DataEvents.READY_DEGRADED, () => { readyDegradedFired = true; });

      const { candles, metadata, quality } = await mgr.load({
        symbol: 'BTCUSD',
        timeframe: '1m',
        from: 1000,
        to: 1120,
        policy: 'REPAIR',
        origin,
      });

      // 8. DEGRADED means explicitly incomplete/corrupt
      expect(quality).toBe('DEGRADED');
      expect(metadata.integrityStatus).toBe(INTEGRITY_STATUS.DEGRADED);
      expect(readyDegradedFired).toBe(true);

      // 9. READY never conceals a failed repair
      expect(metadata.repairRequested).toBe(1);
      expect(metadata.repairSucceeded).toBe(0);
      expect(metadata.repairFailed).toBe(1);
      expect(metadata.repairSuccess).toBe(false);

      // Failed repair never contaminated cache
      const cached = cache.get('BTCUSD', '1m', 1000, 1120, {
        timeframeSec: 60,
        venue: 'TEST_VENUE',
        gridOrigin: origin,
      });
      expect(cached.hit).toBe(false);
      expect(cached.candles.length).toBe(0);
    });

    it('isolates cache namespace by venue and gridOrigin', () => {
      const cache = new CandleCache({ enableIDB: false });
      const candles = [makeCandle(1000, 100), makeCandle(1060, 101)];

      // Cache for Delta with origin 1000
      cache.set('BTCUSD', '1m', 1000, 1060, candles, {
        timeframeSec: 60,
        venue: VENUES.DELTA_EXCHANGE,
        gridOrigin: 1000,
      });

      // Cache lookup for Binance with origin 0 should be a MISS
      const binanceLookup = cache.get('BTCUSD', '1m', 1000, 1060, {
        timeframeSec: 60,
        venue: VENUES.BINANCE_FUTURES,
        gridOrigin: 0,
      });
      expect(binanceLookup.hit).toBe(false);
      expect(binanceLookup.candles.length).toBe(0);

      // Cache lookup for Delta with origin 1000 should be a HIT
      const deltaLookup = cache.get('BTCUSD', '1m', 1000, 1060, {
        timeframeSec: 60,
        venue: VENUES.DELTA_EXCHANGE,
        gridOrigin: 1000,
      });
      expect(deltaLookup.hit).toBe(true);
      expect(deltaLookup.candles.length).toBe(2);
    });
  });
});
