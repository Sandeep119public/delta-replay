import { CandleStore } from '../data/CandleStore.js';
import { CandleIntegrity } from '../data/CandleIntegrity.js';
import { DATA_WORKSPACE_EVENTS, assertDataWorkspacePort } from '../ports/DataWorkspacePort.js';

export function createDataWorkspacePort({ replayDataManager, datasetService, candleStore, candleCache, appState }) {
  if (!replayDataManager || !datasetService || !candleStore || !candleCache || !appState) {
    throw new TypeError('createDataWorkspacePort requires replayDataManager, datasetService, candleStore, candleCache, and appState');
  }

  let operationTail = Promise.resolve();
  let catalog = [];

  function enqueue(operation) {
    const next = operationTail.then(operation, operation);
    operationTail = next.catch(() => undefined);
    return next;
  }

  async function refreshCatalog() {
    const result = await datasetService.list({
      symbol: appState.symbol,
      timeframe: appState.timeframe,
    });
    catalog = Array.isArray(result?.datasets) ? result.datasets : [];
    return catalog;
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
        datasets: catalog.map((item) => ({ ...item })),
        cacheEnabled: candleCache.enableIDB,
      });
    },

    /**
     * Acquisition is deliberately separate from replay.
     * This writes an immutable Parquet file through the dataset downloader.
     * It never populates the replay engine or the active candle store.
     */
    download(params) {
      return enqueue(async () => {
        const result = await datasetService.download(params);
        await refreshCatalog();
        return result;
      });
    },

    listDatasets() {
      return enqueue(() => refreshCatalog());
    },

    /**
     * This only clears the browser acceleration cache.
     * Canonical Parquet datasets remain on disk.
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
          return { status: 'empty', message: 'No replay dataset is currently loaded.' };
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
      if (!replayDataManager.on) throw new Error('Replay data manager does not expose events');
      const eventMap = new Map([
        [DATA_WORKSPACE_EVENTS.LOADING_STARTED, 'dataLoadingStarted'],
        [DATA_WORKSPACE_EVENTS.PROGRESS, 'dataProgress'],
        [DATA_WORKSPACE_EVENTS.READY, 'dataReady'],
        [DATA_WORKSPACE_EVENTS.READY_DEGRADED, 'dataReadyDegraded'],
        [DATA_WORKSPACE_EVENTS.ERROR, 'dataError'],
      ]);
      const mapped = eventMap.get(event);
      if (!mapped) throw new Error(`Unsupported data workspace event: ${event}`);
      return replayDataManager.on(mapped, handler);
    },

    storageEstimate() {
      const estimate = globalThis.navigator?.storage?.estimate;
      return estimate ? estimate.call(globalThis.navigator.storage).catch(() => null) : Promise.resolve(null);
    },
  };

  void refreshCatalog().catch(() => {});
  return assertDataWorkspacePort(port);
}
