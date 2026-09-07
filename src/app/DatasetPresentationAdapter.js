function freezeValue(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
  const copy = {};
  for (const [key, child] of Object.entries(value)) copy[key] = freezeValue(child);
  return Object.freeze(copy);
}

/**
 * Application-owned adapters that project AppState/CandleStore/ReplayEngine
 * into immutable presentation snapshots. The UI receives frozen copies, never
 * live references to stores — reading a view cannot observe later mutation.
 */
export function createDatasetView(appState) {
  if (!appState || typeof appState !== 'object') {
    throw new TypeError('createDatasetView requires appState');
  }
  return Object.freeze({
    snapshot() {
      return Object.freeze({ symbol: appState.symbol, timeframe: appState.timeframe });
    },
  });
}

export function createCandleView(candleStore) {
  if (!candleStore || typeof candleStore.getCount !== 'function') {
    throw new TypeError('createCandleView requires a CandleStore-compatible object');
  }
  return Object.freeze({
    getCount: () => candleStore.getCount(),
    get: (index) => freezeValue(candleStore.get(index)),
    getAll: () => freezeValue(candleStore.getAll()),
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
        candleAt: (index) => freezeValue(candleStore.get?.(index) ?? null),
      });
    },
  });
}
