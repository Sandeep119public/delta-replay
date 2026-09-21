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
    save: vi.fn(async ({ symbol, timeframe, from, to, candles: savedCandles, metadata }) => ({
      id: `${symbol}__${timeframe}__${from}__${to}`,
      symbol, timeframe, from, to, count: savedCandles.length, format: 'CSV', quality: metadata.quality,
    })),
    list: vi.fn(async () => []),
    get: vi.fn(),
    getCandles: vi.fn(),
    getCsv: vi.fn(),
    remove: vi.fn(),
  };
  let stagedStore = null;
  const dataManager = {
    load: vi.fn(async ({ store }) => {
      stagedStore = store;
      store.load(candles, {
        symbol: 'ETHUSDT',
        timeframe: '5m',
        timeframeSec: 300,
        effectiveFrom: 60,
        effectiveTo: 120,
      });
      return { candles, metadata: store.getMetadata(), quality: 'VALID' };
    }),
  };

  const port = createDataWorkspacePort({
    dataManager,
    candleStore,
    candleCache,
    datasetRepository,
    appState: { symbol: 'BTCUSDT', timeframe: '1m' },
  });

  return { port, candleStore, candleCache, datasetRepository, dataManager, getStagedStore: () => stagedStore };
}

describe('data workspace cache boundary', () => {
  it('stages downloads so the active replay store is never replaced', async () => {
    const d = deps();

    const result = await d.port.download({
      symbol: 'ETHUSDT',
      timeframe: '5m',
      from: 60,
      to: 120,
    });

    expect(d.dataManager.load).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'ETHUSDT',
      timeframe: '5m',
      strict: true,
      store: expect.any(CandleStore),
    }));
    expect(d.getStagedStore()).not.toBe(d.candleStore);
    expect(d.getStagedStore().getAll()).toEqual(candles);
    expect(d.candleStore.getAll()).toEqual(candles);
    expect(result.quality).toBe('VALID');
    expect(d.datasetRepository.save).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ETHUSDT', timeframe: '5m', candles }));
  });

  it('clears cached coverage without destroying the active replay dataset', async () => {
    const d = deps();

    const snapshot = await d.port.clearCurrent();

    expect(d.candleCache.invalidate).toHaveBeenCalledWith('BTCUSDT', '1m');
    expect(d.candleCache.persist).toHaveBeenCalledOnce();
    expect(d.candleStore.getAll()).toEqual(candles);
    expect(snapshot.count).toBe(2);
  });

  it('serializes cache operations so clear cannot race an in-flight download', async () => {
    let releaseDownload;
    const downloadStarted = new Promise((resolve) => { releaseDownload = resolve; });
    const d = deps();

    d.dataManager.load = vi.fn(() => downloadStarted);
    const downloading = d.port.download({
      symbol: 'ETHUSDT',
      timeframe: '5m',
      from: 60,
      to: 120,
    });
    const clearing = d.port.clearCurrent();

    await Promise.resolve();
    expect(d.candleCache.invalidate).not.toHaveBeenCalled();

    releaseDownload({ candles, metadata: {}, quality: 'VALID' });
    await downloading;
    await clearing;

    expect(d.candleCache.invalidate).toHaveBeenCalledOnce();
  });
});
