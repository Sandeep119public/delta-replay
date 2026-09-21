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
      get: vi.fn(async () => ({ id: 'BTCUSDT__1M__60__120', symbol: 'BTCUSDT', timeframe: '1m', count: 2, format: 'CSV', from: 60, to: 120 })),
      getRange: vi.fn(async () => ({ metadata: { id: 'BTCUSDT__1M__60__120', symbol: 'BTCUSDT', timeframe: '1m', format: 'CSV' }, candles })),
    },
    candleStore: {
      get: vi.fn((index) => candles[index] || null),
      getCount: vi.fn(() => candles.length),
    },
    appState: {
      symbol: 'BTCUSDT',
      timeframe: '1m',
      replayDatasetId: null,
      loadingState: 'idle',
      setMode: vi.fn(),
      transitionLoading: vi.fn(),
      setLoading: vi.fn(),
      setCandles: vi.fn(),
      setReplayState: vi.fn(),
      setReplayDatasetId: vi.fn(),
      setPendingStartIndex: vi.fn(),
    },
    replayEngine: {
      loadDataset: vi.fn(async () => ({ status: 'ready', total: 2, totalCandles: 2, currentIndex: -1, startIndex: -1, visibleCandles: [] })),
      getState: vi.fn(() => ({ status: 'ready', totalCandles: 2, currentIndex: -1, startIndex: -1 })),
      start: vi.fn(async () => undefined),
    },
    hasOpenPosition: () => false,
    hasPendingOrders: () => false,
    hasTradingActivity: () => false,
    statusView: { snapshot: vi.fn(() => ({})) },
    timeline: { setTotal: vi.fn(), setPosition: vi.fn(), setEnabled: vi.fn() },
    controls: { setStartIndex: vi.fn() },
    modeBanner: { update: vi.fn() },
    errorPanel: { hide: vi.fn(), show: vi.fn() },
    updatePreviewWindow: vi.fn(),
    ...overrides,
  };
}

describe('ReplayLoadService', () => {
  it('loads only from the saved dataset repository', async () => {
    const d = deps();
    const service = createReplayLoadService(d);

    await service.loadAndPrepareReplay({ datasetId: 'BTCUSDT__1M__60__120' });

    expect(d.datasetRepository.list).toHaveBeenCalledOnce();
    expect(d.datasetRepository.getRange).toHaveBeenCalledWith('BTCUSDT__1M__60__120', { offset: 0, limit: 2000 });
    expect(d.replayEngine.loadDataset).toHaveBeenCalledWith('BTCUSDT__1M__60__120');
  });

  it('never calls a network data manager because replay loading has no data manager dependency', () => {
    expect(() => createReplayLoadService(deps({ dataManager: { load: vi.fn() } }))).not.toThrow();
  });

  it('rejects when no saved replay dataset exists', async () => {
    const d = deps({
      datasetRepository: { list: vi.fn(async () => []), get: vi.fn(), getRange: vi.fn() },
    });
    const service = createReplayLoadService(d);

    await expect(service.loadAndPrepareReplay()).rejects.toThrow(/download historical Binance data first/i);
    expect(d.replayEngine.loadDataset).not.toHaveBeenCalled();
  });

  it('does not replace replay state after a trading activity guard rejects the load', async () => {
    const d = deps({
      hasTradingActivity: () => true,
      tradingErrorView: { show: vi.fn() },
    });

    await createReplayLoadService(d).loadAndPrepareReplay({ datasetId: 'x' });

    expect(d.datasetRepository.get).not.toHaveBeenCalled();
    expect(d.replayEngine.loadDataset).not.toHaveBeenCalled();
    expect(d.tradingErrorView.show).toHaveBeenCalledWith(expect.stringContaining('trading activity'));
  });

  it('validates the stored candles before handing them to replay', async () => {
    const d = deps({
      datasetRepository: {
        list: vi.fn(async () => [{ id: 'bad', symbol: 'BTCUSDT', timeframe: '1m', count: 2 }]),
        get: vi.fn(async () => ({ id: 'bad', symbol: 'BTCUSDT', timeframe: '1m', count: 2 })),
        getRange: vi.fn(async () => ({ metadata: { id: 'bad', symbol: 'BTCUSDT', timeframe: '1m' }, candles: [
            { time: 60, open: 100, high: 101, low: 99, close: 100, volume: 1 },
            { time: 180, open: 100, high: 102, low: 99, close: 101, volume: 1 },
          ] })),
      },
    });

    await expect(createReplayLoadService(d).loadAndPrepareReplay({ datasetId: 'bad' }))
      .rejects.toThrow();
    expect(d.replayEngine.loadDataset).not.toHaveBeenCalled();
  });

  it('publishes the committed replay dataset after remote replay load succeeds', async () => {
    const d = deps();

    await createReplayLoadService(d).loadAndPrepareReplay({ datasetId: 'BTCUSDT__1M__60__120' });

    expect(d.appState.setReplayDatasetId).toHaveBeenCalledWith('BTCUSDT__1M__60__120');
    expect(d.appState.setCandles).toHaveBeenCalledWith(
      candles,
      expect.objectContaining({ saved: true, format: 'CSV' }),
    );
    expect(d.appState.setReplayState).toHaveBeenCalled();
    expect(d.timeline.setEnabled).toHaveBeenCalledWith(true);
  });

  it('passes the selected saved dataset symbol when auto-starting', async () => {
    const d = deps();
    await createReplayLoadService(d).loadAndPrepareReplay({
      datasetId: 'BTCUSDT__1M__60__120',
      autoStart: true,
    });

    expect(d.replayEngine.start).toHaveBeenCalledWith(0, 'BTCUSDT');
  });
});
