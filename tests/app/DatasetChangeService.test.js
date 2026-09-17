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
    hasTradingActivity: () => false,
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

  it('rejects dataset changes before mutation when trading history exists', async () => {
    const dependencies = deps({ hasTradingActivity: () => true });
    const service = createDatasetChangeService(dependencies);
    const select = { value: 'ETHUSDT' };

    await expect(service.handleSymbolTimeframeChange('symbol', 'ETHUSDT', select)).resolves.toBe(false);

    expect(dependencies.appState.symbol).toBe('BTCUSDT');
    expect(select.value).toBe('BTCUSDT');
    expect(dependencies.clearPendingOrders).not.toHaveBeenCalled();
    expect(dependencies.invalidateLoad).not.toHaveBeenCalled();
    expect(dependencies.candleStore.clear).not.toHaveBeenCalled();
    expect(dependencies.reload).not.toHaveBeenCalled();
    expect(dependencies.reportError).toHaveBeenCalledWith('Cannot change symbol after trading activity. Reset the simulation first.');
  });

  it('rolls back the selector when pending-order cleanup fails', async () => {
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

  it('serializes overlapping dataset changes and keeps the second selector consistent', async () => {
    let releaseCleanup;
    const cleanupStarted = new Promise((resolve) => { releaseCleanup = resolve; });
    const dependencies = deps({
      clearPendingOrders: vi.fn(() => cleanupStarted),
    });
    const service = createDatasetChangeService(dependencies);
    const firstSelect = { value: 'BTCUSDT' };
    const secondSelect = { value: 'BTCUSDT' };

    const first = service.handleSymbolTimeframeChange('symbol', 'ETHUSDT', firstSelect);
    await Promise.resolve();
    const second = await service.handleSymbolTimeframeChange('symbol', 'SOLUSDT', secondSelect);

    expect(second).toBe(false);
    expect(secondSelect.value).toBe('BTCUSDT');
    expect(dependencies.appState.symbol).toBe('BTCUSDT');
    expect(dependencies.reload).not.toHaveBeenCalled();

    releaseCleanup({ success: true });
    await expect(first).resolves.toBe('reloaded');
    expect(dependencies.appState.symbol).toBe('ETHUSDT');
    expect(firstSelect.value).toBe('BTCUSDT');
  });

  it('does not reload when the selected dataset is unchanged', async () => {
    const dependencies = deps();
    const service = createDatasetChangeService(dependencies);
    const select = { value: 'BTCUSDT' };

    await expect(service.handleSymbolTimeframeChange('symbol', 'BTCUSDT', select)).resolves.toBe(true);

    expect(dependencies.clearPendingOrders).not.toHaveBeenCalled();
    expect(dependencies.invalidateLoad).not.toHaveBeenCalled();
    expect(dependencies.reload).not.toHaveBeenCalled();
  });
});
