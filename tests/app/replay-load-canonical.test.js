import { describe, expect, it, vi } from 'vitest';
import { createReplayLoadService } from '../../src/app/ReplayLoadService.js';

const candles = Array.from({ length: 3 }, (_, i) => ({
  time: i + 1,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100.5 + i,
  volume: 1,
}));

function deps(source = 'github') {
  const repository = {
    list: vi.fn(async () => [{ id: 'd1', symbol: 'BTCUSDT', timeframe: '1m', count: candles.length }]),
    get: vi.fn(async () => ({ id: 'd1', symbol: 'BTCUSDT', timeframe: '1m', count: candles.length })),
    getCandles: vi.fn(async () => ({ metadata: { id: 'd1', symbol: 'BTCUSDT', timeframe: '1m', timeframeSec: 1 }, candles })),
  };
  const local = {
    get: vi.fn(async () => ({ metadata: { id: 'l1', symbol: 'BTCUSDT', timeframe: '1m', timeframeSec: 1 }, candles })),
  };
  const store = {
    count: candles.length,
    load: vi.fn(),
    getCount: vi.fn(() => candles.length),
    getAll: vi.fn(() => candles),
  };
  const appState = {
    replayDatasetId: null,
    replayDatasetSource: source,
    symbol: 'BTCUSDT',
    timeframe: '1m',
    transitionLoading: vi.fn(),
    setLoading: vi.fn(),
    setReplayDatasetId: vi.fn(),
    setReplayState: vi.fn(),
    setPendingStartIndex: vi.fn(),
  };
  const engine = {
    loadDataset: vi.fn(async () => ({ status: 'ready', currentIndex: -1, startIndex: 0, totalCandles: candles.length })),
    start: vi.fn(),
    getState: vi.fn(() => ({ status: 'ready', currentIndex: -1, startIndex: 0, totalCandles: candles.length })),
  };
  return {
    datasetRepository: repository,
    localDatasetRepository: local,
    candleStore: store,
    appState,
    replayEngine: engine,
    hasOpenPosition: () => false,
    hasPendingOrders: () => false,
    hasTradingActivity: () => false,
    statusView: { snapshot: () => ({}) },
    timeline: { setTotal: vi.fn(), setPosition: vi.fn(), setEnabled: vi.fn() },
    controls: { setStartIndex: vi.fn() },
    modeBanner: { update: vi.fn() },
    errorPanel: { hide: vi.fn(), show: vi.fn() },
    preview: vi.fn(),
  };
}

describe('ReplayLoadService canonical dataset loading', () => {
  it('loads complete GitHub candles once and gives that exact dataset to the replay engine', async () => {
    const d = deps();
    await createReplayLoadService(d).loadAndPrepareReplay({ datasetId: 'd1', datasetSource: 'github' });
    expect(d.datasetRepository.getCandles).toHaveBeenCalledWith('d1');
    expect(d.replayEngine.loadDataset).toHaveBeenCalledWith(candles, expect.objectContaining({ startIndex: 0, metadata: expect.any(Object) }));
    expect(d.candleStore.load).not.toHaveBeenCalled();
    expect(d.timeline.setTotal).toHaveBeenCalledWith(candles.length, candles);
  });

  it('uses the browser-local candles directly and never creates backend replay chunks', async () => {
    const d = deps('local');
    await createReplayLoadService(d).loadAndPrepareReplay({ datasetId: 'l1', datasetSource: 'local' });
    expect(d.localDatasetRepository.get).toHaveBeenCalledWith('l1');
    expect(d.datasetRepository.getCandles).not.toHaveBeenCalled();
    expect(d.replayEngine.loadDataset).toHaveBeenCalledWith(candles, expect.objectContaining({ startIndex: 0, metadata: expect.any(Object) }));
    expect(d.timeline.setTotal).toHaveBeenCalledWith(candles.length, candles);
  });
});
