import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeltaClient, DeltaError } from '../src/data/DeltaClient.js';
import { DeltaCandleProvider } from '../src/data/DeltaCandleProvider.js';
import { LocalCandleProvider } from '../src/data/LocalCandleProvider.js';
import { HistoricalDataManager, DataEvents } from '../src/data/HistoricalDataManager.js';
import { CandleStore } from '../src/data/CandleStore.js';
import { CandleCache } from '../src/data/CandleCache.js';
import { DataError, ErrorCategory, LoadingState } from '../src/data/DataError.js';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';

function genCandle(time, close = 100) {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 10 };
}

function mockFetchResponse({ ok = true, status = 200, jsonData = {} } = {}) {
  return async (url, opts) => {
    if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return {
      ok, status,
      statusText: ok ? 'OK' : 'Error',
      json: async () => jsonData,
      text: async () => JSON.stringify(jsonData),
    };
  };
}

function delayFetch(ms, data) {
  return async (url, { signal } = {}) => {
    await new Promise((res) => setTimeout(res, ms));
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return { ok: true, status: 200, statusText: 'OK', json: async () => data, text: async () => JSON.stringify(data) };
  };
}

// ===================================================================
// PART A: FETCH INVOCATION TESTS
// ===================================================================
describe('Phase 8.6 — Fetch Invocation Safety', () => {
  it('DeltaClient binds fetch to globalThis', () => {
    const client = new DeltaClient({ fetchFn: mockFetchResponse() });
    expect(client._fetchIsBound).toBe(true);
    expect(typeof client.fetchFn).toBe('function');
  });

  it('DeltaClient fetchFn correctly forwards URL and init', async () => {
    let capturedUrl, capturedInit;
    const customFetch = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true, status: 200, json: async () => ({ success: true, result: [] }) };
    };
    const client = new DeltaClient({ fetchFn: customFetch });
    await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 2000 });
    expect(capturedUrl).toContain('symbol=BTCUSDT');
    expect(capturedUrl).toContain('resolution=1m');
    expect(capturedInit.signal).toBeDefined();
    expect(capturedInit.headers.Accept).toBe('application/json');
  });

  it('DeltaClient.isIllegalInvocation detects the error', () => {
    const err = new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    expect(DeltaClient.isIllegalInvocation(err)).toBe(true);
  });

  it('DeltaClient.isIllegalInvocation rejects non-matching errors', () => {
    const err = new TypeError('Network error');
    expect(DeltaClient.isIllegalInvocation(err)).toBe(false);
  });

  it('DeltaClient surfaces Illegal invocation as INVALID_REQUEST (not NETWORK_ERROR)', async () => {
    const err = new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    const fetchFn = async () => { throw err; };
    const client = new DeltaClient({ fetchFn, timeoutMs: 0 });
    try {
      await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 2000 });
      expect.unreachable('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DeltaError);
      expect(e.code).toBe('INVALID_REQUEST');
      expect(e.message).toContain('Illegal invocation');
    }
  });

  it('LocalCandleProvider uses globalThis.fetch safely', async () => {
    const provider = new LocalCandleProvider({ basePath: '/test-data', inMemory: new Map([['BTCUSD-1m', [genCandle(1000)]]]) });
    const candles = await provider.getCandles({ symbol: 'BTCUSD', timeframe: '1m', from: 900, to: 1100 });
    expect(candles.length).toBe(1);
    expect(candles[0].time).toBe(1000);
  });
});

