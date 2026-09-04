import { describe, expect, it } from 'vitest';
import { HistoricalDataManager } from '../src/data/HistoricalDataManager.js';

const candles = [
  { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1 },
  { time: 60, open: 100, high: 102, low: 99, close: 101, volume: 1 },
  { time: 120, open: 101, high: 103, low: 100, close: 102, volume: 1 },
];

class PublicOnlyCache {
  constructor({ hit = false } = {}) {
    this.enableIDB = false;
    this.hit = hit;
    this.operations = [];
  }

  get(symbol, timeframe, from, to) {
    this.operations.push('get');
    return this.hit
      ? { hit: true, candles: candles.map(c => ({ ...c })), missing: [], intervals: [{ from: 0, to: 120 }] }
      : { hit: false, candles: [], missing: [{ from, to }], intervals: [] };
  }

  getCoverage() {
    this.operations.push('getCoverage');
    return [{ from: 0, to: 120 }];
  }

  repairIntervals() {
    this.operations.push('repairIntervals');
  }

  reconcile() {
    this.operations.push('reconcile');
  }

  invalidate() {
    this.operations.push('invalidate');
  }

  set() {
    this.operations.push('set');
  }
}

describe('HistoricalDataManager public cache contract', () => {
  it('loads successfully with a cache implementation that exposes no internal state', async () => {
    const cache = new PublicOnlyCache();
    const provider = {
      venue: 'TEST',
      getGridSpec: () => ({ origin: 0 }),
      fetchChunk: async () => candles,
    };
    const manager = new HistoricalDataManager({ provider, cache, chunkSize: 10 });

    const result = await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 0, to: 120 });

    expect(result.quality).toBe('VALID');
    expect(result.candles).toHaveLength(3);
    expect(cache.operations).toEqual(['get', 'set']);
  });

  it('repairs cache coverage through public methods on a cache hit', async () => {
    const cache = new PublicOnlyCache({ hit: true });
    const provider = { venue: 'TEST', getGridSpec: () => ({ origin: 0 }) };
    const manager = new HistoricalDataManager({ provider, cache });

    const result = await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 0, to: 120 });

    expect(result.quality).toBe('VALID');
    expect(result.metadata.cached).toBe(true);
    expect(cache.operations).toContain('getCoverage');
    expect(cache.operations).not.toContain('getCoverageInternal');
    expect(cache.operations.some(op => op.startsWith('_'))).toBe(false);
  });
});
