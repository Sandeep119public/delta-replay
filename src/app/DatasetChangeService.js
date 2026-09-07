import { LoadingState } from '../data/DataError.js';

/**
 * DatasetChangeService owns symbol/timeframe switching: position guard,
 * state reset, and reload triggering. Extracted from ReplayCoordinator so
 * dataset lifecycle is a capability service with explicit dependencies.
 *
 * Load-session invalidation and the reload itself stay with the caller
 * (the coordinator), injected here as `invalidateLoad` and `reload`.
 */
export function createDatasetChangeService({
  tradingEngine = null,
  appState,
  candleStore,
  replayEngine,
  chartManager = null,
  timeline = null,
  controls = null,
  startReplayBtn = null,
  headerStartReplayBtn = null,
  reportError,
  invalidateLoad,
  reload,
}) {
  if (!appState || !candleStore || !replayEngine) {
    throw new TypeError('createDatasetChangeService requires appState, candleStore, and replayEngine');
  }
  if (typeof reportError !== 'function' || typeof invalidateLoad !== 'function' || typeof reload !== 'function') {
    throw new TypeError('createDatasetChangeService requires reportError, invalidateLoad, and reload callbacks');
  }

  return {
    handleSymbolTimeframeChange(kind, newValue, selectElement) {
      if (tradingEngine && tradingEngine.hasOpenPosition()) {
        const msg = `Cannot change ${kind} while a position is open — close position first.`;
        reportError(msg);
        if (selectElement) selectElement.value = kind === 'symbol' ? appState.symbol : appState.timeframe;
        return false;
      }
      if (kind === 'symbol') appState.symbol = newValue;
      else appState.timeframe = newValue;
      try { tradingEngine?.clearPendingOrders(kind === 'symbol' ? 'SYMBOL_CHANGE' : 'TIMEFRAME_CHANGE'); } catch (error) { console.warn('[DatasetChange] clear pending orders failed', error); }
      invalidateLoad();
      try { replayEngine.stop(); } catch (error) { console.warn('[DatasetChange] stop during dataset change failed', error); }
      candleStore.clear();
      appState.setCandles([]);
      timeline?.setTotal(0, []);
      chartManager?.clear();
      chartManager?.setRevealedMax(null);
      chartManager?.setAutoFollow(true);
      appState.setPendingStartIndex(0);
      controls?.setStartIndex(0);
      if (startReplayBtn) startReplayBtn.disabled = true;
      if (headerStartReplayBtn) headerStartReplayBtn.disabled = false;
      appState.transitionLoading(LoadingState.IDLE);
      return reload();
    },
  };
}
