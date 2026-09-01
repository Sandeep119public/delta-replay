/**
 * DeltaClient - isolated HTTP layer for Delta Exchange historical candles.
 * ReplayEngine never sees this. Only DeltaCandleProvider uses it.
 *
 * Verified API contract (2026-09-01, Node probe + docs):
 *  BASE:
 *    Global: https://api.delta.exchange
 *    India:  https://api.india.delta.exchange
 *  ENDPOINT: GET /v2/history/candles
 *  QUERY:
 *    resolution: enum {5s,1m,3m,5m,15m,30m,1h,2h,4h,6h,1d,1w}  (global omits 5s)
 *    symbol:     product symbol, e.g. BTCUSDT (global) / BTCUSD (india)
 *    start:      unix seconds (integer, inclusive)
 *    end:        unix seconds (integer, inclusive)
 *  RESPONSE:
 *    { success: true, result: [ {time, open, high, low, close, volume}, ... ] }
 *    time is unix seconds (integer)
 *    result is DESCENDING (newest first) when non-empty
 *    empty result is {success:true, result:[]}
 *    error: {success:false, error:{code, context:{schema_errors:[...]}}}
 *  LIMITS:
 *    Max candles per single request observed ~4000-5000 (7d at 1m returned 4001)
 *    No hard documented limit; we defensively chunk.
 *  CORS:
 *    Response headers include access-control-allow-origin: *  -> browser direct works.
 */

export const DELTA_DEFAULT_BASE = 'https://api.delta.exchange';
export const DELTA_INDIA_BASE = 'https://api.india.delta.exchange';

export class DeltaError extends Error {
  /**
   * @param {string} code - one of NETWORK_ERROR, TIMEOUT, CORS_ERROR, API_ERROR, INVALID_RESPONSE, INVALID_REQUEST, NO_DATA, ABORT
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DeltaError';
    this.code = code;
    this.details = details;
  }
}

export class DeltaClient {
  /**
   * @param {object} opts
   * @param {string} [opts.baseUrl]
   * @param {number} [opts.timeoutMs]
   * @param {typeof fetch} [opts.fetchFn]
   */
  constructor({ baseUrl = DELTA_DEFAULT_BASE, timeoutMs = 15000, fetchFn = globalThis.fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.fetchFn = fetchFn;
  }

  /**
   * Fetch a single chunk of candles.
   * @param {object} params
   * @param {string} params.symbol
   * @param {string} params.resolution
   * @param {number} params.start - unix seconds
   * @param {number} params.end - unix seconds
   * @param {AbortSignal} [params.signal]
   * @returns {Promise<Array>}
   */
  async fetchCandles({ symbol, resolution, start, end, signal }) {
    if (!symbol) throw new DeltaError('INVALID_REQUEST', 'symbol required');
    if (!resolution) throw new DeltaError('INVALID_REQUEST', 'resolution required');
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new DeltaError('INVALID_REQUEST', 'start and end must be unix seconds');
    }
    if (start > end) throw new DeltaError('INVALID_REQUEST', 'start must be < end');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const url = `${this.baseUrl}/v2/history/candles?resolution=${encodeURIComponent(resolution)}&symbol=${encodeURIComponent(symbol)}&start=${encodeURIComponent(Math.floor(start))}&end=${encodeURIComponent(Math.floor(end))}`;

    let timeoutId;
    let abortHandler;
    const controller = new AbortController();

    // Wire external signal to internal controller
    if (signal) {
      if (signal.aborted) {
        controller.abort();
        // ensure reason name is AbortError for catch logic
        try { controller.signal.reason = new DOMException('Aborted', 'AbortError'); } catch {}
      } else {
        abortHandler = () => controller.abort();
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    const timeoutSignal = () => {
      controller.abort();
      try { controller.signal.reason = new DOMException('Timeout', 'TimeoutError'); } catch {}
    };
    if (this.timeoutMs > 0) timeoutId = setTimeout(timeoutSignal, this.timeoutMs);

    try {
      let res;
      try {
        res = await this.fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      } catch (err) {
        // If external abort, map to DOMException AbortError regardless of internal reason shape
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || controller.signal.aborted) {
          const isTimeout = err?.name === 'TimeoutError' || controller.signal.reason?.name === 'TimeoutError';
          if (isTimeout) {
            throw new DeltaError('TIMEOUT', `Request timed out after ${this.timeoutMs}ms`, { url });
          }
          throw new DOMException('Aborted', 'AbortError');
        }
        // Network / CORS type errors surface as TypeError
        const msg = err?.message ?? String(err);
        if (msg.toLowerCase().includes('cors') || msg.toLowerCase().includes('failed to fetch')) {
          throw new DeltaError('CORS_ERROR', `Network/CORS error: ${msg}`, { url, cause: err });
        }
        throw new DeltaError('NETWORK_ERROR', `Network error: ${msg}`, { url, cause: err });
      }

      if (!res.ok) {
        // Try to parse error body
        let bodyText = '';
        try { bodyText = await res.text(); } catch {}
        let parsed;
        try { parsed = JSON.parse(bodyText); } catch {}
        const apiMsg = parsed?.error?.code ? `${parsed.error.code}: ${JSON.stringify(parsed.error.context)}` : bodyText.slice(0, 500);
        throw new DeltaError('API_ERROR', `Delta API error ${res.status}: ${apiMsg || res.statusText}`, { url, status: res.status, body: parsed ?? bodyText });
      }

      let data;
      try {
        data = await res.json();
      } catch (err) {
        throw new DeltaError('INVALID_RESPONSE', `Invalid JSON response: ${err.message}`, { url });
      }

      if (!data || typeof data !== 'object') {
        throw new DeltaError('INVALID_RESPONSE', 'Response is not an object', { url, data });
      }
      if (data.success === false) {
        const code = data?.error?.code ?? 'API_ERROR';
        const detail = JSON.stringify(data?.error ?? data).slice(0, 1000);
        throw new DeltaError('API_ERROR', `Delta API returned success:false (${code}): ${detail}`, { url, data });
      }
      if (!Array.isArray(data.result)) {
        throw new DeltaError('INVALID_RESPONSE', 'Expected result to be an array', { url, data });
      }
      return data.result;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
    }
  }
}