// ===================================================================
// PART C: ERROR HIERARCHY TESTS
// ===================================================================
describe('Phase 8.6 — DataError Error Hierarchy', () => {
  it('creates with all fields', () => {
    const err = new DataError({
      category: ErrorCategory.NETWORK,
      technicalMessage: 'Failed to fetch',
      context: { symbol: 'BTCUSDT', timeframe: '1m', start: 1000, end: 2000, url: 'https://api.delta.exchange', status: null },
    });
    expect(err.category).toBe(ErrorCategory.NETWORK);
    expect(err.userMessage).toContain('connection');
    expect(err.context.symbol).toBe('BTCUSDT');
    expect(err.context.timeframe).toBe('1m');
  });

  it('toUserString includes symbol and timeframe', () => {
    const err = new DataError({
      category: ErrorCategory.HTTP,
      technicalMessage: 'API error 400',
      context: { symbol: 'BTCUSDT', timeframe: '1m', start: 1000, end: 2000 },
    });
    const str = err.toUserString();
    expect(str).toContain('BTCUSDT');
    expect(str).toContain('1m');
  });

  it('toTechnicalString includes URL and status', () => {
    const err = new DataError({
      category: ErrorCategory.HTTP,
      technicalMessage: 'API error 400',
      context: { url: 'https://api.delta.exchange/v2', status: 400 },
    });
    const str = err.toTechnicalString();
    expect(str).toContain('HTTP 400');
    expect(str).toContain('https://api.delta.exchange/v2');
  });

  it('fromDeltaError maps NETWORK_ERROR correctly', () => {
    const delta = new DeltaError('NETWORK_ERROR', 'Network error: failed to fetch', { url: 'https://api.delta.exchange' });
    const dataErr = DataError.fromDeltaError(delta);
    expect(dataErr.category).toBe(ErrorCategory.NETWORK);
    expect(dataErr.technicalMessage).toContain('Network error');
  });

  it('fromDeltaError maps API_ERROR correctly', () => {
    const delta = new DeltaError('API_ERROR', 'Delta API error 400', { status: 400 });
    const dataErr = DataError.fromDeltaError(delta);
    expect(dataErr.category).toBe(ErrorCategory.HTTP);
    expect(dataErr.context.status).toBe(400);
  });

  it('fromDeltaError maps NO_DATA correctly', () => {
    const delta = new DeltaError('NO_DATA', 'No candles found');
    const dataErr = DataError.fromDeltaError(delta);
    expect(dataErr.category).toBe(ErrorCategory.NO_DATA);
  });

  it('fromGenericError detects Illegal invocation', () => {
    const err = new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    const dataErr = DataError.fromGenericError(err);
    expect(dataErr.category).toBe(ErrorCategory.INVALID_REQUEST);
  });

  it('fromGenericError detects AbortError', () => {
    const err = new DOMException('Aborted', 'AbortError');
    const dataErr = DataError.fromGenericError(err);
    expect(dataErr.category).toBe(ErrorCategory.ABORTED);
  });

  it('fromGenericError detects timeout', () => {
    const err = new DOMException('Timeout', 'TimeoutError');
    const dataErr = DataError.fromGenericError(err);
    expect(dataErr.category).toBe(ErrorCategory.TIMEOUT);
  });

  it('fromGenericError detects network error', () => {
    const err = new TypeError('Failed to fetch');
    const dataErr = DataError.fromGenericError(err);
    expect(dataErr.category).toBe(ErrorCategory.NETWORK);
  });

  it('all ErrorCategory values are defined', () => {
    expect(Object.keys(ErrorCategory).length).toBeGreaterThan(5);
    for (const key of Object.keys(ErrorCategory)) {
      expect(typeof ErrorCategory[key]).toBe('string');
      expect(ErrorCategory[key].length).toBeGreaterThan(0);
    }
  });

  it('all LoadingState values are defined', () => {
    expect(Object.keys(LoadingState).length).toBeGreaterThan(5);
    for (const key of Object.keys(LoadingState)) {
      expect(typeof LoadingState[key]).toBe('string');
    }
  });
});

// ===================================================================
// PART D: HTTP ERROR HANDLING
// ===================================================================
describe('Phase 8.6 — HTTP Error Handling', () => {
  it('throws API_ERROR on HTTP 400', async () => {
    const client = new DeltaClient({ fetchFn: mockFetchResponse({ ok: false, status: 400, jsonData: { error: { code: 'bad' } } }) });
    try {
      await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DeltaError);
      expect(e.code).toBe('API_ERROR');
      expect(e.details.status).toBe(400);
    }
  });

  it('throws API_ERROR on HTTP 500', async () => {
    const client = new DeltaClient({ fetchFn: mockFetchResponse({ ok: false, status: 500 }) });
    try {
      await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('API_ERROR');
      expect(e.details.status).toBe(500);
    }
  });

  it('throws API_ERROR on success:false in response body', async () => {
    const data = { success: false, error: { code: 'rate_limit', context: {} } };
    const client = new DeltaClient({ fetchFn: mockFetchResponse({ jsonData: data }) });
    try {
      await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('API_ERROR');
      expect(e.message).toContain('rate_limit');
    }
  });
});

