import { describe, expect, it, vi } from 'vitest';
import { createDatasetChangeService } from '../../src/app/DatasetChangeService.js';
import { LoadingState } from '../../src/data/DataError.js';

function deps(overrides = {}) {
  const appState = {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    setCandles: vi.fn(),
    setPendingStartIndex: vi.fn(),
    transitionLoading: vi.fn(),
  };
  return {
    hasOpenPosition: () => false,
    clearPendingOrders: vi.fn(async () => ({ success: true })),
    appState,
    candleStore: { clear: vi.fn() },
    replayEngine: { stop: vi.fn() },
    chartManager: { clear: vi.fn(), setRevealedMax: vi.fn(), setAutoFollow: vi.fn() },
    timeline: { setTotal: vi.fn() },
    controls: { setStartIndex: vi.fn() },
    startReplayBtn: { disabled: false },
    headerStartReplayBtn: { disabled: false },
    reportError: vi.fn(),
    invalidateLoad: vi.fn(),
    reload: vi.fn(async () => 'reloaded'),
    ...overrides,
  };
}

describe('DatasetChangeService', () => {
  it('clears pending orders before resetting and reloading the dataset', async () => {
    const dependencies = deps();
    const service = createDatasetChangeService(dependencies);
    const select = { value: 'BTCUSDT' };

    await expect(service.handleSymbolTimeframeChange('symbol', 'ETHUSDT', select)).resolves.toBe('reloaded');

    expect(dependencies.clearPendingOrders).toHaveBeenCalledWith('SYMBOL_CHANGE');
    expect(dependencies.invalidateLoad).toHaveBeenCalled();
    expect(dependencies.candleStore.clear).toHaveBeenCalled();
    expect(dependencies.reload).toHaveBeenCalled();
    expect(dependencies.appState.symbol).toBe('ETHUSDT');
    expect(dependencies.appState.transitionLoading).toHaveBeenCalledWith(LoadingState.IDLE);
  });

  it('rolls back the selector and app state when pending-order cleanup fails', async () => {
    const dependencies = deps({ clearPendingOrders: vi.fn(async () => ({ success: false, message: 'cleanup failed' })) });
    const service = createDatasetChangeService(dependencies);
    const select = { value: 'BTCUSDT' };

    await expect(service.handleSymbolTimeframeChange('symbol', 'ETHUSDT', select)).resolves.toBe(false);

    expect(dependencies.appState.symbol).toBe('BTCUSDT');
    expect(select.value).toBe('BTCUSDT');
    expect(dependencies.invalidateLoad).not.toHaveBeenCalled();
    expect(dependencies.reload).not.toHaveBeenCalled();
    expect(dependencies.reportError).toHaveBeenCalledWith('cleanup failed');
  });
});
