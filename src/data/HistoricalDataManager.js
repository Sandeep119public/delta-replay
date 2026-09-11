import { EventEmitter } from '../core/EventEmitter.js';
import { CandleStore } from './CandleStore.js';
import { CandleCache } from './CandleCache.js';
import { CandleIntegrity, INTEGRITY_STATUS } from './CandleIntegrity.js';
import { CandleNormalizer } from './CandleNormalizer.js';
import { CandleValidator } from './CandleValidator.js';
import { TIMEFRAME_SECONDS, normalizeRange, computeGridMissing } from './CandleGrid.js';

export const DataEvents = {
  LOADING_STARTED: 'dataLoadingStarted',
  CHUNK_RECEIVED: 'dataChunkReceived',
  PROGRESS: 'dataProgress',
  READY: 'dataReady',
  READY_DEGRADED: 'dataReadyDegraded',
  ERROR: 'dataError',
};

export class HistoricalDataManager extends EventEmitter {
  constructor({ provider, store = null, cache = null, concurrency = 2, maxRetries = 3, chunkSize = 2000, strictMode = false } = {}) {
    super();
    if (!provider) throw new Error('HistoricalDataManager requires provider');
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('concurrency must be a positive integer');
    if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new TypeError('maxRetries must be a non-negative integer');
    if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new TypeError('chunkSize must be a positive integer');
    this.provider = provider;
    this.store = store ?? new CandleStore();
    this.cache = cache ?? new CandleCache();
    this.concurrency = concurrency;
    this.maxRetries = maxRetries;
    this.chunkSize = chunkSize;
    this.strictMode = strictMode;
  }

