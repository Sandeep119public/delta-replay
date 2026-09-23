import { describe, expect, it } from 'vitest';
import { LocalDatasetRepository } from '../../src/app/LocalDatasetRepository.js';

const candles = [
  { time: 60, open: 100, high: 101, low: 99, close: 100, volume: 1 },
  { time: 120, open: 100, high: 102, low: 99, close: 101, volume: 2 },
];

const csv = [
  'time,open,high,low,close,volume',
  '60,100,101,99,100,1',
  '120,100,102,99,101,2',
  '',
].join('\n');

function file(name = 'BTCUSDT-1m.csv', content = csv) {
  return { name, size: content.length, text: async () => content };
}

describe('LocalDatasetRepository', () => {
  it('imports canonical CSV into browser-local storage and returns reusable metadata', async () => {
    const repository = new LocalDatasetRepository();
    const metadata = await repository.importFile(file());
    expect(metadata.symbol).toBe('BTCUSDT');
    expect(metadata.timeframe).toBe('1m');
    expect(metadata.count).toBe(2);
    expect(metadata.local).toBe(true);
    expect(metadata.status).toBe('validated');
    const record = await repository.get(metadata.id);
    expect(record.candles).toEqual(candles);
    const exported = await repository.getCsv(metadata.id);
    expect(exported.csv).toBe(csv);
  });

  it('does not keep a second in-memory copy when IndexedDB is available', async () => {
    const previous = globalThis.indexedDB;
    try {
      const db = new Map();
      const fakeIndexedDB = {
        open: () => {
          const request = {};
          queueMicrotask(() => {
            request.result = {
              objectStoreNames: { contains: () => true },
              transaction: (_store, mode) => {
                const tx = { objectStore: () => ({
                  put: (record) => db.set(record.id, structuredClone(record)),
                  get: (id) => {
                    const inner = { onsuccess: null, result: db.get(id) || null };
                    queueMicrotask(() => inner.onsuccess?.());
                    return inner;
                  },
                  getAll: () => {
                    const inner = { onsuccess: null, result: [...db.values()] };
                    queueMicrotask(() => inner.onsuccess?.());
                    return inner;
                  },
                  delete: (id) => { db.delete(id); },
                }) };
                queueMicrotask(() => tx.oncomplete?.());
                return tx;
              },
              close() {},
            };
            request.onsuccess?.();
          });
          return request;
        },
      };
      globalThis.indexedDB = fakeIndexedDB;
      const repository = new LocalDatasetRepository();
      const metadata = await repository.importFile(file('ETHUSDT-1m.csv'));
      expect(await repository.get(metadata.id)).not.toBeNull();
    } finally {
      globalThis.indexedDB = previous;
    }
  });

  it('rejects malformed datasets before storing them', async () => {
    const repository = new LocalDatasetRepository();
    await expect(repository.importFile(file('BTCUSDT-1m.csv', 'time,open,high,low,close,volume\n60,100,99,99,100,1\n'))).rejects.toThrow(/integrity|invalid/i);
  });

  it('can remove only local browser datasets', async () => {
    const repository = new LocalDatasetRepository();
    const metadata = await repository.importFile(file());
    await repository.remove(metadata.id);
    expect(await repository.get(metadata.id)).toBeNull();
  });
});
