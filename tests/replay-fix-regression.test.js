import { describe, it, expect, vi } from 'vitest';
import { CandleGrid } from '../src/data/CandleGrid.js';
import { computeGridMissing, normalizeRange } from '../src/data/CandleGrid.js';
import { DeltaClient } from '../src/data/DeltaClient.js';
import { DeltaCandleProvider } from '../src/data/DeltaCandleProvider.js';

function candle(time, close = 100) {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 1 };
}

function response(result) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, result }), text: async () => JSON.stringify({ success: true, result }) };
}

describe('replay data hardening regressions', () => {
  it('computes missing ranges without introducing off-grid timestamps', () => {
    expect(computeGridMissing(1000, 1180, [{ from: 1000, to: 1060 }], 60))
      .toEqual([{ from: 1120, to: 1180 }]);
    expect(normalizeRange(1001, 1181, 60, 0)).toMatchObject({ effectiveFrom: 1020, effectiveTo: 1140 });
  });

  it('uses exactly chunkSize candles per deterministic request window', async () => {
    const calls = [];
    const client = new DeltaClient({
      fetchFn: async (url) => {
        const u = new URL(url);
        const start = Number(u.searchParams.get('start'));
        const end = Number(u.searchParams.get('end'));
        calls.push({ start, end });
        const result = [];
        for (let t = start; t <= end; t += 60) result.push(candle(t));
        return response(result);
      },
    });
    const provider = new DeltaCandleProvider({ client, chunkSize: 2 });
    const result = await provider.loadCandles({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 1180 });

    expect(result.map(x => x.time)).toEqual([1000, 1060, 1120, 1180]);
    expect(calls).toEqual([
      { start: 1000, end: 1060 },
      { start: 1120, end: 1180 },
    ]);
  });

  it('preserves AbortError when caller cancels during fetch', async () => {
    const controller = new AbortController();
    const client = new DeltaClient({
      timeoutMs: 1000,
      fetchFn: async (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    });
    const pending = client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 1060, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toHaveProperty('name', 'AbortError');
  });

  it('classifies a client timeout separately from caller cancellation', async () => {
    const client = new DeltaClient({
      timeoutMs: 10,
      fetchFn: async (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    });
    await expect(client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 1060 }))
      .rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
