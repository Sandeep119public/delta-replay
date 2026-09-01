import { describe, it, expect, vi } from 'vitest';
import { DeltaClient, DeltaError } from '../src/data/DeltaClient.js';
import { DeltaCandleProvider } from '../src/data/DeltaCandleProvider.js';

// Helper to create mock fetch that returns response
function mockFetchResponse({ ok = true, status = 200, jsonData = {}, textData = null } = {}) {
  return async (url, opts) => {
    if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      headers: new Map(),
      json: async () => jsonData,
      text: async () => textData ?? JSON.stringify(jsonData),
    };
  };
}

function genCandle(time) {
  return { time, open: 100, high: 110, low: 90, close: 105, volume: 10 };
}

describe('DeltaClient', () => {
  it('fetches and returns result array', async () => {
    const data = { success: true, result: [genCandle(1700000000)] };
    const client = new DeltaClient({ baseUrl: 'https://api.delta.exchange', fetchFn: mockFetchResponse({ jsonData: data }) });
    const res = await client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1700000000, end: 1700000600 });
    expect(res.length).toBe(1);
    expect(res[0].time).toBe(1700000000);
  });

  it('throws API_ERROR when success false', async () => {
    const data = { success: false, error: { code: 'bad_schema', context: {} } };
    const client = new DeltaClient({ baseUrl: 'https://api.delta.exchange', fetchFn: mockFetchResponse({ ok: true, jsonData: data }) });
    await expect(client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1, end: 2 })).rejects.toMatchObject({ code: 'API_ERROR' });
  });

  it('throws API_ERROR on non-ok status', async () => {
    const client = new DeltaClient({ baseUrl: 'https://api.delta.exchange', fetchFn: mockFetchResponse({ ok: false, status: 400, jsonData: { error: { code: 'bad_schema' } }, textData: '{"error":{"code":"bad_schema"}}' }) });
    await expect(client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1, end: 2 })).rejects.toMatchObject({ code: 'API_ERROR' });
  });

  it('throws INVALID_RESPONSE when result not array', async () => {
    const data = { success: true, result: 'not-array' };
    const client = new DeltaClient({ baseUrl: 'https://api.delta.exchange', fetchFn: mockFetchResponse({ jsonData: data }) });
    await expect(client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1, end: 2 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('throws on AbortError', async () => {
    const client = new DeltaClient({ baseUrl: 'https://api.delta.exchange', fetchFn: async () => { throw new DOMException('Aborted', 'AbortError'); } });
    const ac = new AbortController();
    ac.abort();
    await expect(client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1, end: 2, signal: ac.signal })).rejects.toHaveProperty('name', 'AbortError');
  });

  it('throws INVALID_REQUEST for start > end', async () => {
    const client = new DeltaClient({ fetchFn: mockFetchResponse({ jsonData: { success: true, result: [] } }) });
    await expect(client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 200, end: 100 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('DeltaCandleProvider', () => {
  it('successful pipeline: sorts ascending, dedups, validates', async () => {
    // API returns descending (newest first)
    const raw = [
      { time: 1700000180, open: 103, high: 104, low: 102, close: 103, volume: 5 },
      { time: 1700000120, open: 102, high: 103, low: 101, close: 102, volume: 5 },
      { time: 1700000060, open: 101, high: 102, low: 100, close: 101, volume: 5 },
    ];
    const fetchFn = mockFetchResponse({ jsonData: { success: true, result: raw } });
    const client = new DeltaClient({ fetchFn });
    const provider = new DeltaCandleProvider({ client, maxCandles: 10000, chunkSize: 2000 });
    const candles = await provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1700000000, to: 1700000200 });
    expect(candles[0].time).toBe(1700000060);
    expect(candles[2].time).toBe(1700000180);
    expect(candles.length).toBe(3);
  });

  it('handles millisecond timestamps via normalizer', async () => {
    const ms = 1700000000 * 1000;
    const raw = [{ time: ms, open: 100, high: 110, low: 90, close: 105, volume: 10 }];
    const fetchFn = mockFetchResponse({ jsonData: { success: true, result: raw } });
    const client = new DeltaClient({ fetchFn });
    const provider = new DeltaCandleProvider({ client });
    const candles = await provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1700000000 - 60, to: 1700000000 + 60 });
    expect(candles[0].time).toBe(1700000000);
  });

  it('deduplicates duplicate timestamps (keeps last)', async () => {
    const raw = [
      { time: 1700000120, open: 101, high: 102, low: 100, close: 101, volume: 5 },
      { time: 1700000060, open: 100, high: 110, low: 90, close: 105, volume: 10 },
      { time: 1700000060, open: 100, high: 110, low: 90, close: 106, volume: 12 }, // duplicate
    ];
    const fetchFn = mockFetchResponse({ jsonData: { success: true, result: raw } });
    const client = new DeltaClient({ fetchFn });
    const provider = new DeltaCandleProvider({ client });
    const candles = await provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1700000000, to: 1700000200 });
    const times = candles.map(c => c.time);
    expect(new Set(times).size).toBe(times.length);
    expect(candles.find(c => c.time === 1700000060).close).toBe(106);
  });

  it('filters invalid candles via validator', async () => {
    const raw = [
      { time: 1700000060, open: 100, high: 110, low: 90, close: 105, volume: 10 }, // valid
      { time: 1700000120, open: 100, high: 1, low: 90, close: 105, volume: 10 }, // high<open invalid
    ];
    const fetchFn = mockFetchResponse({ jsonData: { success: true, result: raw } });
    const client = new DeltaClient({ fetchFn });
    const provider = new DeltaCandleProvider({ client });
    const candles = await provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1700000000, to: 1700000200 });
    expect(candles.length).toBe(1);
    expect(candles[0].time).toBe(1700000060);
  });

  it('throws NO_DATA on empty result', async () => {
    const fetchFn = mockFetchResponse({ jsonData: { success: true, result: [] } });
    const client = new DeltaClient({ fetchFn });
    const provider = new DeltaCandleProvider({ client });
    await expect(provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1700000000, to: 1700003600 })).rejects.toMatchObject({ code: 'NO_DATA' });
  });

  it('throws INVALID_REQUEST for unsupported timeframe', async () => {
    const provider = new DeltaCandleProvider({ client: new DeltaClient({ fetchFn: mockFetchResponse({ jsonData: { success: true, result: [] } }) }) });
    await expect(provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '99m', from: 1700000000, to: 1700003600 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('throws INVALID_REQUEST when range exceeds maxCandles', async () => {
    const provider = new DeltaCandleProvider({ client: new DeltaClient({ fetchFn: mockFetchResponse({ jsonData: { success: true, result: [] } }) }), maxCandles: 10 });
    // 1m with 20 minutes => 20 candles > max 10
    await expect(provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1700000000, to: 1700001200 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('throws INVALID_REQUEST for from >= to', async () => {
    const provider = new DeltaCandleProvider({ client: new DeltaClient({ fetchFn: mockFetchResponse({ jsonData: { success: true, result: [] } }) }) });
    await expect(provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1700003600, to: 1700000000 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('propagates AbortError via signal', async () => {
    // fetch that hangs, but signal aborts
    const fetchFn = (url, { signal }) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
    const client = new DeltaClient({ fetchFn, timeoutMs: 0 });
    const provider = new DeltaCandleProvider({ client });
    const ac = new AbortController();
    const p = provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1700000000, to: 1700003600, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toHaveProperty('name', 'AbortError');
  });

  it('handles network error classified', async () => {
    const fetchFn = async () => { throw new TypeError('Failed to fetch'); };
    const client = new DeltaClient({ fetchFn });
    const provider = new DeltaCandleProvider({ client });
    await expect(provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1700000000, to: 1700000600 })).rejects.toMatchObject({ code: 'CORS_ERROR' });
  });

  it('caches result second call does not re-fetch', async () => {
    let count = 0;
    const fetchFn = async () => {
      count++;
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, result: [genCandle(1700000060)] }), text: async () => '' };
    };
    const client = new DeltaClient({ fetchFn });
    const provider = new DeltaCandleProvider({ client });
    await provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1700000000, to: 1700000200 });
    await provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1700000000, to: 1700000200 });
    expect(count).toBe(1);
  });

  it('race: stale response must not overwrite newer - via abort and token in caller (simulated)', async () => {
    const delayFetch = (delay, data) => async (url, { signal }) => {
      // Simple abort-aware delay without addEventListener to avoid Node abort propagation issues
      await new Promise((res) => setTimeout(res, delay));
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return { ok: true, status: 200, statusText: 'OK', json: async () => data, text: async () => JSON.stringify(data) };
    };
    const clientSlow = new DeltaClient({ fetchFn: delayFetch(60, { success: true, result: [genCandle(1700000060)] }), timeoutMs: 0 });
    const clientFast = new DeltaClient({ fetchFn: delayFetch(10, { success: true, result: [genCandle(1700000120)] }), timeoutMs: 0 });
    const pSlow = new DeltaCandleProvider({ client: clientSlow });
    const pFast = new DeltaCandleProvider({ client: clientFast });
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    const slow = pSlow.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1700000000, to: 1700000200, signal: ac1.signal });
    // abort before slow resolves (10ms < 60ms)
    setTimeout(() => ac1.abort(), 15);
    const fastRes = await pFast.loadCandles({ symbol: 'ETHUSDT', timeframe: '1m', from: 1700000000, to: 1700000200, signal: ac2.signal });
    expect(fastRes[0].time).toBe(1700000120);
    await expect(slow).rejects.toHaveProperty('name', 'AbortError');
  });

  it('integration: provider -> normalizer -> validator -> engine load succeeds', async () => {
    // ensure pipeline candles can be loaded into ReplayEngine
    const { ReplayEngine } = await import('../src/replay/ReplayEngine.js');
    const raw = [
      { time: 1700000060, open: 100, high: 110, low: 90, close: 105, volume: 10 },
      { time: 1700000120, open: 105, high: 115, low: 100, close: 110, volume: 10 },
    ];
    const fetchFn = mockFetchResponse({ jsonData: { success: true, result: raw } });
    const client = new DeltaClient({ fetchFn });
    const provider = new DeltaCandleProvider({ client });
    const candles = await provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1700000000, to: 1700000200 });
    const engine = new ReplayEngine();
    expect(() => engine.load(candles)).not.toThrow();
    expect(engine.getTotalCandles()).toBe(2);
  });
});
