import { describe, expect, it, vi } from 'vitest';
import { createReplayLoadService } from '../../src/app/ReplayLoadService.js';

const candles = [
  { time: 60, open: 100, high: 101, low: 99, close: 100, volume: 1 },
  { time: 120, open: 100, high: 102, low: 99, close: 101, volume: 1 },
];

function deps(overrides = {}) {
  return {
    datasetRepository: {
      list: vi.fn(async () => [{ id: 'BTCUSDT__1M__60__120', symbol: 'BTCUSDT', timeframe: '1m', count: 2 }]),
      getCandles: vi.fn(async () => ({ metadata: { id: 'BTCUSDT__1M__60__120', symbol: 'BTCUSDT', timeframe: '1m', timeframeSec: 60 }, candles })),
    },
    localDatasetRepository: {
      get: vi.fn(async () => ({ metadata: { id: 'local-abc', symbol: 'BTCUSDT', timeframe: '1m', timeframeSec: 60 }, candles })),
    },
    appState: {
      symbol: 'BTCUSDT',
      timeframe: '1m',
      replayDatasetId: null,
      replayDatasetSource: null,
      loadingState: 'idle',
      transitionLoading: vi.fn(),
      setLoading: vi.fn(),
      setReplayState: vi.fn(),
      setReplayDatasetId: vi.fn(),
      setPendingStartIndex: vi.fn(),
    },
    replayEngine: {
      loadDataset: vi.fn(async () => ({ status: 'ready', totalCandles: 2, currentIndex: -1, startIndex: 0 })),
    },
    hasOpenPosition: () => false,
    hasPendingOrders: () => false,
    hasTradingActivity: () => false,
    ...overrides,
  };
}

describe('ReplayLoadService', () => {
  it('loads the complete saved dataset and gives it to the replay engine', async () => {
    const d = deps();
    const result = await createReplayLoadService(d).loadAndPrepareReplay({ datasetId: 'BTCUSDT__1M__60__120' });
    expect(d.datasetRepository.list).toHaveBeenCalledOnce();
    expect(d.datasetRepository.getCandles).toHaveBeenCalledWith('BTCUSDT__1M__60__120');
    expect(d.replayEngine.loadDataset).toHaveBeenCalledWith(candles, expect.objectContaining({ startIndex: 0, metadata: expect.any(Object) }));
    expect(result.metadata).toMatchObject({ datasetId: 'BTCUSDT__1M__60__120', symbol: 'BTCUSDT', timeframe: '1m' });
  });

  it('loads a browser-local dataset without contacting the GitHub dataset repository', async () => {
    const d = deps();
    const result = await createReplayLoadService(d).loadAndPrepareReplay({ datasetId: 'local-abc', datasetSource: 'local' });
    expect(d.localDatasetRepository.get).toHaveBeenCalledWith('local-abc');
    expect(d.replayEngine.loadDataset).toHaveBeenCalledWith(candles, expect.any(Object));
    expect(d.datasetRepository.list).not.toHaveBeenCalled();
    expect(result.metadata).toMatchObject({ datasetId: 'local-abc', local: true });
  });

  it('rejects when no saved replay dataset exists', async () => {
    const d = deps({
      datasetRepository: { list: vi.fn(async () => []), getCandles: vi.fn() },
    });
    await expect(createReplayLoadService(d).loadAndPrepareReplay()).rejects.toThrow(/download historical Binance data first/i);
    expect(d.replayEngine.loadDataset).not.toHaveBeenCalled();
  });

  it('rejects before changing replay identity when engine load fails', async () => {
    const d = deps({
      replayEngine: { loadDataset: vi.fn(async () => { throw new Error('integrity failure'); }) },
    });
    await expect(createReplayLoadService(d).loadAndPrepareReplay({ datasetId: 'bad' })).rejects.toThrow(/integrity failure/i);
    expect(d.appState.setReplayDatasetId).not.toHaveBeenCalled();
  });

  it('commits replay identity only after engine load succeeds', async () => {
    const d = deps();
    await createReplayLoadService(d).loadAndPrepareReplay({ datasetId: 'BTCUSDT__1M__60__120' });
    expect(d.appState.setReplayDatasetId).toHaveBeenCalledWith('BTCUSDT__1M__60__120', 'github');
    expect(d.appState.setReplayState).toHaveBeenCalled();
    expect(d.appState.transitionLoading).toHaveBeenLastCalledWith(expect.any(String));
  });
});
