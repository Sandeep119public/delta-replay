import { CandleProvider } from './CandleProvider.js';
import { CandleNormalizer } from './CandleNormalizer.js';
import { CandleValidator } from './CandleValidator.js';
import { DeltaClient, DeltaError, DELTA_DEFAULT_BASE } from './DeltaClient.js';
import { resolveVenueSymbol, VENUES } from './InstrumentConfig.js';

/**
 * DeltaCandleProvider - fetches real historical candles from Delta Exchange.
 * Handles: normalization, validation, sorting, dedup, chunked pagination, cache, abort, limits.
 */

export const SUPPORTED_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '1d', '1w'];
// API resolution == timeframe string
export const TIMEFRAME_SECONDS = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '6h': 21600,
  '1d': 86400,
  '1w': 604800,
};

export const MAX_CANDLES = 100000;
export const CHUNK_SIZE = 2000; // conservative per-request cap to handle observed limit

export class DeltaCandleProvider extends CandleProvider {
  /**
   * @param {object} opts
   * @param {string} [opts.baseUrl]
   * @param {DeltaClient} [opts.client]
   * @param {number} [opts.maxCandles]
   * @param {number} [opts.chunkSize]
   * @param {number} [opts.cacheSize]
   */
  constructor({ baseUrl = DELTA_DEFAULT_BASE, client = null, maxCandles = MAX_CANDLES, chunkSize = CHUNK_SIZE, cacheSize = 20, gridOrigin = null } = {}) {
    super();
    this.baseUrl = baseUrl;
    this.client = client ?? new DeltaClient({ baseUrl });
    this.maxCandles = maxCandles;
    this.chunkSize = chunkSize;
    this.cacheSize = cacheSize;
    this.gridOrigin = gridOrigin ?? (this.client?.gridOrigin ?? 0);
    this._cache = new Map(); // key -> canonical candles array
  }

  get venue() {
    return VENUES.DELTA_EXCHANGE;
  }

  getGridSpec() {
    return {
      origin: this.gridOrigin ?? 0,
      timeframeUnit: 'seconds',
      alignment: 'UTC',
    };
  }

  _cacheKey(symbol, timeframe, from, to) {
    return `${symbol}|${timeframe}|${from ?? ''}|${to ?? ''}`;
  }

  _addToCache(key, candles) {
    if (this.cacheSize <= 0) return;
    if (this._cache.has(key)) this._cache.delete(key);
    this._cache.set(key, candles);
    if (this._cache.size > this.cacheSize) {
      const first = this._cache.keys().next().value;
      this._cache.delete(first);
    }
  }

  // symbol mapping passthrough - no remap, user-supplied exact product symbol
  _validateParams({ symbol, timeframe, from, to }) {
    if (!symbol || typeof symbol !== 'string') {
      throw new DeltaError('INVALID_REQUEST', 'symbol is required');
    }
    if (!timeframe || !SUPPORTED_TIMEFRAMES.includes(timeframe)) {
      throw new DeltaError('INVALID_REQUEST', `Unsupported timeframe: ${timeframe}. Supported: ${SUPPORTED_TIMEFRAMES.join(', ')}`);
    }
    if (from != null && !Number.isFinite(from)) throw new DeltaError('INVALID_REQUEST', 'from must be unix seconds');
    if (to != null && !Number.isFinite(to)) throw new DeltaError('INVALID_REQUEST', 'to must be unix seconds');
    if (from != null && to != null && from >= to) {
      throw new DeltaError('INVALID_REQUEST', 'from must be < to');
    }
    // Estimate candle count to enforce MAX
    if (from != null && to != null) {
      const tfSec = TIMEFRAME_SECONDS[timeframe];
      const estimated = Math.ceil((to - from) / tfSec);
      if (estimated > this.maxCandles) {
        throw new DeltaError('INVALID_REQUEST', `Requested range would require ~${estimated} candles (max ${this.maxCandles} for ${timeframe}). Reduce the date range or use a larger timeframe.`, { estimated, max: this.maxCandles });
      }
      if (estimated <= 0) throw new DeltaError('INVALID_REQUEST', 'Range too small');
    }
  }

  async fetchChunk({ symbol, timeframe, from, to, signal } = {}) {
    const apiSymbol = resolveVenueSymbol(symbol, VENUES.DELTA_EXCHANGE);
    return this.client.fetchCandles({ symbol: apiSymbol, resolution: timeframe, start: from, end: to, signal });
  }

  // Legacy interface: getCandles
  async getCandles({ symbol, timeframe, from, to, limit, signal } = {}) {
    return this.loadCandles({ symbol, timeframe, from, to, limit, signal });
  }

  /**
   * Recommended interface
   */
  async loadCandles({ symbol, timeframe, from, to, limit, signal } = {}) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // Support legacy caller that used LocalCandleProvider without from/to -> default last 24h
    const now = Math.floor(Date.now() / 1000);
    const resolvedTo = to != null ? Math.floor(to) : now;
    const resolvedFrom = from != null ? Math.floor(from) : resolvedTo - 86400; // default 24h

    this._validateParams({ symbol, timeframe, from: resolvedFrom, to: resolvedTo });

    const key = this._cacheKey(symbol, timeframe, resolvedFrom, resolvedTo);
    if (this._cache.has(key)) {
      const cached = this._cache.get(key);
      // move to end (LRU)
      this._cache.delete(key);
      this._cache.set(key, cached);
      const sliced = limit != null ? cached.slice(0, limit) : cached;
      return sliced.map(c => ({ ...c }));
    }

