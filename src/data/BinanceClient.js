import { resolveVenueSymbol, VENUES } from './InstrumentConfig.js';
import { TIMEFRAME_SECONDS } from './CandleGrid.js';
import { CandleValidator } from './CandleValidator.js';

export const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
export const BINANCE_SPOT_BASE = 'https://api.binance.com';

function providerError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  error.details = details;
  return error;
}

export class BinanceClient {
  constructor({ baseUrl = BINANCE_FUTURES_BASE, timeoutMs = 15000, fetchFn } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.gridOrigin = 0;
    if (fetchFn) this.fetchFn = fetchFn;
    else {
      if (typeof globalThis.fetch !== 'function') throw providerError('INVALID_REQUEST', 'global fetch not available');
      const nativeFetch = globalThis.fetch;
      const global = globalThis;
      this.fetchFn = (url, init) => nativeFetch.call(global, url, init);
    }
  }

  get venue() { return this.baseUrl.includes('fapi') ? VENUES.BINANCE_FUTURES : VENUES.BINANCE_SPOT; }
  getGridSpec() { return { origin: 0, timeframeUnit: 'seconds', alignment: 'UTC' }; }

  async fetchCandles({ symbol, resolution, start, end, signal }) {
    if (!symbol || typeof symbol !== 'string') throw providerError('INVALID_REQUEST', 'symbol is required and must be a string');
    if (!resolution || typeof resolution !== 'string') throw providerError('INVALID_REQUEST', 'resolution is required and must be a string');
    if (!Number.isFinite(start)) throw providerError('INVALID_REQUEST', 'start must be unix seconds');
    if (!Number.isFinite(end)) throw providerError('INVALID_REQUEST', 'end must be unix seconds');
    if (start > end) throw providerError('INVALID_REQUEST', 'start must be <= end');

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
      const onAbort = () => controller.abort('caller');
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      const timeoutId = this.timeoutMs > 0 ? setTimeout(() => { timedOut = true; controller.abort('timeout'); }, this.timeoutMs) : null;

      let page;
      try {
        const res = await this.fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!res?.ok) {
          let body = '';
          try { body = await res.text(); } catch {}
          let parsed = null;
          try { parsed = body ? JSON.parse(body) : null; } catch {}
          throw providerError('API_ERROR', `Binance API error: ${res?.status ?? 'unknown'} ${res?.statusText ?? ''}`.trim(), { status: res?.status, url, body: parsed ?? body.slice(0, 1000) });
        }
        let data;
        try { data = await res.json(); }
        catch (error) { throw providerError('INVALID_RESPONSE', `Binance API returned invalid JSON: ${error.message}`, { url, cause: error }); }
        if (!Array.isArray(data)) throw providerError('INVALID_RESPONSE', 'Binance API returned a non-array candle payload', { url });
        page = data.map(item => Array.isArray(item) ? { time: Math.floor(Number(item[0]) / 1000), open: parseFloat(item[1]), high: parseFloat(item[2]), low: parseFloat(item[3]), close: parseFloat(item[4]), volume: parseFloat(item[5]) } : item);
        let previousTime = null;
        for (let i = 0; i < page.length; i += 1) {
          const result = CandleValidator.validate(page[i], previousTime);
          if (!result.valid) throw providerError('INVALID_CANDLE', `Invalid candle at provider boundary index ${i}: ${result.reason}`, { url, index: i, candle: page[i] });
          previousTime = page[i].time;
        }
      } catch (err) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (timedOut || err?.name === 'TimeoutError' || controller.signal.reason === 'timeout') throw providerError('TIMEOUT', `Binance request timed out after ${this.timeoutMs}ms`, { url, cause: err });
        throw err;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener?.('abort', onAbort);
      }

      if (!page?.length) break;
      allCandles.push(...page);
      const lastCandle = page[page.length - 1];
      if (lastCandle?.time >= Math.floor(end)) break;
      const nextStartMs = (lastCandle.time + tfSec) * 1000;
      if (nextStartMs <= currentStartMs) throw providerError('INVALID_RESPONSE', 'Binance pagination made no forward progress', { url, currentStartMs, nextStartMs });
      currentStartMs = nextStartMs;
    }
    return allCandles;
  }
}
