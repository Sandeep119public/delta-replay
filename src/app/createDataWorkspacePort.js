import { DataEvents } from '../data/HistoricalDataManager.js';
import { CandleStore } from '../data/CandleStore.js';
import { CandleIntegrity } from '../data/CandleIntegrity.js';
import { DATA_WORKSPACE_EVENTS, assertDataWorkspacePort } from '../ports/DataWorkspacePort.js';

export function createDataWorkspacePort({ dataManager, candleStore, candleCache, appState, datasetRepository }) {
  if (!dataManager || !candleStore || !candleCache || !appState || !datasetRepository) {
    throw new TypeError('createDataWorkspacePort requires dataManager, candleStore, candleCache, appState, and datasetRepository');
  }

  let operationTail = Promise.resolve();
  const readyListeners = new Set();

  function enqueue(operation) {
    const next = operationTail.then(operation, operation);
    operationTail = next.catch(() => undefined);
    return next;
  }

  function emitReady(payload) {
    for (const listener of [...readyListeners]) {
      try { listener(payload); } catch (error) { console.warn('[DataWorkspace] ready listener failed', error); }
    }
  }

  const port = {
    snapshot() {
      const replayActive = appState.mode === 'replay';
      const metadata = replayActive ? (candleStore.getMetadata() || {}) : {};
      const symbol = replayActive
        ? (metadata.symbol || candleStore.getSymbol() || null)
        : (appState.symbol || null);
      const timeframe = replayActive
        ? (metadata.timeframe || candleStore.getTimeframe() || null)
        : (appState.timeframe || null);
      const coverage = replayActive && symbol && timeframe
        ? candleCache.getCoverage(symbol, timeframe, { timeframeSec: metadata.timeframeSec })
        : [];
      return Object.freeze({
        mode: appState.mode,
        symbol,
        timeframe,
        count: replayActive ? candleStore.getCount() : 0,
        metadata,
        coverage,
        cacheEnabled: candleCache.enableIDB,
        replayDatasetId: appState.replayDatasetId,
      });
    },

    async download(params) {
      return enqueue(async () => {
        const stagingStore = new CandleStore();
        const result = await dataManager.load({
          ...params,
          strict: true,
          halfOpen: true,
          store: stagingStore,
        });

        const savedDataset = await datasetRepository.save({
          symbol: params.symbol,
          timeframe: params.timeframe,
          from: result.metadata?.effectiveFrom ?? params.from,
          to: result.metadata?.effectiveTo ?? params.to,
          candles: result.candles,
          metadata: result.metadata || {},
        });

        const payload = { ...result, savedDataset };
        emitReady({
          candles: result.candles,
          metadata: result.metadata,
          quality: result.quality || 'VALID',
          dataset: savedDataset,
        });
        globalThis.window?.dispatchEvent?.(new CustomEvent('delta-replay-datasets-changed'));
        return payload;
      });
    },

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
        if (!candles.length) return { status: 'empty', message: 'No active replay dataset is loaded.' };

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
      if (event === DATA_WORKSPACE_EVENTS.READY || event === DATA_WORKSPACE_EVENTS.READY_DEGRADED) {
        readyListeners.add(handler);
        return () => readyListeners.delete(handler);
      }

      const mapping = new Map([
        [DATA_WORKSPACE_EVENTS.LOADING_STARTED, DataEvents.LOADING_STARTED],
        [DATA_WORKSPACE_EVENTS.PROGRESS, DataEvents.PROGRESS],
        [DATA_WORKSPACE_EVENTS.ERROR, DataEvents.ERROR],
      ]);
      const mapped = mapping.get(event);
      if (!mapped) throw new Error(`Unsupported data workspace event: ${event}`);
      return dataManager.on(mapped, handler);
    },

    listDatasets() {
      return datasetRepository.list();
    },

    deleteDataset(id) {
      return enqueue(async () => {
        await datasetRepository.remove(id);
        if (appState.replayDatasetId === id) appState.setReplayDatasetId(null);
        globalThis.window?.dispatchEvent?.(new CustomEvent('delta-replay-datasets-changed'));
      });
    },

    getDatasetCsv(id) {
      return datasetRepository.getCsv(id);
    },

    storageEstimate() {
      const estimate = globalThis.navigator?.storage?.estimate;
      return estimate ? estimate.call(globalThis.navigator.storage).catch(() => null) : Promise.resolve(null);
    },
  };

  return assertDataWorkspacePort(port);
}
