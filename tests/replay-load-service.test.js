import { describe, expect, it, vi } from 'vitest';
import { createReplayLoadService } from '../src/app/ReplayLoadService.js';

function createHarness() {
  let resolveLoad;
  const dataManager = {
    on: vi.fn(() => vi.fn()),
    load: vi.fn(() => new Promise((resolve) => { resolveLoad = resolve; })),
  };
  const appState = {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    loadingState: 'IDLE',
    transitionLoading: vi.fn((state) => { appState.loadingState = state; }),
    setLoading: vi.fn(),
    setRetryCount: vi.fn(),
    setCandles: vi.fn(),
    setReplayState: vi.fn(),
    setPendingStartIndex: vi.fn(),
  };
  const replayEngine = {
    getState: vi.fn(() => ({ state: 'STOPPED' })),
    load: vi.fn(),
    start: vi.fn(),
  };
  const candleStore = {
    get: vi.fn(() => ({ time: 1000, close: 101 })),
  };
  const timeline = {
    setTotal: vi.fn(),
    setPosition: vi.fn(),
    setEnabled: vi.fn(),
  };
  const controls = { setStartIndex: vi.fn() };
  const modeBanner = { update: vi.fn() };
  const statusView = {
    snapshot: vi.fn(() => Object.freeze({ total: 1, status: 'ready', loadingState: 'SUCCESS', pendingStartIndex: 0, currentIndex: 0, candleAt: () => null })),
  };
  const hasOpenPosition = vi.fn(() => false);
  const notifyMarketCandle = vi.fn();
  const updatePreviewWindow = vi.fn();

  return {
    dataManager,
    appState,
    replayEngine,
    candleStore,
    timeline,
    controls,
    modeBanner,
    statusView,
    hasOpenPosition,
    notifyMarketCandle,
    updatePreviewWindow,
    resolveLoad(candles = [{ time: 1000, open: 100, high: 102, low: 99, close: 101 }]) {
      resolveLoad({ candles, metadata: { cached: false } });
    },
  };
}

describe('ReplayLoadService', () => {
  it('rejects stale load completion after explicit invalidation', async () => {
    const h = createHarness();
    const service = createReplayLoadService(h);

    const pending = service.loadAndPrepareReplay({ targetSec: 1000 });
    await Promise.resolve();

    service.invalidateCurrentLoad();
    h.resolveLoad();
    await pending;

    expect(h.appState.setCandles).not.toHaveBeenCalled();
    expect(h.replayEngine.load).not.toHaveBeenCalled();
    expect(h.updatePreviewWindow).not.toHaveBeenCalled();
  });

  it('hydrates a current load and delegates preview setup', async () => {
    const h = createHarness();
    const service = createReplayLoadService(h);

    const pending = service.loadAndPrepareReplay({ targetSec: 1000 });
    await Promise.resolve();
    h.resolveLoad();
    await pending;

    expect(h.appState.setCandles).toHaveBeenCalledTimes(1);
    expect(h.replayEngine.load).toHaveBeenCalledTimes(1);
    expect(h.updatePreviewWindow).toHaveBeenCalledTimes(1);
    expect(h.notifyMarketCandle).toHaveBeenCalledTimes(1);
    expect(h.statusView.snapshot).toHaveBeenCalled();
    expect(h.modeBanner.update).toHaveBeenCalledWith(h.statusView.snapshot.mock.results.at(-1).value);
    expect(h.timeline.setEnabled).toHaveBeenCalledWith(true);
  });
});