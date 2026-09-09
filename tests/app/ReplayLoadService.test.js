import { describe, expect, it, vi } from 'vitest';
import { createReplayLoadService } from '../../src/app/ReplayLoadService.js';

function deps(load) {
  return {
    dataManager: { on: vi.fn(() => vi.fn()), load },
    candleStore: { get: vi.fn((index) => ({ openTime: index + 1 })) },
    appState: {
      symbol: 'BTCUSDT', timeframe: '1m', loadingState: 'idle',
      transitionLoading: vi.fn(), setLoading: vi.fn(), setRetryCount: vi.fn(),
      setCandles: vi.fn(), setReplayState: vi.fn(), setPendingStartIndex: vi.fn(),
    },
    replayEngine: { load: vi.fn(), getState: vi.fn(() => ({})), start: vi.fn() },
    hasOpenPosition: () => false,
    notifyMarketCandle: vi.fn(),
    statusView: { snapshot: vi.fn(() => ({})) },
    timeline: { setTotal: vi.fn(), setPosition: vi.fn(), setEnabled: vi.fn() },
    controls: { setStartIndex: vi.fn() },
    modeBanner: { update: vi.fn() },
    errorPanel: { hide: vi.fn(), show: vi.fn() },
    updatePreviewWindow: vi.fn(),
  };
}

describe('ReplayLoadService', () => {
  it('does not let a stale load remove the current progress subscription', async () => {
    let resolveFirst;
    let resolveSecond;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const second = new Promise((resolve) => { resolveSecond = resolve; });
    const unsubFirst = vi.fn();
    const unsubSecond = vi.fn();
    let subscriptions = 0;
    const load = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const d = deps(load);
    d.dataManager.on = vi.fn(() => (++subscriptions === 1 ? unsubFirst : unsubSecond));
    const service = createReplayLoadService(d);

    const firstRun = service.loadAndPrepareReplay({ targetSec: 1 });
    const secondRun = service.loadAndPrepareReplay({ targetSec: 2 });

    resolveFirst({ candles: [{ openTime: 1 }], metadata: {} });
    await firstRun;
    expect(unsubFirst).toHaveBeenCalledOnce();
    expect(unsubSecond).not.toHaveBeenCalled();

    resolveSecond({ candles: [{ openTime: 2 }], metadata: {} });
    await secondRun;
    expect(unsubSecond).toHaveBeenCalledOnce();
  });

  it('resets the retry budget when a new load session starts', async () => {
    vi.useFakeTimers();
    try {
      const firstFailure = Object.assign(new Error('temporary network failure'), { category: 'NETWORK' });
      const firstSuccess = { candles: [{ openTime: 1 }], metadata: {} };
      const load = vi.fn()
        .mockRejectedValueOnce(firstFailure)
        .mockRejectedValueOnce(firstFailure)
        .mockResolvedValueOnce(firstSuccess)
        .mockRejectedValueOnce(firstFailure);
      const d = deps(load);
      const service = createReplayLoadService(d);

      const firstRun = service.loadAndPrepareReplay({ targetSec: 1 });
      await vi.runOnlyPendingTimersAsync();
      await vi.runOnlyPendingTimersAsync();
      await vi.runOnlyPendingTimersAsync();
      await firstRun;
      expect(load).toHaveBeenCalledTimes(3);

      const secondRun = service.loadAndPrepareReplay({ targetSec: 2 });
      await secondRun;
      expect(service.retryCount).toBe(1);
      expect(load).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
