function freezeValue(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
  const copy = {};
  for (const [key, child] of Object.entries(value)) copy[key] = freezeValue(child);
  return Object.freeze(copy);
}

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
    findIndexByTime: (targetSec) => candleStore.findNearestIndexByTime(targetSec),
  });
}

export function createReplayStatusView({ replayPort, appState }) {
  if (!replayPort || !appState) {
    throw new TypeError('createReplayStatusView requires replayPort and appState');
  }
  return Object.freeze({
    snapshot() {
      const replayState = replayPort.getState?.() || { status: 'idle', currentIndex: -1 };
      return Object.freeze({
        total: replayPort.getTotalCandles?.() || 0,
        status: replayState.status || 'idle',
        loadingState: appState.loadingState,
        pendingStartIndex: appState.pendingStartIndex ?? 0,
        currentIndex: replayState.currentIndex ?? -1,
        candleAt: (index) => freezeValue(replayPort.getCandle?.(index) ?? null),
      });
    },
  });
}
