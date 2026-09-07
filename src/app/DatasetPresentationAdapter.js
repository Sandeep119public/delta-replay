/**
 * Application-owned adapters that project AppState/CandleStore/ReplayEngine
 * into frozen presentation view models. The UI receives these values instead
 * of store or coordinator references.
 */
export function createDatasetView(appState) {
  if (!appState || typeof appState !== 'object') {
    throw new TypeError('createDatasetView requires appState');
  }
  return Object.freeze({
    get symbol() { return appState.symbol; },
    get timeframe() { return appState.timeframe; },
  });
}

export function createCandleView(candleStore) {
  if (!candleStore || typeof candleStore.getCount !== 'function') {
    throw new TypeError('createCandleView requires a CandleStore-compatible object');
  }
  return Object.freeze({
    getCount: () => candleStore.getCount(),
    get: (index) => candleStore.get(index),
    getAll: () => candleStore.getAll(),
    findIndexByTime: (targetSec) => candleStore.findIndexByTime(targetSec),
  });
}

export function createReplayStatusView({ engine, appState, candleStore }) {
  if (!engine || !appState || !candleStore) {
    throw new TypeError('createReplayStatusView requires engine, appState, and candleStore');
  }
  return Object.freeze({
    snapshot() {
      const replayState = engine.getState?.() || { status: 'idle', currentIndex: -1 };
      return Object.freeze({
        total: candleStore.getCount?.() || 0,
        status: replayState.status || 'idle',
        loadingState: appState.loadingState,
        pendingStartIndex: appState.pendingStartIndex ?? 0,
        currentIndex: replayState.currentIndex ?? -1,
        candleAt: (index) => candleStore.get?.(index) ?? null,
      });
    },
  });
}
