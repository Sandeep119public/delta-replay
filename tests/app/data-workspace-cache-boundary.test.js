import { describe, expect, it, vi } from 'vitest';
import { CandleStore } from '../../src/data/CandleStore.js';
import { createDataWorkspacePort } from '../../src/app/createDataWorkspacePort.js';

const candles = [
  { time: 60, open: 100, high: 101, low: 99, close: 100, volume: 1 },
  { time: 120, open: 100, high: 102, low: 99, close: 101, volume: 1 },
];

function deps() {
  const candleStore = new CandleStore();
  candleStore.load(candles, { symbol: 'BTCUSDT', timeframe: '1m', timeframeSec: 60, effectiveFrom: 60, effectiveTo: 120 });
  const candleCache = {
    enableIDB: false,
    getCoverage: vi.fn(() => [{ from: 60, to: 120 }]),
    invalidate: vi.fn(),
    persist: vi.fn(async () => undefined),
  };
  const replayDataManager = { on: vi.fn(() => () => {}) };
  const datasetService = {
    download: vi.fn(async () => ({ datasetId: 'dataset-1', format: 'parquet', count: 2 })),
    list: vi.fn(async () => ({ datasets: [{ datasetId: 'dataset-1', format: 'parquet', count: 2 }] })),
  };
  const port = createDataWorkspacePort({ replayDataManager, datasetService, candleStore, candleCache, appState: { symbol: 'BTCUSDT', timeframe: '1m' } });
  return { port, candleStore, candleCache, datasetService };
}

describe('stored dataset workspace boundary', () => {
  it('downloads through dataset storage without mutating replay candles', async () => {
    const d = deps();
    const result = await d.port.download({ symbol: 'SOLUSDT', timeframe: '15m', from: 60, to: 120 });
    expect(d.datasetService.download).toHaveBeenCalledWith({ symbol: 'SOLUSDT', timeframe: '15m', from: 60, to: 120 });
    expect(d.candleStore.getAll()).toEqual(candles);
    expect(result.format).toBe('parquet');
    expect(d.datasetService.list).toHaveBeenCalled();
  });

  it('clears browser cache without deleting replay candles', async () => {
    const d = deps();
    const snapshot = await d.port.clearCurrent();
    expect(d.candleCache.invalidate).toHaveBeenCalledWith('BTCUSDT', '1m');
    expect(d.candleCache.persist).toHaveBeenCalledOnce();
    expect(d.candleStore.getAll()).toEqual(candles);
    expect(snapshot.count).toBe(2);
  });

  it('serializes download and cache operations', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const d = deps();
    d.datasetService.download = vi.fn(() => pending);
    const downloading = d.port.download({ symbol: 'SOLUSDT', timeframe: '15m', from: 60, to: 120 });
    const clearing = d.port.clearCurrent();
    await Promise.resolve();
    expect(d.candleCache.invalidate).not.toHaveBeenCalled();
    release({ datasetId: 'dataset-1', format: 'parquet', count: 2 });
    await downloading;
    await clearing;
    expect(d.candleCache.invalidate).toHaveBeenCalledOnce();
  });
});
