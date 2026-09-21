import { describe, it, expect } from 'vitest';
import { HistoricalDataManager } from '../src/data/HistoricalDataManager.js';
import { CandleStore } from '../src/data/CandleStore.js';
import { CandleCache } from '../src/data/CandleCache.js';
import { CandleIntegrity } from '../src/data/CandleIntegrity.js';

function candle(time, close = 100) {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 10 };
}

class MockProvider {
  constructor({ client, chunkSize = 2000 } = {}) { this.client = client; this.chunkSize = chunkSize; this.venue = 'TEST'; }
  getGridSpec() { return { origin: this.client?.gridOrigin ?? 0, timeframeUnit: 'seconds', alignment: 'UTC' }; }
  fetchChunk({ symbol, timeframe, from, to, signal }) {
    return this.client.fetchCandles({ symbol, resolution: timeframe, start: from, end: to, signal });
  }
  getCandles(args) { return this.fetchChunk(args); }
}

describe('HistoricalDataManager', () => {
  it('loads a valid range into the target store', async () => {
    const store = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    const provider = new MockProvider({ client: { gridOrigin: 1000, fetchCandles: async () => [candle(1000), candle(1060)] } });
    const manager = new HistoricalDataManager({ provider, store, cache, concurrency: 1 });
    const result = await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 1100 });
    expect(result.candles).toHaveLength(2);
    expect(store.getCount()).toBe(2);
  });

  it('can populate an isolated target store without mutating the manager store', async () => {
    const sharedStore = new CandleStore();
    const targetStore = new CandleStore();
    const cache = new CandleCache({ enableIDB: false });
    const provider = new MockProvider({ client: { gridOrigin: 1000, fetchCandles: async () => [candle(1000), candle(1060)] } });
    const manager = new HistoricalDataManager({ provider, store: sharedStore, cache });
    await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 1060, store: targetStore });
    expect(sharedStore.getCount()).toBe(0);
    expect(targetStore.getCount()).toBe(2);
  });

  it('retries transient network failures', async () => {
    let calls = 0;
    const provider = new MockProvider({ client: { gridOrigin: 1000, fetchCandles: async () => { calls += 1; if (calls < 3) { const error = new Error('net'); error.code = 'NETWORK_ERROR'; throw error; } return [candle(1000)]; } } });
    const manager = new HistoricalDataManager({ provider, store: new CandleStore(), cache: new CandleCache({ enableIDB: false }), maxRetries: 3 });
    const result = await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 1060 });
    expect(result.candles).toHaveLength(1);
    expect(calls).toBe(3);
  });

  it('does not cache empty results', async () => {
    let calls = 0;
    const provider = new MockProvider({ client: { gridOrigin: 1000, fetchCandles: async () => { calls += 1; return []; } } });
    const manager = new HistoricalDataManager({ provider, store: new CandleStore(), cache: new CandleCache({ enableIDB: false }) });
    await expect(manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 1060 })).rejects.toMatchObject({ code: 'NO_DATA' });
    await expect(manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 1060 })).rejects.toMatchObject({ code: 'NO_DATA' });
    expect(calls).toBe(2);
  });

  it('integrity removes duplicates and reports gaps', () => {
    const raw = [candle(1000), candle(1120), candle(1000), candle(1180)];
    const result = CandleIntegrity.process(raw, { from: 1000, to: 1180, timeframeSec: 60 });
    expect(result.validCandles).toHaveLength(3);
    expect(result.metadata.duplicatesRemoved).toBe(1);
    expect(result.metadata.gaps.length).toBeGreaterThan(0);
  });

  it('candle cache detects missing intervals', () => {
    const cache = new CandleCache({ enableIDB: false });
    cache.set('BTCUSDT', '1m', 1000, 1060, [candle(1000), candle(1060)]);
    const result = cache.get('BTCUSDT', '1m', 1000, 1180);
    expect(result.hit).toBe(false);
    expect(result.missing[0]).toEqual({ from: 1120, to: 1180 });
  });
});

describe('CandleStore', () => {
  it('supports binary-search lookup and window slicing', () => {
    const store = new CandleStore();
    const candles = Array.from({ length: 5000 }, (_, index) => candle(1000 + index * 60, 100 + index));
    store.load(candles, { symbol: 'BTCUSDT', timeframe: '1m' });
    expect(store.findIndexByTime(1000 + 100 * 60)).toBe(100);
    expect(store.sliceWindow(4000, 4999)).toHaveLength(1000);
  });
});
