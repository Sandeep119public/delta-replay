/**
 * Neutral presentation contracts for dataset selection (symbol/timeframe),
 * candle-window reads, and replay status display.
 *
 * The UI receives these frozen view models / capability functions instead of
 * AppState, CandleStore, or ReplayCoordinator references.
 */

export const DEFAULT_SYMBOLS = Object.freeze([
  'BTCUSDT', 'BTCUSD', 'ETHUSDT', 'ETHUSD', 'SOLUSDT', 'XRPUSDT',
]);

// Presentation copy of the supported resolutions. Mirrors the data-layer
// TIMEFRAME_SECONDS keys (minus weekly); the UI must not import the
// data layer to read them.
export const DEFAULT_TIMEFRAMES = Object.freeze(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '1d']);

export function assertDatasetView(dataset) {
  if (!dataset || typeof dataset !== 'object') {
    throw new TypeError('dataset view model requires an object');
  }
  if (typeof dataset.symbol !== 'string' || typeof dataset.timeframe !== 'string') {
    throw new TypeError('dataset view model requires string symbol and timeframe');
  }
  return dataset;
}

export function assertCandleView(candles) {
  if (!candles || typeof candles !== 'object') {
    throw new TypeError('candle view requires an object');
  }
  for (const name of ['getCount', 'get', 'getAll', 'findIndexByTime']) {
    if (typeof candles[name] !== 'function') {
      throw new TypeError(`candle view requires ${name}()`);
    }
  }
  return candles;
}

export function assertReplayStatusView(status) {
  if (!status || typeof status !== 'object') {
    throw new TypeError('replay status view requires an object');
  }
  for (const name of ['total', 'status', 'loadingState', 'pendingStartIndex', 'currentIndex']) {
    if (!(name in status)) {
      throw new TypeError(`replay status view is missing key: ${name}`);
    }
  }
  if (typeof status.candleAt !== 'function') {
    throw new TypeError('replay status view requires candleAt(index)');
  }
  return status;
}
