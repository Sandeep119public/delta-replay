import { LoadingState } from '../data/DataError.js';

/**
 * DatasetChangeService owns symbol/timeframe switching: state validation,
 * load-session invalidation, and reload triggering. Dataset changes are a
 * transaction boundary: if the current simulation has trading history, the
 * change is rejected before any UI/store state is mutated. This prevents an
 * unsuccessful reload from destroying the user's current replay workspace.
 */
export function createDatasetChangeService({
  hasOpenPosition,
  hasTradingActivity = null,
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
  if (hasTradingActivity !== null && typeof hasTradingActivity !== 'function') throw new TypeError('createDatasetChangeService hasTradingActivity must be a function');
  if (typeof reportError !== 'function' || typeof invalidateLoad !== 'function' || typeof reload !== 'function') {
    throw new TypeError('createDatasetChangeService requires reportError, invalidateLoad, and reload callbacks');
  }

  return Object.freeze({
    async handleSymbolTimeframeChange(kind, newValue, selectElement) {
      if (kind !== 'symbol' && kind !== 'timeframe') {
        reportError(`Unsupported dataset change: ${kind}`);
        return false;
      }

      if (hasOpenPosition()) {
        const msg = `Cannot change ${kind} while a position is open — close position first.`;
        reportError(msg);
        if (selectElement) selectElement.value = kind === 'symbol' ? appState.symbol : appState.timeframe;
        return false;
      }

      // A completed trade is part of the current simulation's history. Do not
      // mutate the selected dataset and then discover that the backend refuses
      // to load it. The user must explicitly reset before changing datasets.
      if (hasTradingActivity?.()) {
        const msg = `Cannot change ${kind} after trading activity. Reset the simulation first.`;
        reportError(msg);
        if (selectElement) selectElement.value = kind === 'symbol' ? appState.symbol : appState.timeframe;
        return false;
      }

      const previousValue = kind === 'symbol' ? appState.symbol : appState.timeframe;
      const nextValue = String(newValue ?? '').trim();
      if (!nextValue) {
        reportError(`${kind} must be provided.`);
        if (selectElement) selectElement.value = previousValue;
        return false;
      }

      if (kind === 'symbol') appState.symbol = nextValue;
      else appState.timeframe = nextValue;

      if (typeof clearPendingOrders === 'function') {
        try {
          const result = await clearPendingOrders(kind === 'symbol' ? 'SYMBOL_CHANGE' : 'TIMEFRAME_CHANGE');
          if (result?.success === false) throw new Error(result.message || 'Unable to clear pending orders');
        } catch (error) {
          if (kind === 'symbol') appState.symbol = previousValue;
          else appState.timeframe = previousValue;
          if (selectElement) selectElement.value = previousValue;
          reportError(error?.message || 'Unable to clear pending orders. Dataset change cancelled.');
          return false;
        }
      }

      // From this point the current dataset is intentionally being replaced.
      // Invalidate in-flight work before clearing presentation state so stale
      // responses cannot repopulate the old dataset.
      invalidateLoad();
      try { replayEngine.stop?.(); } catch (error) { console.warn('[DatasetChange] stop during dataset change failed', error); }
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
