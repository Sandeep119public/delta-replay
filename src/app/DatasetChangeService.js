import { LoadingState } from '../data/DataError.js';

/**
 * DatasetChangeService owns symbol/timeframe switching: position guard,
 * state reset, and reload triggering. Trading access is expressed through
 * narrow capabilities rather than a raw trading engine dependency.
 *
 * Load-session invalidation and reload stay with the caller, injected here
 * as `invalidateLoad` and `reload`.
 */
export function createDatasetChangeService({
  hasOpenPosition,
  clearPendingOrders = null,
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
  if (!appState || !candleStore || !replayEngine) throw new TypeError('createDatasetChangeService requires appState, candleStore, and replayEngine');
  if (typeof hasOpenPosition !== 'function') throw new TypeError('createDatasetChangeService requires hasOpenPosition() capability');
  if (typeof reportError !== 'function' || typeof invalidateLoad !== 'function' || typeof reload !== 'function') {
    throw new TypeError('createDatasetChangeService requires reportError, invalidateLoad, and reload callbacks');
  }

  return Object.freeze({
    async handleSymbolTimeframeChange(kind, newValue, selectElement) {
      if (hasOpenPosition()) {
        const msg = `Cannot change ${kind} while a position is open — close position first.`;
        reportError(msg);
        if (selectElement) selectElement.value = kind === 'symbol' ? appState.symbol : appState.timeframe;
        return false;
      }
      if (kind === 'symbol') appState.symbol = newValue;
      else appState.timeframe = newValue;

      if (typeof clearPendingOrders === 'function') {
        try {
          const result = await clearPendingOrders(kind === 'symbol' ? 'SYMBOL_CHANGE' : 'TIMEFRAME_CHANGE');
          if (result?.success === false) throw new Error(result.message || 'Unable to clear pending orders');
        } catch (error) {
          reportError(error?.message || 'Unable to clear pending orders. Dataset change cancelled.');
          if (selectElement) selectElement.value = kind === 'symbol' ? appState.symbol : appState.timeframe;
          return false;
        }
      }

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
  });
}
