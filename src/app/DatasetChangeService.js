import { LoadingState } from '../data/DataError.js';

/**
 * DatasetChangeService owns symbol/timeframe switching: state validation,
 * load-session invalidation, and reload triggering. Dataset changes are a
 * transaction boundary: if the current simulation has trading history, the
 * change is rejected before any UI/store state is mutated.
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

  let busy = false;

  return Object.freeze({
    async handleSymbolTimeframeChange(kind, newValue, selectElement) {
      if (busy) {
        if (selectElement) selectElement.value = kind === 'symbol' ? appState.symbol : appState.timeframe;
        return false;
      }
      if (kind !== 'symbol' && kind !== 'timeframe') {
        reportError('Unsupported dataset change: ' + kind);
        return false;
      }

      if (hasOpenPosition()) {
        const msg = 'Cannot change ' + kind + ' while a position is open. Close the position first.';
        reportError(msg);
        if (selectElement) selectElement.value = kind === 'symbol' ? appState.symbol : appState.timeframe;
        return false;
      }

      if (hasTradingActivity?.()) {
        const msg = 'Cannot change ' + kind + ' after trading activity. Reset the simulation first.';
        reportError(msg);
        if (selectElement) selectElement.value = kind === 'symbol' ? appState.symbol : appState.timeframe;
        return false;
      }

      const previousValue = kind === 'symbol' ? appState.symbol : appState.timeframe;
      const nextValue = String(newValue ?? '').trim();
      if (!nextValue) {
        reportError(kind + ' must be provided.');
        if (selectElement) selectElement.value = previousValue;
        return false;
      }
      if (nextValue === previousValue) return true;

      busy = true;
      try {
        if (typeof clearPendingOrders === 'function') {
          try {
            const result = await clearPendingOrders(kind === 'symbol' ? 'SYMBOL_CHANGE' : 'TIMEFRAME_CHANGE');
            if (result?.success === false) throw new Error(result.message || 'Unable to clear pending orders');
          } catch (error) {
            if (selectElement) selectElement.value = previousValue;
            reportError(error?.message || 'Unable to clear pending orders. Dataset change cancelled.');
            return false;
          }
        }

        if (kind === 'symbol') appState.symbol = nextValue;
        else appState.timeframe = nextValue;

        invalidateLoad();
        try { replayEngine.pause?.(); } catch (error) { console.warn('[DatasetChange] pause during dataset change failed', error); }
        candleStore.clear();

        timeline?.setTotal(0, []);
        chartManager?.clear();
        chartManager?.setRevealedMax(null);
        chartManager?.setAutoFollow(true);
        appState.setPendingStartIndex(0);
        controls?.setStartIndex(0);
        appState.transitionLoading(LoadingState.IDLE);

        try {
          return await reload();
        } catch (error) {
          reportError(error?.message || 'Unable to load ' + kind + ' dataset.');
          return false;
        }
      } finally {
        busy = false;
      }
    },
  });
}
