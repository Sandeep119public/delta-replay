import { CandleProvider } from './CandleProvider.js';
import { CandleNormalizer } from './CandleNormalizer.js';
import { CandleValidator } from './CandleValidator.js';
import { DeltaClient, DeltaError, DELTA_DEFAULT_BASE } from './DeltaClient.js';
import { resolveVenueSymbol, VENUES } from './InstrumentConfig.js';
import { TIMEFRAME_SECONDS } from './CandleGrid.js';

export const SUPPORTED_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '1d', '1w'];
export { TIMEFRAME_SECONDS };
export const MAX_CANDLES = 100000;
export const CHUNK_SIZE = 2000;

export class DeltaCandleProvider extends CandleProvider {
  constructor({ baseUrl = DELTA_DEFAULT_BASE, client = null, maxCandles = MAX_CANDLES, chunkSize = CHUNK_SIZE, cacheSize = 20, gridOrigin = null } = {}) {
    super();
    if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error('chunkSize must be a positive integer');
    if (!Number.isInteger(maxCandles) || maxCandles < 1) throw new Error('maxCandles must be a positive integer');
    this.baseUrl = baseUrl;
    this.client = client ?? new DeltaClient({ baseUrl });
    this.maxCandles = maxCandles;
    this.chunkSize = chunkSize;
    this.cacheSize = cacheSize;
    this.gridOrigin = gridOrigin ?? (this.client?.gridOrigin ?? 0);
    this._cache = new Map();
  }

  get venue() { return VENUES.DELTA_EXCHANGE; }
  getGridSpec() { return { origin: this.gridOrigin ?? 0, timeframeUnit: 'seconds', alignment: 'UTC' }; }
  _cacheKey(symbol, timeframe, from, to) { return `${symbol}|${timeframe}|${from ?? ''}|${to ?? ''}`; }
  _addToCache(key, candles) {
    if (this.cacheSize <= 0) return;
    if (this._cache.has(key)) this._cache.delete(key);
    this._cache.set(key, candles);
    while (this._cache.size > this.cacheSize) this._cache.delete(this._cache.keys().next().value);
  }

  _validateParams({ symbol, timeframe, from, to }) {
    if (!symbol || typeof symbol !== 'string') throw new DeltaError('INVALID_REQUEST', 'symbol is required');
    if (!SUPPORTED_TIMEFRAMES.includes(timeframe)) {
      throw new DeltaError('INVALID_REQUEST', `Unsupported timeframe: ${timeframe}. Supported: ${SUPPORTED_TIMEFRAMES.join(', ')}`);
    }
    if (from != null && !Number.isFinite(from)) throw new DeltaError('INVALID_REQUEST', 'from must be unix seconds');
    if (to != null && !Number.isFinite(to)) throw new DeltaError('INVALID_REQUEST', 'to must be unix seconds');
    if (from != null && to != null && from >= to) throw new DeltaError('INVALID_REQUEST', 'from must be < to');
    if (from != null && to != null) {
      const estimated = Math.floor((to - from) / TIMEFRAME_SECONDS[timeframe]) + 1;
      if (estimated > this.maxCandles) {
        throw new DeltaError('INVALID_REQUEST', `Requested range would require ~${estimated} candles (max ${this.maxCandles} for ${timeframe}). Reduce the date range or use a larger timeframe.`, { estimated, max: this.maxCandles });
      }
    }
  }

  async fetchChunk({ symbol, timeframe, from, to, signal } = {}) {
    const apiSymbol = resolveVenueSymbol(symbol, VENUES.DELTA_EXCHANGE);
    return this.client.fetchCandles({ symbol: apiSymbol, resolution: timeframe, start: from, end: to, signal });
  }
  async getCandles({ symbol, timeframe, from, to, limit, signal } = {}) {
    return this.loadCandles({ symbol, timeframe, from, to, limit, signal });
  }

  async loadCandles({ symbol, timeframe, from, to, limit, signal } = {}) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const now = Math.floor(Date.now() / 1000);
    const resolvedTo = to != null ? Math.floor(to) : now;
    const resolvedFrom = from != null ? Math.floor(from) : resolvedTo - 86400;
    this._validateParams({ symbol, timeframe, from: resolvedFrom, to: resolvedTo });

    const key = this._cacheKey(symbol, timeframe, resolvedFrom, resolvedTo);
    if (this._cache.has(key)) {
      const cached = this._cache.get(key);
      this._cache.delete(key);
      this._cache.set(key, cached);
      const sliced = limit != null ? cached.slice(0, limit) : cached;
      return sliced.map(c => ({ ...c }));
    }

    const tfSec = TIMEFRAME_SECONDS[timeframe];
    const allRaw = [];
    const chunkSpan = (this.chunkSize - 1) * tfSec;
    let chunkStart = resolvedFrom;
    let chunks = 0;

    while (chunkStart <= resolvedTo) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const chunkEnd = Math.min(resolvedTo, chunkStart + chunkSpan);
      const rawChunk = await this.fetchChunk({ symbol, timeframe, from: chunkStart, to: chunkEnd, signal });
      if (!Array.isArray(rawChunk)) throw new DeltaError('INVALID_RESPONSE', 'Expected array chunk');
      allRaw.push(...rawChunk);
      if (++chunks > Math.ceil(this.maxCandles / this.chunkSize) + 2) {
        throw new DeltaError('INVALID_REQUEST', 'Too many chunks - range may be too large or API is not progressing');
      }
      if (chunkEnd >= resolvedTo) break;
      chunkStart = chunkEnd + tfSec;
    }

    if (allRaw.length === 0) throw new DeltaError('NO_DATA', `No candles found for ${symbol} ${timeframe} in requested range`);

    let normalized;
    try {
      normalized = CandleNormalizer.normalizeBatch(allRaw);
    } catch (err) {
      throw new DeltaError('INVALID_RESPONSE', `Normalization failed: ${err.message}`, { cause: err });
    }

    normalized.sort((a, b) => a.time - b.time);
    const deduped = [];
    for (const c of normalized) {
      if (deduped.length && deduped[deduped.length - 1].time === c.time) deduped[deduped.length - 1] = c;
      else deduped.push(c);
    }

    const ranged = deduped.filter(c => c.time >= resolvedFrom && c.time <= resolvedTo);
    const { validCandles, errors } = CandleValidator.validateBatch(ranged);
    if (validCandles.length === 0) {
      throw new DeltaError('INVALID_RESPONSE', `No valid candles after validation. Errors: ${errors.slice(0, 3).map(e => e.reason).join('; ')}`, { errors });
    }

    const limited = limit != null ? validCandles.slice(0, limit) : validCandles;
    this._addToCache(key, validCandles.map(c => ({ ...c })));
    return limited.map(c => ({ ...c }));
  }

  clearCache() { this._cache.clear(); }
}
