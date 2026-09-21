import { describe, expect, it } from 'vitest';
import { StoredDatasetRepository, candlesToCsv } from '../../src/app/StoredDatasetRepository.js';

class FakeRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
  }
  success(result) {
    this.result = result;
    queueMicrotask(() => this.onsuccess?.({ target: this }));
  }
  fail(error) {
    this.error = error;
    queueMicrotask(() => this.onerror?.({ target: this }));
  }
}

class FakeObjectStore {
  constructor(map) { this.map = map; }
  put(value) { const request = new FakeRequest(); queueMicrotask(() => { this.map.set(value.id, structuredClone(value)); request.success(value); }); return request; }
  get(id) { const request = new FakeRequest(); queueMicrotask(() => request.success(this.map.get(id) ? structuredClone(this.map.get(id)) : undefined)); return request; }
  getAll() { const request = new FakeRequest(); queueMicrotask(() => request.success([...this.map.values()].map(structuredClone))); return request; }
  delete(id) { const request = new FakeRequest(); queueMicrotask(() => { this.map.delete(id); request.success(undefined); }); return request; }
}

class FakeDb {
  constructor(stores = new Map()) {
    this.stores = stores;
    this.objectStoreNames = { contains: (name) => this.stores.has(name) };
  }
  createObjectStore(name) { this.stores.set(name, new Map()); return {}; }
  transaction(name) { return { objectStore: () => new FakeObjectStore(this.stores.get(name)) }; }
  close() {}
}

class FakeIndexedDB {
  constructor() { this.db = new FakeDb(); }
  open() {
    const request = new FakeRequest();
    queueMicrotask(() => {
      if (!request.result) {
        if (!this.db.objectStoreNames.contains('datasets')) this.db.createObjectStore('datasets');
        request.result = this.db;
        request.onupgradeneeded?.({ target: request });
      }
      request.onsuccess?.({ target: request });
    });
    return request;
  }
}

const candles = [
  { time: 60, open: 100, high: 101, low: 99, close: 100, volume: 10 },
  { time: 120, open: 100, high: 102, low: 99, close: 101, volume: 12 },
];

describe('StoredDatasetRepository', () => {
  it('serializes the canonical dataset as plain CSV', () => {
    expect(candlesToCsv(candles)).toBe(
      'time,open,high,low,close,volume\n' +
      '60,100,101,99,100,10\n' +
      '120,100,102,99,101,12\n',
    );
  });

  it('persists dataset metadata and replay candles in IndexedDB', async () => {
    const repo = new StoredDatasetRepository({ indexedDBFactory: new FakeIndexedDB() });
    const saved = await repo.save({
      symbol: 'BTCUSDT',
      timeframe: '1m',
      from: 60,
      to: 120,
      candles,
      metadata: { quality: 'VALID', coverageType: 'CONTIGUOUS' },
    });

    expect(saved.format).toBe('CSV');
    expect(saved.count).toBe(2);

    const listed = await repo.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(saved.id);

    const loaded = await repo.getCandles(saved.id);
    expect(loaded.candles).toEqual(candles);

    const exported = await repo.getCsv(saved.id);
    expect(exported.csv).toContain('time,open,high,low,close,volume');

    await repo.remove(saved.id);
    expect(await repo.list()).toHaveLength(0);
  });
});