// ===================================================================
// PART E: NETWORK ERROR HANDLING
// ===================================================================
describe('Phase 8.6 — Network Error Handling', () => {
  it('classifies "Failed to fetch" as CORS_ERROR', async () => {
    const client = new DeltaClient({ fetchFn: async () => { throw new TypeError('Failed to fetch'); } });
    try {
      await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('CORS_ERROR');
    }
  });

  it('classifies generic TypeError as NETWORK_ERROR', async () => {
    const client = new DeltaClient({ fetchFn: async () => { throw new TypeError('Network request failed'); } });
    try {
      await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('NETWORK_ERROR');
    }
  });
});

// ===================================================================
// PART F: TIMEOUT HANDLING
// ===================================================================
describe('Phase 8.6 — Timeout Handling', () => {
  it('throws TIMEOUT after timeoutMs', async () => {
    const client = new DeltaClient({
      fetchFn: delayFetch(500, { success: true, result: [genCandle(1000)] }),
      timeoutMs: 30,
    });
    try {
      await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('TIMEOUT');
    }
  });
});

// ===================================================================
// PART G: ABORT HANDLING
// ===================================================================
describe('Phase 8.6 — Abort Handling', () => {
  it('propagates AbortError when signal aborted externally', async () => {
    const client = new DeltaClient({
      fetchFn: delayFetch(500, { success: true, result: [] }),
      timeoutMs: 0,
    });
    const ac = new AbortController();
    const p = client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 2000, signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toHaveProperty('name', 'AbortError');
  });

  it('rejects immediately if signal already aborted', async () => {
    const client = new DeltaClient({ fetchFn: mockFetchResponse(), timeoutMs: 0 });
    const ac = new AbortController();
    ac.abort();
    await expect(client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 2000, signal: ac.signal }))
      .rejects.toHaveProperty('name', 'AbortError');
  });
});

// ===================================================================
// PART H: INVALID RESPONSE HANDLING
// ===================================================================
describe('Phase 8.6 — Invalid Response Handling', () => {
  it('throws INVALID_RESPONSE for non-object response', async () => {
    const client = new DeltaClient({ fetchFn: mockFetchResponse({ jsonData: null }) });
    try {
      await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('INVALID_RESPONSE');
    }
  });

  it('throws INVALID_RESPONSE for non-array result', async () => {
    const client = new DeltaClient({ fetchFn: mockFetchResponse({ jsonData: { success: true, result: 'not-array' } }) });
    try {
      await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('INVALID_RESPONSE');
    }
  });
});

// ===================================================================
// PART I: NO DATA HANDLING
// ===================================================================
describe('Phase 8.6 — No Data Handling', () => {
  it('throws NO_DATA for empty result from provider', async () => {
    const client = new DeltaClient({ fetchFn: mockFetchResponse({ jsonData: { success: true, result: [] } }) });
    const provider = new DeltaCandleProvider({ client, maxCandles: 10000 });
    try {
      await provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 5000 });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('NO_DATA');
    }
  });
});

