import { EventEmitter } from '../core/EventEmitter.js';
import { CandleStore } from './CandleStore.js';
import { CandleCache } from './CandleCache.js';
import { CandleIntegrity } from './CandleIntegrity.js';
import { TIMEFRAME_SECONDS } from './DeltaCandleProvider.js';

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
   * @param {import('./DeltaCandleProvider.js').DeltaCandleProvider} opts.provider
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
   * @param {object} params
   * @param {string} params.symbol
   * @param {string} params.timeframe
   * @param {number} params.from - unix sec
   * @param {number} params.to - unix sec
   * @param {AbortSignal} [params.signal]
   * @param {boolean} [params.strict]
   * @param {boolean} [params.allowGaps=false]
   * @param {boolean} [params.halfOpen=false]
   * @returns {Promise<{ candles: Array, metadata: object }>}
   */
  async load({ symbol, timeframe, from, to, signal, strict = this.strictMode, allowGaps = false, halfOpen = false } = {}) {
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
    };

    // Try IDB if memory miss
    let cacheRes = this.cache.get(symbol, timeframe, from, to);
    if (!cacheRes.hit && this.cache.enableIDB) {
      const idb = await this.cache.loadFromIDB(symbol, timeframe);
      if (idb) cacheRes = this.cache.get(symbol, timeframe, from, to);
    }
    // If cache claims hit, verify via integrity that it actually covers range without gaps/corruption (adversarial audit)
    if (cacheRes.hit) {
      let validCandles = [];
      let metadata = null;
      try {
        const integrityCheck = CandleIntegrity.process(cacheRes.candles, integrityOptions);
        validCandles = integrityCheck.validCandles;
        metadata = integrityCheck.metadata;
      } catch (err) {
        if (strict) {
          this.emit(DataEvents.ERROR, err);
          throw err;
        }
      }
      if (validCandles.length === 0) {
        // Cache hit but all candles corrupted or gapped in strict -> treat as full miss and discard stale cache
        const key = this.cache._key(symbol, timeframe);
        this.cache._memory.delete(key);
        if (this.cache.enableIDB) this.cache._deleteIDBEntry(key).catch(()=>{});
        cacheRes = { hit: false, candles: [], missing: [{ from, to }], intervals: [] };
      } else {
        const actualIntervals = CandleCache.intervalsFromCandles(validCandles, tfSec);
        const realMissing = this.cache._computeMissing(from, to, actualIntervals);
        if (realMissing.length === 0) {
          // True hit: also repair stored intervals if stale (e.g., previously false full interval but now verified gapless)
          const key = this.cache._key(symbol, timeframe);
          const entry = this.cache._memory.get(key);
          if (entry && JSON.stringify(entry.intervals) !== JSON.stringify(actualIntervals)) {
            entry.intervals = actualIntervals;
            entry.version = this.cache._version;
            if (this.cache.enableIDB) this.cache._persistIDB(key, entry).catch(()=>{});
          }
          this.store.load(validCandles, { symbol, timeframe, requestedFrom: from, requestedTo: to, ...metadata, cached: true });
          this.emit(DataEvents.READY, { candles: validCandles, metadata: this.store.getMetadata() });
          this.emit(DataEvents.PROGRESS, { loaded: validCandles.length, total: validCandles.length, pct: 100 });
          return { candles: validCandles, metadata: this.store.getMetadata() };
        } else {
          // False hit: cache claimed full coverage but gaps/corruption detected -> treat as partial and repair truthfully
          const key = this.cache._key(symbol, timeframe);
          const entry = this.cache._memory.get(key);
          if (entry) {
            // Replace with truthful intervals (not merge, to avoid re-creating false)
            entry.intervals = actualIntervals;
            entry.candles = validCandles.slice().sort((a,b)=>a.time-b.time);
            // Also dedup map already via integrity, but ensure sorted
            entry.version = this.cache._version;
            if (this.cache.enableIDB) this.cache._persistIDB(key, entry).catch(()=>{});
          }
          cacheRes = { hit: false, candles: validCandles, missing: realMissing, intervals: actualIntervals };
        }
      }
    }
    // For partial hits, re-validate cached slice to detect corruption/unsorted/duplicates and adjust missing
    if (!cacheRes.hit && cacheRes.candles.length > 0) {
      try {
        const { validCandles: cachedValid } = CandleIntegrity.process(cacheRes.candles, { from, to, timeframeSec: tfSec });
        if (cachedValid.length !== cacheRes.candles.length) {
          const actualCachedIntervals = CandleCache.intervalsFromCandles(cachedValid, tfSec);
          const realMissing = this.cache._computeMissing(from, to, actualCachedIntervals);
          cacheRes.candles = cachedValid;
          cacheRes.missing = realMissing;
          cacheRes.intervals = actualCachedIntervals;
          // Also correct memory entry intervals if they were stale
          const key = this.cache._key(symbol, timeframe);
          const entry = this.cache._memory.get(key);
          if (entry) {
            // Recompute full intervals from entry's candles (validated)
            const allValid = CandleIntegrity.process(entry.candles, { from: entry.intervals[0]?.from ?? from, to: entry.intervals[entry.intervals.length-1]?.to ?? to, timeframeSec: tfSec }).validCandles;
            // Instead just keep entry.candles filtered; but repair intervals to truthful if needed via intervalsFromCandles on entry.candles
            const truthful = CandleCache.intervalsFromCandles(entry.candles.filter(c=>Number.isFinite(c.time)), tfSec);
            // Only repair if we detected mismatch
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

    // Build chunk list for missing ranges
    const chunks = [];
    for (const mr of missingRanges) {
      let cur = mr.from;
      while (cur <= mr.to) {
        const chunkEnd = Math.min(mr.to, cur + this.chunkSize * tfSec - 1);
        chunks.push({ from: cur, to: chunkEnd });
        cur = chunkEnd + 1;
      }
    }

    const totalChunks = chunks.length;
    let completed = 0;
    const rawCollected = [...cacheRes.candles]; // start with cached slice
    // For progress
    const emitProgress = () => {
      const pct = totalChunks === 0 ? 100 : Math.round((completed / totalChunks) * 100);
      this.emit(DataEvents.PROGRESS, { loaded: rawCollected.length, totalChunks, completed, pct });
    };

    // Helper to classify retryable vs non-retryable per PHASE 6.6A spec
    const isRetryable = (err) => {
      if (!err) return false;
      if (err.name === 'AbortError' || err.name === 'TimeoutError') return false;
      // Illegal invocation must never be retried
      const msg = (err.message ?? String(err)).toLowerCase();
      if (msg.includes('illegal invocation')) return false;
      if (err.code === 'INVALID_REQUEST' || err.code === 'INVALID_RESPONSE' || err.code === 'NO_DATA') return false;
      if (err.code === 'TIMEOUT') return true;
      if (err.code === 'NETWORK_ERROR') return true; // transient
      if (err.code === 'CORS_ERROR') return false;
      if (err.code === 'API_ERROR') {
        const status = err.details?.status ?? err.status;
        if (status === 408 || status === 429) return true;
        if (typeof status === 'number' && status >= 500 && status < 600) return true;
        return false;
      }
      // Fallback: check status-based retry for generic errors
      const status = err.details?.status ?? err.status;
      if (status === 408 || status === 429) return true;
      if (typeof status === 'number' && status >= 500 && status < 600) return true;
      return false;
    };

    // Concurrency limited fetch with retry
    const fetchChunkWithRetry = async (chunk, attempt = 0) => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const apiSymbol = symbol === 'BTCUSD' ? 'BTCUSDT' : (symbol === 'ETHUSD' ? 'ETHUSDT' : symbol);
      try {
        let raw;
        if (typeof this.provider.fetchChunk === 'function') {
          raw = await this.provider.fetchChunk({ symbol: apiSymbol, timeframe, from: chunk.from, to: chunk.to, signal });
        } else if (typeof this.provider.getCandles === 'function') {
          raw = await this.provider.getCandles({ symbol: apiSymbol, timeframe, from: chunk.from, to: chunk.to, signal });
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

    // Execute with concurrency
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
        rawCollected.push(...raw);
        this.emit(DataEvents.CHUNK_RECEIVED, { index: chunkIdx, chunk, count: raw.length });
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

    // Process integrity: merge cached + fetched raw
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
    // Cache expects intervals, pass as opts
    this.cache.set(symbol, timeframe, from, to, validCandles, { intervals: actualIntervals.length ? actualIntervals : [{ from, to }] });
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
