import { EventEmitter } from '../core/EventEmitter.js';
import { CandleStore } from './CandleStore.js';
import { CandleCache } from './CandleCache.js';
import { CandleIntegrity } from './CandleIntegrity.js';
import { TIMEFRAME_SECONDS } from './CandleGrid.js';

export const DataEvents = {
  LOADING_STARTED: 'dataLoadingStarted',
  CHUNK_RECEIVED: 'dataChunkReceived',
  PROGRESS: 'dataProgress',
  READY: 'dataReady',
  ERROR: 'dataError',
};

export class HistoricalDataManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('./CandleProvider.js').CandleProvider} opts.provider
   * @param {CandleStore} [opts.store]
   * @param {CandleCache} [opts.cache]
   * @param {number} [opts.concurrency=2]
   * @param {number} [opts.maxRetries=3]
   * @param {number} [opts.chunkSize=2000]
   * @param {boolean} [opts.strictMode=false]
   */
  constructor({ provider, store = null, cache = null, concurrency = 2, maxRetries = 3, chunkSize = 2000, strictMode = false } = {}) {
    super();
    if (!provider) throw new Error('HistoricalDataManager requires provider');
    this.provider = provider;
    this.store = store ?? new CandleStore();
    this.cache = cache ?? new CandleCache();
    this.concurrency = concurrency;
    this.maxRetries = maxRetries;
    this.chunkSize = chunkSize;
    this.strictMode = strictMode;
  }

  /**
   * Load historical data for range, with cache, chunking, retry, abort, progress.
   * Operates on discrete candle lattice boundaries.
   * @param {object} params
   * @param {string} params.symbol
   * @param {string} params.timeframe
   * @param {number} params.from - unix sec
   * @param {number} params.to - unix sec
   * @param {AbortSignal} [params.signal]
   * @param {boolean} [params.strict]
   * @param {boolean} [params.allowGaps=false]
   * @param {boolean} [params.halfOpen=false]
   * @param {string} [params.policy] - 'STRICT' | 'REPAIR' | 'LENIENT'
   * @returns {Promise<{ candles: Array, metadata: object }>}
   */
  async load({ symbol, timeframe, from, to, signal, strict = this.strictMode, allowGaps = false, halfOpen = false, policy = null } = {}) {
    if (!symbol || !timeframe) throw new Error('symbol and timeframe required');
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('from/to must be numbers');
    if (from >= to) throw new Error('from must be < to');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const tfSec = TIMEFRAME_SECONDS[timeframe];
    if (!tfSec) throw new Error(`Unsupported timeframe ${timeframe}`);

    this.emit(DataEvents.LOADING_STARTED, { symbol, timeframe, from, to });

    // Estimated size check before network (protect browser)
    const estimated = Math.ceil((to - from) / tfSec);
    const MAX_ALLOWED = 100000;
    if (estimated > MAX_ALLOWED) {
      const err = new Error(`Requested range would require ~${estimated} candles (max ${MAX_ALLOWED} for ${timeframe}). Use a larger timeframe or smaller date range.`);
      err.code = 'INVALID_REQUEST';
      this.emit(DataEvents.ERROR, err);
      throw err;
    }

    const integrityOptions = {
      from,
      to,
      timeframeSec: tfSec,
      strict,
      allowGaps,
      halfOpen,
      policy: policy ?? (strict ? 'STRICT' : 'REPAIR'),
    };

    // Try IDB if memory miss
    let cacheRes = this.cache.get(symbol, timeframe, from, to, { timeframeSec: tfSec });
    if (!cacheRes.hit && this.cache.enableIDB) {
      const idb = await this.cache.loadFromIDB(symbol, timeframe);
      if (idb) cacheRes = this.cache.get(symbol, timeframe, from, to, { timeframeSec: tfSec });
    }

    // If cache claims hit, verify via integrity that it actually covers range without gaps/corruption
    if (cacheRes.hit) {
      const integrityCheck = CandleIntegrity.process(cacheRes.candles, {
        from,
        to,
        timeframeSec: tfSec,
        halfOpen,
        policy: 'REPAIR',
      });
      const validCandles = integrityCheck.validCandles;
      const metadata = integrityCheck.metadata;
      const isClean = metadata.invalidCount === 0 && (!strict || allowGaps || metadata.gaps.length === 0);

      if (validCandles.length === 0) {
        const key = this.cache._key(symbol, timeframe);
        this.cache._memory.delete(key);
        if (this.cache.enableIDB) this.cache._deleteIDBEntry(key).catch(() => {});
        cacheRes = { hit: false, candles: [], missing: [{ from, to }], intervals: [] };
      } else {
        const actualIntervals = CandleCache.intervalsFromCandles(validCandles, tfSec);
        let realMissing = this.cache._computeMissing(from, to, actualIntervals, tfSec);
        if (realMissing.length === 0 && !isClean && metadata.gaps.length > 0) {
          realMissing = metadata.gaps.map(g => ({ from: g.from, to: g.to + (halfOpen ? tfSec : 0) }));
        }

        if (realMissing.length === 0 && isClean) {
          const key = this.cache._key(symbol, timeframe);
          const entry = this.cache._memory.get(key);
          if (entry && JSON.stringify(entry.intervals) !== JSON.stringify(actualIntervals)) {
            entry.intervals = actualIntervals;
            entry.version = this.cache._version;
            if (this.cache.enableIDB) this.cache._persistIDB(key, entry).catch(() => {});
          }
          this.store.load(validCandles, { symbol, timeframe, requestedFrom: from, requestedTo: to, ...metadata, cached: true });
          this.emit(DataEvents.READY, { candles: validCandles, metadata: this.store.getMetadata() });
          this.emit(DataEvents.PROGRESS, { loaded: validCandles.length, total: validCandles.length, pct: 100 });
          return { candles: validCandles, metadata: this.store.getMetadata() };
        } else {
          const key = this.cache._key(symbol, timeframe);
          const entry = this.cache._memory.get(key);
          if (entry) {
            entry.intervals = actualIntervals;
            entry.candles = validCandles.slice().sort((a, b) => a.time - b.time);
            entry.version = this.cache._version;
            if (this.cache.enableIDB) this.cache._persistIDB(key, entry).catch(() => {});
          }
          cacheRes = {
            hit: false,
            candles: validCandles,
            missing: realMissing.length > 0 ? realMissing : [{ from, to }],
            intervals: actualIntervals,
          };
        }
      }
    }

    // For partial hits, re-validate cached slice to detect corruption and adjust missing
    if (!cacheRes.hit && cacheRes.candles.length > 0) {
      try {
        const { validCandles: cachedValid } = CandleIntegrity.process(cacheRes.candles, { from, to, timeframeSec: tfSec, policy: 'REPAIR' });
        if (cachedValid.length !== cacheRes.candles.length) {
          const actualCachedIntervals = CandleCache.intervalsFromCandles(cachedValid, tfSec);
          const realMissing = this.cache._computeMissing(from, to, actualCachedIntervals, tfSec);
          cacheRes.candles = cachedValid;
          cacheRes.missing = realMissing;
          cacheRes.intervals = actualCachedIntervals;

          const key = this.cache._key(symbol, timeframe);
          const entry = this.cache._memory.get(key);
          if (entry) {
            const truthful = CandleCache.intervalsFromCandles(entry.candles.filter(c => Number.isFinite(c.time)), tfSec);
            if (truthful.length && JSON.stringify(truthful) !== JSON.stringify(entry.intervals)) {
              entry.intervals = truthful;
              entry.version = this.cache._version;
            }
          }
        }
      } catch {}
    }

    // Determine missing ranges (if partial hit, we still need to fetch missing)
    const missingRanges = cacheRes.missing.length ? cacheRes.missing : [{ from, to }];

    // Build chunk list for missing ranges on discrete lattice
    const chunks = [];
    for (const mr of missingRanges) {
      let cur = mr.from;
      while (cur <= mr.to) {
        const chunkSpan = (this.chunkSize - 1) * tfSec;
        const chunkEnd = Math.min(mr.to, cur + chunkSpan);
        chunks.push({ from: cur, to: chunkEnd });
        cur = chunkEnd + tfSec;
      }
    }

    const totalChunks = chunks.length;
    let completed = 0;
    const rawCollected = [...cacheRes.candles];

    const emitProgress = () => {
      const pct = totalChunks === 0 ? 100 : Math.round((completed / totalChunks) * 100);
      this.emit(DataEvents.PROGRESS, { loaded: rawCollected.length, totalChunks, completed, pct });
    };

    const isRetryable = (err) => {
      if (!err) return false;
      if (err.name === 'AbortError') return false;
      const msg = (err.message ?? String(err)).toLowerCase();
      if (msg.includes('illegal invocation')) return false;
      if (err.code === 'INVALID_REQUEST' || err.code === 'INVALID_RESPONSE' || err.code === 'NO_DATA') return false;
      if (err.code === 'TIMEOUT' || err.name === 'TimeoutError') return true;
      if (err.code === 'NETWORK_ERROR') return true;
      if (err.code === 'CORS_ERROR') return false;
      if (err.code === 'API_ERROR') {
        const status = err.details?.status ?? err.status;
        if (status === 408 || status === 429) return true;
        if (typeof status === 'number' && status >= 500 && status < 600) return true;
        return false;
      }
      const status = err.details?.status ?? err.status;
      if (status === 408 || status === 429) return true;
      if (typeof status === 'number' && status >= 500 && status < 600) return true;
      return false;
    };

    const fetchChunkWithRetry = async (chunk, attempt = 0) => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        let raw;
        if (typeof this.provider.fetchChunk === 'function') {
          raw = await this.provider.fetchChunk({ symbol, timeframe, from: chunk.from, to: chunk.to, signal });
        } else if (typeof this.provider.getCandles === 'function') {
          raw = await this.provider.getCandles({ symbol, timeframe, from: chunk.from, to: chunk.to, signal });
        } else {
          throw new Error('Provider must implement fetchChunk or getCandles');
        }
        return raw;
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        if (attempt < this.maxRetries && isRetryable(err)) {
          const backoff = Math.min(5000, Math.pow(2, attempt) * 200 + Math.random() * 100);
          await new Promise((res, rej) => {
            const t = setTimeout(res, backoff);
            signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
          });
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return fetchChunkWithRetry(chunk, attempt + 1);
        }
        throw err;
      }
    };

    const results = [];
    let idx = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, chunks.length) }, async () => {
      while (idx < chunks.length) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const chunkIdx = idx++;
        const chunk = chunks[chunkIdx];
        const raw = await fetchChunkWithRetry(chunk);
        results[chunkIdx] = raw;
        completed++;
        if (Array.isArray(raw)) {
          rawCollected.push(...raw);
          this.emit(DataEvents.CHUNK_RECEIVED, { index: chunkIdx, chunk, count: raw.length });
        } else {
          this.emit(DataEvents.CHUNK_RECEIVED, { index: chunkIdx, chunk, count: 0 });
        }
        emitProgress();
      }
    });

    try {
      await Promise.all(workers);
    } catch (err) {
      if (err?.name === 'AbortError') {
        this.emit(DataEvents.ERROR, err);
        throw err;
      }
      this.emit(DataEvents.ERROR, err);
      throw err;
    }

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const allRaw = rawCollected;

    if (allRaw.length === 0) {
      const err = new Error('No candles found');
      err.code = 'NO_DATA';
      this.emit(DataEvents.ERROR, err);
      throw err;
    }

    let validCandles, metadata;
    try {
      const integrityRes = CandleIntegrity.process(allRaw, integrityOptions);
      validCandles = integrityRes.validCandles;
      metadata = integrityRes.metadata;
    } catch (err) {
      this.emit(DataEvents.ERROR, err);
      throw err;
    }

    if (validCandles.length === 0) {
      const err = new Error('No valid candles after integrity');
      err.code = 'NO_DATA';
      this.emit(DataEvents.ERROR, err);
      throw err;
    }

    // Update cache with gap-aware intervals (verified coverage, not just requested)
    const actualIntervals = CandleCache.intervalsFromCandles(validCandles, tfSec);
    this.cache.set(symbol, timeframe, from, to, validCandles, {
      intervals: actualIntervals.length ? actualIntervals : [{ from, to }],
      timeframeSec: tfSec,
    });

    // Load store
    this.store.load(validCandles, { symbol, timeframe, requestedFrom: from, requestedTo: to, ...metadata });
    this.emit(DataEvents.READY, { candles: validCandles, metadata: this.store.getMetadata() });
    emitProgress();
    return { candles: validCandles, metadata: this.store.getMetadata() };
  }

  getStore() { return this.store; }
  getCache() { return this.cache; }
  clear() {
    this.store.clear();
    this.cache.clear();
  }
}