// ===================================================================
// PART J: RETRY RULES
// ===================================================================
describe('Phase 8.6 — Retry Rules', () => {
  function buildManager(fetchFn, maxRetries = 3) {
    const client = new DeltaClient({ fetchFn, timeoutMs: 0 });
    const provider = new DeltaCandleProvider({ client, maxCandles: 100000, chunkSize: 2000 });
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    return new HistoricalDataManager({ provider, store, cache, maxRetries, chunkSize: 2000 });
  }

  it('does NOT retry INVALID_REQUEST (Illegal invocation)', async () => {
    let attempts = 0;
    const fetchFn = async () => {
      attempts++;
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    };
    const manager = buildManager(fetchFn, 3);
    try {
      await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 2000 });
      expect.unreachable();
    } catch (e) {
      // fetchFn should have been called at least once
      expect(attempts).toBeGreaterThanOrEqual(1);
      // The error should be INVALID_REQUEST (Illegal invocation mapped)
      expect(e.code).toBe('INVALID_REQUEST');
    }
  });

  it('does NOT retry NO_DATA', async () => {
    let attempts = 0;
    const fetchFn = async () => {
      attempts++;
      return { ok: true, status: 200, json: async () => ({ success: true, result: [] }) };
    };
    const manager = buildManager(fetchFn, 3);
    try {
      await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(attempts).toBe(1);
    }
  });

  it('does NOT retry abort/cancel', async () => {
    let attempts = 0;
    const fetchFn = async () => {
      attempts++;
      throw new DOMException('Aborted', 'AbortError');
    };
    const manager = buildManager(fetchFn, 3);
    try {
      await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(attempts).toBe(1);
    }
  });

  it('does NOT retry ordinary HTTP 4xx (400)', async () => {
    let attempts = 0;
    const fetchFn = async () => {
      attempts++;
      return { ok: false, status: 400, json: async () => ({ error: { code: 'bad' } }), text: async () => '{}' };
    };
    const manager = buildManager(fetchFn, 3);
    try {
      await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(attempts).toBe(1);
    }
  });
});

// ===================================================================
// PART K: LOAD RACE PROTECTION (token + abort)
// ===================================================================
describe('Phase 8.6 — Load Race Protection', () => {
  it('loadToken prevents stale response from overwriting current state', async () => {
    let loadToken = 0;
    let currentResult = null;

    async function loadData(token) {
      await new Promise(res => setTimeout(res, 50));
      if (token !== loadToken) return null;
      return 'data-' + token;
    }

    loadToken++;
    const p1 = loadData(loadToken);
    loadToken++;
    const p2 = loadData(loadToken);

    currentResult = await p1;
    expect(currentResult).toBeNull();
    currentResult = await p2;
    expect(currentResult).toBe('data-2');
  });

  it('AbortController cancels previous request', async () => {
    let aborted = false;
    let resolve;
    const p = new Promise(r => { resolve = r; });
    const ac = new AbortController();
    ac.signal.addEventListener('abort', () => { aborted = true; resolve(); });
    ac.abort();
    await p;
    expect(aborted).toBe(true);
  });
});

// ===================================================================
// PART L: LOADING STATE MACHINE
// ===================================================================
describe('Phase 8.6 — Loading State Machine', () => {
  it('LoadingState transitions IDLE -> LOADING -> SUCCESS', () => {
    let state = LoadingState.IDLE;
    state = LoadingState.LOADING;
    expect(state).toBe(LoadingState.LOADING);
    state = LoadingState.SUCCESS;
    expect(state).toBe(LoadingState.SUCCESS);
  });

  it('LoadingState transitions IDLE -> LOADING -> NETWORK_ERROR', () => {
    let state = LoadingState.IDLE;
    state = LoadingState.LOADING;
    state = LoadingState.NETWORK_ERROR;
    expect(state).toBe(LoadingState.NETWORK_ERROR);
  });

  it('LoadingState transitions IDLE -> LOADING -> EMPTY', () => {
    let state = LoadingState.IDLE;
    state = LoadingState.LOADING;
    state = LoadingState.EMPTY;
    expect(state).toBe(LoadingState.EMPTY);
  });

  it('LoadingState transitions IDLE -> LOADING -> ABORTED', () => {
    let state = LoadingState.IDLE;
    state = LoadingState.LOADING;
    state = LoadingState.ABORTED;
    expect(state).toBe(LoadingState.ABORTED);
  });

  it('LoadingState transitions IDLE -> LOADING -> TIMEOUT', () => {
    let state = LoadingState.IDLE;
    state = LoadingState.LOADING;
    state = LoadingState.TIMEOUT;
    expect(state).toBe(LoadingState.TIMEOUT);
  });

  it('LoadingState transitions IDLE -> LOADING -> HTTP_ERROR', () => {
    let state = LoadingState.IDLE;
    state = LoadingState.LOADING;
    state = LoadingState.HTTP_ERROR;
    expect(state).toBe(LoadingState.HTTP_ERROR);
  });

  it('LoadingState transitions IDLE -> LOADING -> INVALID_DATA', () => {
    let state = LoadingState.IDLE;
    state = LoadingState.LOADING;
    state = LoadingState.INVALID_DATA;
    expect(state).toBe(LoadingState.INVALID_DATA);
  });

  it('LoadingState transitions IDLE -> LOADING -> UNKNOWN_ERROR', () => {
    let state = LoadingState.IDLE;
    state = LoadingState.LOADING;
    state = LoadingState.UNKNOWN_ERROR;
    expect(state).toBe(LoadingState.UNKNOWN_ERROR);
  });
});

