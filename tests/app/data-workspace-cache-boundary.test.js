import { describe, expect, it, vi } from 'vitest';
import { CandleStore } from '../../src/data/CandleStore.js';
import { createDataWorkspacePort } from '../../src/app/createDataWorkspacePort.js';

const candles = [
  { time: 60, open: 100, high: 101, low: 99, close: 100, volume: 1 },
  { time: 120, open: 100, high: 102, low: 99, close: 101, volume: 1 },
];

function deps() {
  const candleStore = new CandleStore();
  candleStore.load(candles, {
    symbol: 'BTCUSDT',
    timeframe: '1m',
    timeframeSec: 60,
    effectiveFrom: 60,
    effectiveTo: 120,
  });

  const candleCache = {
    enableIDB: false,
    getCoverage: vi.fn(() => [{ from: 60, to: 120 }]),
    invalidate: vi.fn(),
    persist: vi.fn(async () => undefined),
  };

  const datasetRepository = {
    download: vi.fn(async ({ symbol, timeframe, onProgress }) => {
      onProgress?.({ status: 'running', loaded: 1, total: 2, pct: 50 });
      return { id: `${symbol}__${timeframe}__60__120`, symbol, timeframe, from: 60, to: 120, count: 2, format: 'CSV', status: 'validated' };
    }),
    list: vi.fn(async () => []),
    get: vi.fn(),
    getCandles: vi.fn(),
    getCsv: vi.fn(),
    remove: vi.fn(),
  };
  let stagedStore = null;


  const port = createDataWorkspacePort({
    dataManager: null,
    candleStore,
    candleCache,
    datasetRepository,
    appState: { symbol: 'BTCUSDT', timeframe: '1m' },
  });

  return { port, candleStore, candleCache, datasetRepository, getStagedStore: () => stagedStore };
}

describe('data workspace cache boundary', () => {
  it('downloads through the remote dataset service without replacing the active replay store', async () => {
    const d = deps();

    const result = await d.port.download({
      symbol: 'ETHUSDT',
      timeframe: '5m',
      from: 60,
      to: 120,
    });

    expect(d.datasetRepository.download).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'ETHUSDT',
      timeframe: '5m',
      from: 60,
      to: 120,
      onProgress: expect.any(Function),
    }));
    expect(d.candleStore.getAll()).toEqual(candles);
    expect(result.quality).toBe('VALID');
    expect(result.savedDataset.status).toBe('validated');
  });


  it('clears cached coverage without destroying the active replay dataset', async () => {
    const d = deps();

    const snapshot = await d.port.clearCurrent();

    expect(d.candleCache.invalidate).toHaveBeenCalledWith('BTCUSDT', '1m');
    expect(d.candleCache.persist).toHaveBeenCalledOnce();
    expect(d.candleStore.getAll()).toEqual(candles);
    expect(snapshot.count).toBe(0);
    expect(d.datasetRepository.list).not.toHaveBeenCalled();
  });

  it('serializes cache operations so clear cannot race an in-flight download', async () => {
    let releaseDownload;
    const downloadStarted = new Promise((resolve) => { releaseDownload = resolve; });
    const d = deps();

    d.datasetRepository.download = vi.fn(() => downloadStarted);
    const downloading = d.port.download({
      symbol: 'ETHUSDT',
      timeframe: '5m',
      from: 60,
      to: 120,
    });
    const clearing = d.port.clearCurrent();

    await Promise.resolve();
    expect(d.candleCache.invalidate).not.toHaveBeenCalled();

    releaseDownload({ id: 'dataset-1', status: 'complete', symbol: 'ETHUSDT', timeframe: '5m', count: 2 });
    await downloading;
    await clearing;

    expect(d.candleCache.invalidate).toHaveBeenCalledOnce();
  });
});
