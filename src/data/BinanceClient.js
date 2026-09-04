import { resolveVenueSymbol, VENUES } from './InstrumentConfig.js';
import { TIMEFRAME_SECONDS } from './CandleGrid.js';

export const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
export const BINANCE_SPOT_BASE = 'https://api.binance.com';

export class BinanceClient {
  constructor({ baseUrl = BINANCE_FUTURES_BASE, timeoutMs = 15000, fetchFn } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.gridOrigin = 0;
    if (fetchFn) {
      this.fetchFn = fetchFn;
    } else {
      const _fetch = globalThis.fetch;
      const _g = globalThis;
      this.fetchFn = (url, init) => _fetch.call(_g, url, init);
    }
  }

  get venue() {
    return this.baseUrl.includes('fapi') ? VENUES.BINANCE_FUTURES : VENUES.BINANCE_SPOT;
  }

  getGridSpec() {
    return {
      origin: 0,
      timeframeUnit: 'seconds',
      alignment: 'UTC',
    };
  }

  /**
   * Fetches candles from Binance API, handling pagination across page limits
   * and accurately classifying timeouts vs caller cancellation.
   *
   * Contract: guarantees returning ALL candles in [start, end].
   */
  async fetchCandles({ symbol, resolution, start, end, signal }) {
    if (!symbol || typeof symbol !== 'string') throw new Error('symbol is required and must be a string');
    if (!resolution || typeof resolution !== 'string') throw new Error('resolution is required and must be a string');
    if (!Number.isFinite(start)) throw new Error('start must be unix seconds');
    if (!Number.isFinite(end)) throw new Error('end must be unix seconds');
    if (start > end) throw new Error('start must be <= end');

    const isFutures = this.baseUrl.includes('fapi');
    const venue = isFutures ? VENUES.BINANCE_FUTURES : VENUES.BINANCE_SPOT;
    const mappedSymbol = resolveVenueSymbol(symbol, venue);

    const tfSec = TIMEFRAME_SECONDS[resolution] ?? 60;
    const endpoint = isFutures ? '/fapi/v1/klines' : '/api/v3/klines';
    const limit = isFutures ? 1500 : 1000;

    let currentStartMs = Math.floor(start) * 1000;
    const endMs = Math.floor(end) * 1000;
    const allCandles = [];

    while (currentStartMs <= endMs) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const url = `${this.baseUrl}${endpoint}?symbol=${encodeURIComponent(mappedSymbol)}&interval=${encodeURIComponent(resolution)}&startTime=${currentStartMs}&endTime=${endMs}&limit=${limit}`;

      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }

      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.timeoutMs);

      let page;
      try {
        const res = await this.fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!res.ok) {
          const err = new Error(`Binance API error: ${res.status} ${res.statusText}`);
          err.code = 'API_ERROR';
          err.status = res.status;
          throw err;
        }
        const data = await res.json();
        if (!Array.isArray(data)) {
          const err = new Error('Binance API returned a non-array candle payload');
          err.code = 'INVALID_RESPONSE';
          throw err;
        }

        page = data.map(item => {
          if (Array.isArray(item)) {
            return {
              time: Math.floor(Number(item[0]) / 1000),
              open: parseFloat(item[1]),
              high: parseFloat(item[2]),
              low: parseFloat(item[3]),
              close: parseFloat(item[4]),
              volume: parseFloat(item[5])
            };
          }
          return item;
        });
      } catch (err) {
        if (timedOut) {
          const timeoutErr = new Error(`Binance request timed out after ${this.timeoutMs}ms`);
          timeoutErr.code = 'TIMEOUT';
          timeoutErr.name = 'TimeoutError';
          throw timeoutErr;
        }
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
        if (signal && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', onAbort);
        }
      }

      if (!page || page.length === 0) {
        break;
      }

      allCandles.push(...page);

      const lastCandle = page[page.length - 1];
      if (lastCandle && lastCandle.time >= Math.floor(end)) {
        break;
      }

      const nextStartSec = lastCandle.time + tfSec;
      const nextStartMs = nextStartSec * 1000;

      if (nextStartMs <= currentStartMs) {
        break;
      }
      currentStartMs = nextStartMs;
    }

    return allCandles;
  }
}