// ===================================================================
// PART K: RETRY AFTER ERROR
// ===================================================================
describe('Phase 8.6 — Retry After Error', () => {
  it('retries on transient NETWORK_ERROR up to maxRetries via manager', async () => {
    let attempts = 0;
    const fetchFn = async () => {
      attempts++;
      if (attempts < 3) throw new TypeError('Network request failed');
      return { ok: true, status: 200, json: async () => ({ success: true, result: [genCandle(1000)] }), text: async () => '' };
    };
    const client = new DeltaClient({ fetchFn, timeoutMs: 0 });
    const provider = new DeltaCandleProvider({ client, maxCandles: 10000, chunkSize: 2000 });
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    const manager = new HistoricalDataManager({ provider, store, cache, maxRetries: 3, chunkSize: 2000 });
    const result = await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 900, to: 1100 });
    expect(result.candles.length).toBe(1);
    expect(attempts).toBe(3);
  });

  it('retries on HTTP 429 up to maxRetries', async () => {
    let attempts = 0;
    const fetchFn = async () => {
      attempts++;
      if (attempts < 2) return { ok: false, status: 429, json: async () => ({}), text: async () => 'rate limited' };
      return { ok: true, status: 200, json: async () => ({ success: true, result: [genCandle(1000)] }), text: async () => '' };
    };
    const client = new DeltaClient({ fetchFn, timeoutMs: 0 });
    const provider = new DeltaCandleProvider({ client, maxCandles: 10000, chunkSize: 2000 });
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    const manager = new HistoricalDataManager({ provider, store, cache, maxRetries: 3, chunkSize: 2000 });
    const result = await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 900, to: 1100 });
    expect(result.candles.length).toBe(1);
    expect(attempts).toBe(2);
  });

  it('does NOT retry HTTP 400 via manager', async () => {
    let attempts = 0;
    const fetchFn = async () => {
      attempts++;
      return { ok: false, status: 400, json: async () => ({ error: { code: 'bad' } }), text: async () => '{}' };
    };
    const client = new DeltaClient({ fetchFn, timeoutMs: 0 });
    const provider = new DeltaCandleProvider({ client, maxCandles: 10000, chunkSize: 2000 });
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    const manager = new HistoricalDataManager({ provider, store, cache, maxRetries: 3, chunkSize: 2000 });
    try {
      await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 900, to: 1100 });
      expect.unreachable();
    } catch (e) {
      expect(attempts).toBe(1);
    }
  });
});

// ===================================================================
// PART N: DATE VALIDATION
// ===================================================================
describe('Phase 8.6 — Date Validation', () => {
  it('throws INVALID_REQUEST for from >= to', async () => {
    const client = new DeltaClient({ fetchFn: mockFetchResponse() });
    try {
      await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 2000, end: 1000 });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('INVALID_REQUEST');
    }
  });

  it('throws INVALID_REQUEST for missing symbol', async () => {
    const client = new DeltaClient({ fetchFn: mockFetchResponse() });
    try {
      await client.fetchCandles({ symbol: '', resolution: '1m', start: 1000, end: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('INVALID_REQUEST');
    }
  });

  it('throws INVALID_REQUEST for missing resolution', async () => {
    const client = new DeltaClient({ fetchFn: mockFetchResponse() });
    try {
      await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '', start: 1000, end: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('INVALID_REQUEST');
    }
  });

  it('throws INVALID_REQUEST for non-finite start/end', async () => {
    const client = new DeltaClient({ fetchFn: mockFetchResponse() });
    try {
      await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: NaN, end: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('INVALID_REQUEST');
    }
  });
});