    // Chunked fetch
    const resolution = timeframe; // 1:1
    const tfSec = TIMEFRAME_SECONDS[timeframe];
    const allRaw = [];
    let chunkStart = resolvedFrom;
    let chunkEnd;
    let iterations = 0;

    while (chunkStart < resolvedTo) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      // Compute chunk window: try to fetch up to chunkSize candles per HTTP call
      chunkEnd = Math.min(resolvedTo, chunkStart + this.chunkSize * tfSec);
      // Edge: ensure forward progress
      if (chunkEnd <= chunkStart) chunkEnd = resolvedTo;

      let rawChunk;
      const apiSymbol = resolveVenueSymbol(symbol, VENUES.DELTA_EXCHANGE);
      try {
        rawChunk = await this.client.fetchCandles({
          symbol: apiSymbol,
          resolution,
          start: chunkStart,
          end: chunkEnd,
          signal
        });
      } catch (err) {
        // Preserve AbortError
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') throw err;
        // Re-throw DeltaError classified
        throw err;
      }

      if (!Array.isArray(rawChunk)) {
        throw new DeltaError('INVALID_RESPONSE', 'Expected array chunk');
      }
      allRaw.push(...rawChunk);

      iterations++;
      if (iterations > 200) {
        throw new DeltaError('INVALID_REQUEST', 'Too many chunks - range may be too large or API not progressing');
      }

      if (rawChunk.length === 0) {
        // No more data in this window; advance to next window to avoid infinite loop
        chunkStart = chunkEnd;
      } else {
        // Advance based on actual last candle time returned (API may return sparse)
        // Find max time in chunk to know progress (API returns descending, but find max)
        // Use sorted ascending after normalization later, but for chunk progress use max raw time
        // Raw times are seconds
        let maxTime = chunkStart;
        for (const r of rawChunk) {
          const t = r?.time ?? r?.t ?? r?.timestamp;
          const n = Number(t);
          if (Number.isFinite(n)) {
            const sec = n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
            if (sec > maxTime) maxTime = sec;
          }
        }
        // Next chunk starts after maxTime
        const nextStart = maxTime + tfSec;
        if (nextStart <= chunkStart) {
          // No progress
          chunkStart = chunkEnd;
        } else {
          chunkStart = nextStart;
        }
        // If fewer than chunkSize returned, likely end of data; but continue until resolvedTo
        if (rawChunk.length < this.chunkSize && chunkStart < resolvedTo) {
          // Still continue to next window but allow loop to handle gaps
        }
      }

      if (allRaw.length > this.maxCandles) {
        throw new DeltaError('INVALID_REQUEST', `Fetched ${allRaw.length} candles exceeds max ${this.maxCandles}. Reduce range.`);
      }

      // Safety: if we fetched one chunk and it covered till end, break
      if (chunkEnd >= resolvedTo) break;
    }

    if (allRaw.length === 0) {
      throw new DeltaError('NO_DATA', `No candles found for ${symbol} ${timeframe} in requested range`);
    }

    // Pipeline: normalize -> validate -> sort -> dedup -> return
    let normalized;
    try {
      normalized = CandleNormalizer.normalizeBatch(allRaw);
    } catch (err) {
      throw new DeltaError('INVALID_RESPONSE', `Normalization failed: ${err.message}`, { cause: err });
    }

    // sort ascending
    normalized.sort((a, b) => a.time - b.time);

    // deduplicate by time (keep last occurrence)
    const deduped = [];
    const seen = new Set();
    for (const c of normalized) {
      // Since sorted, dedup consecutive duplicates
      if (deduped.length > 0 && deduped[deduped.length - 1].time === c.time) {
        // Replace with later (keep last) - but our append order is sorted ascending, so keep last
        deduped[deduped.length - 1] = c;
        continue;
      }
      // also handle non-consecutive duplicate due to overlapping chunks
      if (seen.has(c.time)) {
        const idx = deduped.findIndex(x => x.time === c.time);
        if (idx >= 0) deduped[idx] = c;
        continue;
      }
      deduped.push(c);
      seen.add(c.time);
    }

    // Ensure strictly within requested range
    const ranged = deduped.filter(c => c.time >= resolvedFrom && c.time <= resolvedTo);

    // Validate batch - filter invalid but if all invalid throw
    const { validCandles, errors } = CandleValidator.validateBatch(ranged);
    if (validCandles.length === 0) {
      throw new DeltaError('INVALID_RESPONSE', `No valid candles after validation. Errors: ${errors.slice(0,3).map(e=>e.reason).join('; ')}`, { errors });
    }
    // If some errors, we return only valid (strict but usable). Optionally could throw if >50% invalid?
    // Keep returning validCandles.

    // Apply limit param if provided (client requested limit)
    const limited = limit != null ? validCandles.slice(0, limit) : validCandles;

    // Final dedup/sort again after validation filtering (validation ensures strictly increasing but do not trust)
    // Already sorted+deduped.

    // Cache the full valid set (without limit) for future hits
    this._addToCache(key, validCandles.map(c => ({ ...c })));

    // Return clones
    const result = limited.map(c => ({ ...c }));

    // Final cap check
    if (result.length > this.maxCandles) {
      throw new DeltaError('INVALID_REQUEST', `Result ${result.length} exceeds max ${this.maxCandles}`);
    }

    return result;
  }

  clearCache() {
    this._cache.clear();
  }
}
