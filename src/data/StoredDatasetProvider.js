import { CandleProvider } from './CandleProvider.js';
import { CandleNormalizer } from './CandleNormalizer.js';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export class StoredDatasetProvider extends CandleProvider {
  constructor({ baseUrl = API_BASE, fetchFn = null } = {}) {
    super();
    this.baseUrl = baseUrl;
    this.fetchFn = fetchFn || globalThis.fetch.bind(globalThis);
  }

  get venue() {
    return 'BINANCE_STORED';
  }

  async getCandles({ symbol, timeframe, from, to, signal } = {}) {
    if (!symbol || !timeframe) throw new Error('symbol and timeframe are required');
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      throw new Error('stored replay requires an explicit start and end range');
    }
    const params = new URLSearchParams({
      symbol: String(symbol).trim().toUpperCase(),
      timeframe: String(timeframe),
      from: String(Math.floor(from)),
      to: String(Math.floor(to)),
    });
    const response = await this.fetchFn(
      `${this.baseUrl}/api/v1/data/candles?${params.toString()}`,
      { headers: { Accept: 'application/json' }, signal },
    );
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(body?.detail || body?.message || `Stored dataset request failed: ${response.status}`);
      error.status = response.status;
      error.code = 'STORED_DATA_ERROR';
      throw error;
    }
    if (!Array.isArray(body?.candles)) throw new Error('Stored dataset returned invalid candles');
    return CandleNormalizer.normalizeBatch(body.candles);
  }
}