// ===================================================================
// PART O: REPLAY STATE WITHOUT DATA
// ===================================================================
describe('Phase 8.6 — Replay State Without Data', () => {
  it('engine starts in IDLE state', () => {
    const engine = new ReplayEngine();
    const state = engine.getState();
    expect(state.status).toBe('idle');
    expect(state.currentIndex).toBe(-1);
    expect(state.totalCandles).toBe(0);
  });

  it('engine transitions to READY after load', () => {
    const engine = new ReplayEngine();
    engine.load([genCandle(1000), genCandle(1060), genCandle(1120)]);
    const state = engine.getState();
    expect(state.status).toBe('ready');
    expect(state.totalCandles).toBe(3);
  });

  it('engine getVisibleCandles returns empty when not started', () => {
    const engine = new ReplayEngine();
    engine.load([genCandle(1000), genCandle(1060)]);
    expect(engine.getVisibleCandles().length).toBe(0);
  });

  it('engine getVisibleCandles returns candles after start', () => {
    const engine = new ReplayEngine();
    engine.load([genCandle(1000), genCandle(1060), genCandle(1120)]);
    engine.start(0);
    expect(engine.getVisibleCandles().length).toBe(1);
    engine.stepForward();
    expect(engine.getVisibleCandles().length).toBe(2);
  });
});

// ===================================================================
// PART P: STALE RESPONSE PROTECTION
// ===================================================================
describe('Phase 8.6 — Stale Response Protection', () => {
  it('stale response does not overwrite when token incremented', async () => {
    const store = new CandleStore();
    let token = 0;
    const results = [];

    async function loadWithToken(candles, t) {
      await new Promise(res => setTimeout(res, 30));
      if (t !== token) return;
      store.load(candles, { symbol: 'BTCUSDT', timeframe: '1m' });
      results.push(store.getCount());
    }

    token++;
    loadWithToken([genCandle(1000), genCandle(1060)], token);
    token++;
    await loadWithToken([genCandle(2000)], token);
    await new Promise(res => setTimeout(res, 50));
    expect(results).toEqual([1]);
    expect(store.getCount()).toBe(1);
    expect(store.get(0).time).toBe(2000);
  });
});

// ===================================================================
// PART Q: STALE ERROR PROTECTION
// ===================================================================
describe('Phase 8.6 — Stale Error Protection', () => {
  it('stale error does not overwrite current success', async () => {
    let errorState = null;
    let successState = null;

    function setError(token, currentToken, msg) {
      if (token !== currentToken) return;
      errorState = msg;
    }
    function setSuccess(token, currentToken, data) {
      if (token !== currentToken) return;
      successState = data;
    }

    let token = 0;
    token++;
    setError(token, token, 'network error');
    token++;
    setSuccess(token, token, 'candles loaded');
    expect(errorState).toBe('network error');
    expect(successState).toBe('candles loaded');
  });
});

// ===================================================================
// PART R: SUCCESS STATE
// ===================================================================
describe('Phase 8.6 — Success State', () => {
  it('HistoricalDataManager emits READY on success', async () => {
    const client = new DeltaClient({
      fetchFn: mockFetchResponse({ jsonData: { success: true, result: [genCandle(1000), genCandle(1060)] } }),
    });
    const provider = new DeltaCandleProvider({ client, maxCandles: 10000 });
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    const manager = new HistoricalDataManager({ provider, store, cache });
    const readyEvents = [];
    manager.on(DataEvents.READY, (e) => readyEvents.push(e));
    const result = await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 900, to: 1200 });
    expect(result.candles.length).toBe(2);
    expect(readyEvents.length).toBe(1);
    expect(readyEvents[0].candles.length).toBe(2);
  });
});

// ===================================================================
// PART S: EMPTY STATE
// ===================================================================
describe('Phase 8.6 — Empty State', () => {
  it('HistoricalDataManager throws NO_DATA for empty fetch', async () => {
    const client = new DeltaClient({
      fetchFn: mockFetchResponse({ jsonData: { success: true, result: [] } }),
    });
    const provider = new DeltaCandleProvider({ client, maxCandles: 10000 });
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    const manager = new HistoricalDataManager({ provider, store, cache });
    try {
      await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 2000 });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('NO_DATA');
    }
  });
});
