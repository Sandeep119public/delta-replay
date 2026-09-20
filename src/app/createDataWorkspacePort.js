import { DataEvents } from '../data/HistoricalDataManager.js';
import { CandleStore } from '../data/CandleStore.js';
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
  if (!dataManager || !candleStore || !candleCache || !appState) {
    throw new TypeError('createDataWorkspacePort requires dataManager, candleStore, candleCache, and appState');
  }

  let operationTail = Promise.resolve();

  function enqueue(operation) {
    const next = operationTail.then(operation, operation);
    operationTail = next.catch(() => undefined);
    return next;
  }

  const port = {
    snapshot() {
      const metadata = candleStore.getMetadata() || {};
      const symbol = candleStore.getSymbol() || appState.symbol || null;
      const timeframe = candleStore.getTimeframe() || appState.timeframe || null;
      const coverage = symbol && timeframe
        ? candleCache.getCoverage(symbol, timeframe, { timeframeSec: metadata.timeframeSec })
        : [];
      return Object.freeze({
        symbol,
        timeframe,
        count: candleStore.getCount(),
        metadata,
        coverage,
        cacheEnabled: candleCache.enableIDB,
      });
    },

    /**
     * The Data Center is an acquisition/cache surface, not an alternate
     * replay publisher. Stage the result in a private store so an in-flight
     * download can never replace the active replay dataset.
     */
    download(params) {
      return enqueue(() => {
        const stagingStore = new CandleStore();
        return dataManager.load({
          ...params,
          strict: true,
          store: stagingStore,
        });
      });
    },

    /**
     * Clearing Data Center coverage must not invalidate the active replay
     * workspace. Replay owns the canonical CandleStore; the Data Center only
     * owns persisted cache coverage.
     */
    clearCurrent() {
      return enqueue(async () => {
        const symbol = candleStore.getSymbol() || appState.symbol;
        const timeframe = candleStore.getTimeframe() || appState.timeframe;
        if (symbol && timeframe) {
          candleCache.invalidate(symbol, timeframe);
          await candleCache.persist();
        }
        return port.snapshot();
      });
    },

    validateCurrent() {
      return enqueue(() => {
        const candles = candleStore.getAll();
        const metadata = candleStore.getMetadata() || {};
        if (!candles.length) {
          return { status: 'empty', message: 'No dataset is currently loaded.' };
        }
        const result = CandleIntegrity.process(candles, {
          timeframeSec: metadata.timeframeSec,
          from: metadata.effectiveFrom,
          to: metadata.effectiveTo,
          policy: 'REPAIR',
          timestampUnit: 'seconds',
        });
        return {
          status: result.metadata.invalidCount === 0 && result.metadata.gaps.length === 0 ? 'valid' : 'issues',
          metadata: result.metadata,
        };
      });
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
