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
   */
  constructor({ provider, store = null, cache = null, concurrency = 2, maxRetries = 3, chunkSize = 2000 } = {}) {
    super();
    if (!provider) throw new Error('HistoricalDataManager requires provider');
    this.provider = provider;
    this.store = store ?? new CandleStore();
    this.cache = cache ?? new CandleCache();
    this.concurrency = concurrency;
    this.maxRetries = maxRetries;
    this.chunkSize = chunkSize;
  }

  /**
   * Load historical data for range, with cache, chunking, retry, abort, progress.
   * @param {object} params
   * @param {string} params.symbol
   * @param {string} params.timeframe
   * @param {number} params.from - unix sec
   * @param {number} params.to - unix sec
   * @param {AbortSignal} [params.signal]
   * @returns {Promise<{ candles: Array, metadata: object }>}
   */
  async load({ symbol, timeframe, from, to, signal } = {}) {
    if (!symbol || !timeframe) throw new Error('symbol and timeframe required');
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('from/to must be numbers');
    if (from >= to) throw new Error('from must be < to');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const tfSec = TIMEFRAME_SECONDS[timeframe];
    if (!tfSec) throw new Error(`Unsupported timeframe ${timeframe}`);

    this.emit(DataEvents.LOADING_STARTED, { symbol, timeframe, from, to });

    // Check cache
    const cacheRes = this.cache.get(symbol, timeframe, from, to);
    if (cacheRes.hit) {
      const { validCandles, metadata } = CandleIntegrity.process(cacheRes.candles, { from, to, timeframeSec: tfSec });
      if (validCandles.length === 0) {
        const err = new Error('No valid candles in cache');
        err.code = 'NO_DATA';
        this.emit(DataEvents.ERROR, err);
        throw err;
      }
      this.store.load(validCandles, { symbol, timeframe, requestedFrom: from, requestedTo: to, ...metadata, cached: true });
      this.emit(DataEvents.READY, { candles: validCandles, metadata: this.store.getMetadata() });
      this.emit(DataEvents.PROGRESS, { loaded: validCandles.length, total: validCandles.length, pct: 100 });
      return { candles: validCandles, metadata: this.store.getMetadata() };
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

    // Concurrency limited fetch with retry
    const fetchChunkWithRetry = async (chunk, attempt = 0) => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const raw = await this.provider.client.fetchCandles({
          symbol,
          resolution: timeframe,
          start: chunk.from,
          end: chunk.to,
          signal,
        });
        return raw;
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        if (attempt < this.maxRetries && (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT' || err.code === 'API_ERROR' || err?.status === 429)) {
          const backoff = Math.pow(2, attempt) * 200 + Math.random() * 100;
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
    // rawCollected currently contains cached raw (?) cached were already normalized? We stored cached candles as canonical, not raw.
    // For cached part we added sliced canonical candles (already canonical) to rawCollected; for fetched we added raw.
    // To avoid double normalize, we need to handle: cached candles are canonical, fetched raw are raw.
    // Normalize all as if raw: canonical candles will be re-normalized but idempotent (numbers already).
    // So just process full rawCollected as if raw (CandleIntegrity will normalize).
    const allRaw = rawCollected;

    if (allRaw.length === 0) {
      const err = new Error('No candles found');
      err.code = 'NO_DATA';
      this.emit(DataEvents.ERROR, err);
      throw err;
    }

    const { validCandles, metadata } = CandleIntegrity.process(allRaw, { from, to, timeframeSec: tfSec });

    if (validCandles.length === 0) {
      const err = new Error('No valid candles after integrity');
      err.code = 'NO_DATA';
      this.emit(DataEvents.ERROR, err);
      throw err;
    }

    // Update cache with full valid range
    this.cache.set(symbol, timeframe, from, to, validCandles);
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
