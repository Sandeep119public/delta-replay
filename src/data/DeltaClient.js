/**
 * DeltaClient - isolated HTTP layer for Delta Exchange historical candles.
 * ReplayEngine never sees this. Only DeltaCandleProvider uses it.
 */

export const DELTA_DEFAULT_BASE = 'https://api.delta.exchange';
export const DELTA_INDIA_BASE = 'https://api.india.delta.exchange';

export class DeltaError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DeltaError';
    this.code = code;
    this.details = details;
  }
}

export class DeltaClient {
  constructor({ baseUrl = DELTA_DEFAULT_BASE, timeoutMs = 15000, fetchFn } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    if (fetchFn) {
      this.fetchFn = fetchFn;
    } else {
      if (typeof globalThis.fetch !== 'function') throw new DeltaError('INVALID_REQUEST', 'global fetch not available');
      const nativeFetch = globalThis.fetch;
      const global = globalThis;
      this.fetchFn = (url, init) => nativeFetch.call(global, url, init);
    }
  }

  static isIllegalInvocation(err) {
    return (err?.message ?? String(err)).toLowerCase().includes('illegal invocation');
  }

  async fetchCandles({ symbol, resolution, start, end, signal } = {}) {
    if (!symbol) throw new DeltaError('INVALID_REQUEST', 'symbol required');
    if (!resolution) throw new DeltaError('INVALID_REQUEST', 'resolution required');
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new DeltaError('INVALID_REQUEST', 'start and end must be unix seconds');
    if (start > end) throw new DeltaError('INVALID_REQUEST', 'start must be < end');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const url = `${this.baseUrl}/v2/history/candles?resolution=${encodeURIComponent(resolution)}&symbol=${encodeURIComponent(symbol)}&start=${Math.floor(start)}&end=${Math.floor(end)}`;
    const controller = new AbortController();
    let timeoutId = null;
    let abortHandler = null;
    let timedOut = false;

    if (signal) {
      abortHandler = () => controller.abort('caller');
      signal.addEventListener('abort', abortHandler, { once: true });
    }
    if (this.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort('timeout');
      }, this.timeoutMs);
    }

    try {
      let res;
      try {
        res = await this.fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      } catch (err) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (timedOut) throw new DeltaError('TIMEOUT', `Request timed out after ${this.timeoutMs}ms`, { url, symbol, resolution, start, end });
        if (DeltaClient.isIllegalInvocation(err)) {
          throw new DeltaError('INVALID_REQUEST', `Fetch Illegal invocation: ${err.message}`, { url, symbol, resolution, start, end, cause: err });
        }
        const msg = err?.message ?? String(err);
        if (msg.toLowerCase().includes('cors') || msg.toLowerCase().includes('failed to fetch')) {
          throw new DeltaError('CORS_ERROR', `Network/CORS error: ${msg}`, { url, symbol, resolution, start, end, cause: err });
        }
        throw new DeltaError('NETWORK_ERROR', `Network error: ${msg}`, { url, symbol, resolution, start, end, cause: err });
      }

      if (!res?.ok) {
        let bodyText = '';
        try { bodyText = await res.text(); } catch {}
        let parsed = null;
        try { parsed = JSON.parse(bodyText); } catch {}
        const apiMsg = parsed?.error?.code ? `${parsed.error.code}: ${JSON.stringify(parsed.error.context ?? {})}` : bodyText.slice(0, 500);
        throw new DeltaError('API_ERROR', `Delta API error ${res?.status}: ${apiMsg || res?.statusText || res?.status}`, {
          url, status: res?.status, body: parsed ?? bodyText, symbol, resolution, start, end,
        });
      }

      let data;
      try {
        data = await res.json();
      } catch (err) {
        throw new DeltaError('INVALID_RESPONSE', `Invalid JSON response: ${err.message}`, { url, symbol, resolution, start, end, cause: err });
      }
      if (!data || typeof data !== 'object') throw new DeltaError('INVALID_RESPONSE', 'Response is not an object', { url, data, symbol, resolution, start, end });
      if (data.success === false) {
        const code = data?.error?.code ?? 'API_ERROR';
        throw new DeltaError('API_ERROR', `Delta API returned success:false (${code})`, { url, data, status: 200, symbol, resolution, start, end });
      }
      if (!Array.isArray(data.result)) throw new DeltaError('INVALID_RESPONSE', 'Expected result to be an array', { url, data, symbol, resolution, start, end });
      return data.result;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
    }
  }
}