  async load({ symbol, timeframe, from, to, signal, strict = this.strictMode, allowGaps = false, halfOpen = false, policy = null, origin = null, venue = null } = {}) {
    if (!symbol || !timeframe) throw new Error('symbol and timeframe required');
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('from/to must be numbers');
    if (from >= to) throw new Error('from must be < to');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const tfSec = TIMEFRAME_SECONDS[timeframe];
    if (!tfSec) throw new Error(`Unsupported timeframe ${timeframe}`);
    const gridSpec = typeof this.provider?.getGridSpec === 'function' ? this.provider.getGridSpec() : null;
    const gridOrigin = origin ?? gridSpec?.origin ?? this.provider?.gridOrigin ?? (this.provider?.client?.gridOrigin ?? 0);
    const resolvedVenue = venue ?? this.provider?.venue ?? 'DEFAULT';
    const range = normalizeRange(from, to, tfSec, gridOrigin);
    if (!range.hasCandle) {
      const err = new Error(`Requested range [${from}, ${to}] contains no complete candle for timeframe ${timeframe}`);
      err.code = 'INVALID_REQUEST';
      this.emit(DataEvents.ERROR, err);
      throw err;
    }
    const { requestedFrom, requestedTo, effectiveFrom, effectiveTo } = range;
    this.emit(DataEvents.LOADING_STARTED, { symbol, timeframe, from: requestedFrom, to: requestedTo, effectiveFrom, effectiveTo, venue: resolvedVenue, gridOrigin });

    const estimated = Math.floor((effectiveTo - effectiveFrom) / tfSec) + 1;
    const MAX_ALLOWED = 100000;
    if (estimated > MAX_ALLOWED) {
      const err = new Error(`Requested range would require ~${estimated} candles (max ${MAX_ALLOWED} for ${timeframe}). Use a larger timeframe or smaller date range.`);
      err.code = 'INVALID_REQUEST';
      this.emit(DataEvents.ERROR, err);
      throw err;
    }

    const integrityOptions = { from: effectiveFrom, to: effectiveTo, timeframeSec: tfSec, origin: gridOrigin, strict, allowGaps, halfOpen, policy: policy ?? (strict ? 'STRICT' : 'REPAIR'), timestampUnit: 'seconds' };
    let cacheRes = this.cache.get(symbol, timeframe, effectiveFrom, effectiveTo, { timeframeSec: tfSec, venue: resolvedVenue, gridOrigin });

    if (!cacheRes.hit && this.cache.enableIDB) {
      try {
        const idb = await this.cache.loadFromIDB(symbol, timeframe, { venue: resolvedVenue, gridOrigin });
        if (idb) cacheRes = this.cache.get(symbol, timeframe, effectiveFrom, effectiveTo, { timeframeSec: tfSec, venue: resolvedVenue, gridOrigin });
      } catch (error) {
        const cacheError = new Error(`Persistent cache read failed: ${error?.message || String(error)}`);
        cacheError.code = 'CACHE_ERROR';
        cacheError.cause = error;
        cacheError.context = { symbol, timeframe, from: effectiveFrom, to: effectiveTo, venue: resolvedVenue, gridOrigin };
        this.emit(DataEvents.ERROR, cacheError);
      }
    }

    if (cacheRes.hit) {
      try {
        const integrityCheck = CandleIntegrity.process(cacheRes.candles, { from: effectiveFrom, to: effectiveTo, timeframeSec: tfSec, origin: gridOrigin, halfOpen, policy: 'REPAIR', timestampUnit: 'seconds' });
        const validCandles = integrityCheck.validCandles;
        const metadata = integrityCheck.metadata;
        const isClean = metadata.invalidCount === 0 && (!strict || allowGaps || metadata.gaps.length === 0);
        if (validCandles.length === 0) {
          this.cache.invalidate(symbol, timeframe, { venue: resolvedVenue, gridOrigin });
          cacheRes = { hit: false, candles: [], missing: [{ from: effectiveFrom, to: effectiveTo }], intervals: [] };
        } else {
          const actualIntervals = CandleCache.intervalsFromCandles(validCandles, tfSec);
          const authoritativeCoverage = this.cache.getCoverage(symbol, timeframe, { timeframeSec: tfSec, venue: resolvedVenue, gridOrigin });
          let realMissing = computeGridMissing(effectiveFrom, effectiveTo, authoritativeCoverage, tfSec);
          if (realMissing.length === 0 && !isClean && metadata.gaps.length > 0) realMissing = metadata.gaps.map(g => ({ from: g.from, to: g.to + (halfOpen ? tfSec : 0) }));
          if (realMissing.length === 0 && isClean) {
            if (JSON.stringify(authoritativeCoverage) !== JSON.stringify(actualIntervals)) this.cache.repairIntervals(symbol, timeframe, { timeframeSec: tfSec, venue: resolvedVenue, gridOrigin });
            this.store.load(validCandles, { symbol, timeframe, requestedFrom, requestedTo, effectiveFrom, effectiveTo, venue: resolvedVenue, gridOrigin, quality: 'VALID', ...metadata, cached: true });
            this.emit(DataEvents.READY, { candles: validCandles, metadata: this.store.getMetadata(), quality: 'VALID' });
            this.emit(DataEvents.PROGRESS, { loaded: validCandles.length, total: validCandles.length, pct: 100 });
            return { candles: validCandles, metadata: this.store.getMetadata(), quality: 'VALID' };
          }
          this.cache.reconcile(symbol, timeframe, { from: effectiveFrom, to: effectiveTo, candles: validCandles, timeframeSec: tfSec, venue: resolvedVenue, gridOrigin, halfOpen });
          cacheRes = { hit: false, candles: validCandles, missing: realMissing.length > 0 ? realMissing : [{ from: effectiveFrom, to: effectiveTo }], intervals: actualIntervals };
        }
      } catch (error) {
        const cacheError = new Error(`Cache integrity validation failed: ${error?.message || String(error)}`);
        cacheError.code = 'CACHE_INTEGRITY_ERROR';
        cacheError.cause = error;
        cacheError.context = { symbol, timeframe, from: effectiveFrom, to: effectiveTo, venue: resolvedVenue, gridOrigin };
        this.emit(DataEvents.ERROR, cacheError);
        this.cache.invalidate(symbol, timeframe, { venue: resolvedVenue, gridOrigin });
        cacheRes = { hit: false, candles: [], missing: [{ from: effectiveFrom, to: effectiveTo }], intervals: [] };
      }
    }

    if (!cacheRes.hit && cacheRes.candles.length > 0) {
      try {
        const { validCandles: cachedValid } = CandleIntegrity.process(cacheRes.candles, { from: effectiveFrom, to: effectiveTo, timeframeSec: tfSec, origin: gridOrigin, policy: 'REPAIR', timestampUnit: 'seconds' });
        if (cachedValid.length !== cacheRes.candles.length) {
          const actualCachedIntervals = CandleCache.intervalsFromCandles(cachedValid, tfSec);
          cacheRes.candles = cachedValid;
          cacheRes.missing = computeGridMissing(effectiveFrom, effectiveTo, actualCachedIntervals, tfSec);
          cacheRes.intervals = actualCachedIntervals;
          this.cache.reconcile(symbol, timeframe, { from: effectiveFrom, to: effectiveTo, candles: cachedValid, timeframeSec: tfSec, venue: resolvedVenue, gridOrigin, halfOpen });
        }
      } catch (error) {
        const cacheError = new Error(`Partial cache validation failed: ${error?.message || String(error)}`);
        cacheError.code = 'CACHE_INTEGRITY_ERROR';
        cacheError.cause = error;
        cacheError.context = { symbol, timeframe, from: effectiveFrom, to: effectiveTo, venue: resolvedVenue, gridOrigin };
        this.emit(DataEvents.ERROR, cacheError);
        cacheRes = { hit: false, candles: [], missing: [{ from: effectiveFrom, to: effectiveTo }], intervals: [] };
      }
    }

    const missingRanges = cacheRes.missing?.length ? cacheRes.missing : [{ from: effectiveFrom, to: effectiveTo }];
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
    const rawCollected = [...(cacheRes.candles || [])];
    const emitProgress = () => this.emit(DataEvents.PROGRESS, { loaded: rawCollected.length, totalChunks, completed, pct: totalChunks === 0 ? 100 : Math.round((completed / totalChunks) * 100) });

    const isRetryable = (err) => {
      if (!err || err.name === 'AbortError') return false;
      const category = err.category ?? err.code;
      if (['INVALID_REQUEST', 'INVALID_RESPONSE', 'NO_DATA', 'CORS', 'CORS_ERROR', 'CACHE', 'CACHE_ERROR', 'CACHE_INTEGRITY_ERROR', 'INTEGRITY', 'INTEGRITY_ERROR', 'INTEGRITY_PROCESSING_FAILED'].includes(category)) return false;
      if (category === 'TIMEOUT' || err.name === 'TimeoutError' || category === 'NETWORK' || category === 'NETWORK_ERROR') return true;
      const status = err.details?.status ?? err.status;
      return status === 408 || status === 429 || (typeof status === 'number' && status >= 500 && status < 600);
    };

    const sleep = (ms, abortSignal) => new Promise((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        abortSignal?.removeEventListener('abort', onAbort);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        abortSignal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      abortSignal?.addEventListener('abort', onAbort, { once: true });
    });

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
        if (!Array.isArray(raw)) {
          throw Object.assign(new Error('Provider returned a non-array candle chunk'), {
            code: 'INVALID_RESPONSE',
            details: { chunk: { ...chunk }, provider: this.provider.constructor?.name ?? 'unknown' },
          });
        }
        return raw;
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        if (attempt < this.maxRetries && isRetryable(err)) {
          const backoff = Math.min(5000, Math.pow(2, attempt) * 200 + Math.random() * 100);
          await sleep(backoff, signal);
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
        rawCollected.push(...raw);
        this.emit(DataEvents.CHUNK_RECEIVED, { index: chunkIdx, chunk, count: raw.length });
        emitProgress();
      }
    });

    try {
      await Promise.all(workers);
    } catch (err) {
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

    let validCandles;
    let metadata;
    try {
      const integrityRes = CandleIntegrity.process(allRaw, integrityOptions);
      validCandles = integrityRes.validCandles;
      metadata = integrityRes.metadata;
    } catch (err) {
      this.emit(DataEvents.ERROR, err);
      throw err;
    }

    const effectivePolicy = policy ?? (strict ? 'STRICT' : 'REPAIR');
    if (effectivePolicy === 'REPAIR' && metadata.repairRanges?.length > 0) {
      const repairRequested = metadata.repairRanges.length;
      const repairedMap = new Map();
      const repairFailures = [];
      for (const rRange of metadata.repairRanges) {
        try {
          const freshRaw = await fetchChunkWithRetry(rRange);
          if (freshRaw.length === 0) throw Object.assign(new Error('Repair returned no candles'), { code: 'NO_DATA' });
          const normalizedChunk = CandleNormalizer.normalizeBatch(freshRaw, { timestampUnit: 'seconds' });
          for (const c of normalizedChunk) {
            const v = CandleValidator.validate(c);
            if (v.valid && c.time >= rRange.from && c.time <= rRange.to) repairedMap.set(c.time, c);
          }
          if (!repairedMap.has(rRange.from)) throw Object.assign(new Error(`Repair response did not contain candle ${rRange.from}`), { code: 'REPAIR_MISSING_CANDLE' });
        } catch (error) {
          repairFailures.push({ range: { ...rRange }, code: error?.code || 'REPAIR_FAILED', message: error?.message || String(error), cause: error });
        }
      }

      let allNormalized;
      try {
        allNormalized = CandleNormalizer.normalizeBatch(allRaw, { timestampUnit: 'seconds' });
      } catch (error) {
        const normalizationError = new Error(`Repair normalization failed: ${error?.message || String(error)}`);
        normalizationError.code = 'INTEGRITY_PROCESSING_FAILED';
        normalizationError.cause = error;
        this.emit(DataEvents.ERROR, normalizationError);
        throw normalizationError;
      }

      const repairTimes = new Set(metadata.repairRanges.map(r => r.from));
      const combined = allNormalized.filter(c => !repairTimes.has(c.time)).concat([...repairedMap.values()]);
      const finalIntegrity = CandleIntegrity.process(combined, integrityOptions);
      validCandles = finalIntegrity.validCandles;
      metadata = { ...finalIntegrity.metadata, repairRequested, repairSucceeded: repairedMap.size, repairFailed: repairFailures.length, repairFailures };
    }

    const quality = metadata.invalidCount > 0 || metadata.gaps.length > 0 || metadata.repairFailed > 0 ? 'DEGRADED' : 'VALID';
    const result = { candles: validCandles, metadata: { ...metadata, quality }, quality };
    this.store.load(validCandles, { symbol, timeframe, requestedFrom, requestedTo, effectiveFrom, effectiveTo, venue: resolvedVenue, gridOrigin, ...metadata });
    this.cache.set(symbol, timeframe, validCandles, { timeframeSec: tfSec, venue: resolvedVenue, gridOrigin });
    this.emit(quality === 'VALID' ? DataEvents.READY : DataEvents.READY_DEGRADED, result);
    this.emit(DataEvents.PROGRESS, { loaded: validCandles.length, total: validCandles.length, pct: 100 });
    return result;
  }

  isRetryable(err) {
    const category = err?.category ?? err?.code;
    if (['INVALID_REQUEST', 'INVALID_RESPONSE', 'NO_DATA', 'CORS', 'CORS_ERROR', 'CACHE', 'CACHE_ERROR', 'CACHE_INTEGRITY_ERROR', 'INTEGRITY', 'INTEGRITY_ERROR', 'INTEGRITY_PROCESSING_FAILED'].includes(category)) return false;
    if (category === 'TIMEOUT' || category === 'NETWORK' || category === 'NETWORK_ERROR') return true;
    const status = err?.details?.status ?? err?.status;
    return status === 408 || status === 429 || (typeof status === 'number' && status >= 500 && status < 600);
  }
}
