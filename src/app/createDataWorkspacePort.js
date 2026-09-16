import { DataEvents } from '../data/HistoricalDataManager.js';
import { CandleIntegrity } from '../data/CandleIntegrity.js';
import { DATA_WORKSPACE_EVENTS, assertDataWorkspacePort } from '../ports/DataWorkspacePort.js';

const EVENT_MAP = new Map([
  [DATA_WORKSPACE_EVENTS.LOADING_STARTED, DataEvents.LOADING_STARTED],
  [DATA_WORKSPACE_EVENTS.PROGRESS, DataEvents.PROGRESS],
  [DATA_WORKSPACE_EVENTS.READY, DataEvents.READY],
  [DATA_WORKSPACE_EVENTS.READY_DEGRADED, DataEvents.READY_DEGRADED],
  [DATA_WORKSPACE_EVENTS.ERROR, DataEvents.ERROR],
]);

export function createDataWorkspacePort({ dataManager, candleStore, candleCache, appState }) {
  const port = {
    snapshot() {
      const metadata = candleStore.getMetadata() || {};
      const symbol = candleStore.getSymbol() || appState.symbol || null;
      const timeframe = candleStore.getTimeframe() || appState.timeframe || null;
      const coverage = symbol && timeframe ? candleCache.getCoverage(symbol, timeframe, { timeframeSec: metadata.timeframeSec }) : [];
      return Object.freeze({ symbol, timeframe, count: candleStore.getCount(), metadata, coverage, cacheEnabled: candleCache.enableIDB });
    },
    download(params) { return dataManager.load({ ...params, strict: true }); },
    async clearCurrent() {
      const symbol = candleStore.getSymbol() || appState.symbol;
      const timeframe = candleStore.getTimeframe() || appState.timeframe;
      if (symbol && timeframe) candleCache.invalidate(symbol, timeframe);
      candleStore.clear();
    },
    validateCurrent() {
      const candles = candleStore.getAll();
      const metadata = candleStore.getMetadata() || {};
      if (!candles.length) return Promise.resolve({ status: 'empty', message: 'No dataset is currently loaded.' });
      const result = CandleIntegrity.process(candles, { timeframeSec: metadata.timeframeSec, from: metadata.effectiveFrom, to: metadata.effectiveTo, policy: 'REPAIR', timestampUnit: 'seconds' });
      return Promise.resolve({ status: result.metadata.invalidCount === 0 && result.metadata.gaps.length === 0 ? 'valid' : 'issues', metadata: result.metadata });
    },
    on(event, handler) {
      const mapped = EVENT_MAP.get(event);
      if (!mapped) throw new Error(`Unsupported data workspace event: ${event}`);
      return dataManager.on(mapped, handler);
    },
    storageEstimate() {
      const estimate = globalThis.navigator?.storage?.estimate;
      return estimate ? estimate.call(globalThis.navigator.storage).catch(() => null) : Promise.resolve(null);
    },
  };
  return assertDataWorkspacePort(port);
}
