import { CandleProvider } from './CandleProvider.js';
import { CandleNormalizer } from './CandleNormalizer.js';

export class LocalCandleProvider extends CandleProvider {
  /**
   * @param {object} opts
   * @param {string} [opts.basePath] - e.g. '/sample-data'
   * @param {Map<string, object[]>} [opts.inMemory] - for tests / offline injection
   * @param {number} [opts.latencyMs] - artificial delay to test race conditions
   */
  constructor({ basePath = '/sample-data', inMemory = null, latencyMs = 0 } = {}) {
    super();
    this.basePath = basePath;
    this.inMemory = inMemory; // Map key: `${symbol}-${timeframe}`
    this.latencyMs = latencyMs;
  }

  _key(symbol, timeframe) {
    return `${symbol}-${timeframe}`;
  }

  async getCandles({ symbol, timeframe, from, to, limit, signal } = {}) {
    if (!symbol || !timeframe) throw new Error('symbol and timeframe required');

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // check inMemory first
    const key = this._key(symbol, timeframe);
    let raw = null;

    if (this.inMemory && this.inMemory.has(key)) {
      raw = this.inMemory.get(key);
    } else {
      // fetch from basePath
      const url = `${this.basePath}/${symbol}-${timeframe}.json`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
      raw = await res.json();
    }

    if (this.latencyMs > 0) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, this.latencyMs);
        signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    }

    if (!Array.isArray(raw)) throw new Error('Invalid data: expected array');

    let candles = CandleNormalizer.normalizeBatch(raw);

    // Filter by from/to
    if (from != null) candles = candles.filter(c => c.time >= from);
    if (to != null) candles = candles.filter(c => c.time <= to);
    if (limit != null) candles = candles.slice(0, limit);

    // Ensure sorted by time (provider should return sorted)
    candles.sort((a, b) => a.time - b.time);

    return candles;
  }
}
