import { CandleIntegrity } from '../data/CandleIntegrity.js';
import { DATA_WORKSPACE_EVENTS, assertDataWorkspacePort } from '../ports/DataWorkspacePort.js';

export function createDataWorkspacePort({ candleStore, candleCache, appState, datasetRepository, localDatasetRepository }) {
  if (!candleStore || !candleCache || !appState || !datasetRepository || !localDatasetRepository) {
    throw new TypeError('createDataWorkspacePort requires candleStore, candleCache, appState, datasetRepository, and localDatasetRepository');
  }

  let operationTail = Promise.resolve();
  const readyListeners = new Set();
  const loadingListeners = new Set();
  const progressListeners = new Set();
  const errorListeners = new Set();
  const localDatasetListeners = new Set();

  function enqueue(operation) {
    const next = operationTail.then(operation, operation);
    operationTail = next.catch(() => undefined);
    return next;
  }

  function emit(eventSet, payload) {
    for (const listener of [...eventSet]) {
      try { listener(payload); } catch (error) { console.warn('[DataWorkspace] listener failed', error); }
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
        replayDatasetSource: appState.replayDatasetSource,
      });
    },

    async cancelDownload(jobId) {
      if (typeof datasetRepository.cancelDownload !== 'function') throw new Error('Dataset cancellation is unavailable');
      return datasetRepository.cancelDownload(jobId);
    },

    async download(params) {
      return enqueue(async () => {
        emit(loadingListeners, { symbol: params.symbol, timeframe: params.timeframe });
        const emitProgress = (state) => {
          globalThis.window?.dispatchEvent?.(new CustomEvent('delta-replay-dataset-download-progress', { detail: state }));
        };
        try {
          const dataset = await datasetRepository.download({
            symbol: params.symbol,
            timeframe: params.timeframe,
            from: params.from,
            to: params.to,
            onProgress: (state) => {
              const progress = {
                status: state.status,
                jobId: state.jobId,
                loaded: Number(state.loaded || 0),
                total: Number(state.total || 0),
                pct: Number(state.pct || 0),
              };
              emitProgress(progress);
              emit(progressListeners, progress);
              globalThis.window?.dispatchEvent?.(new CustomEvent('delta-replay-data-progress', { detail: progress }));
            },
          });
          const metadata = { ...dataset, quality: 'VALID', source: 'binance', persisted: true };
          emit(readyListeners, { candles: [], metadata, quality: 'VALID', dataset });
          globalThis.window?.dispatchEvent?.(new CustomEvent('delta-replay-datasets-changed'));
          return { candles: [], metadata, quality: 'VALID', savedDataset: dataset };
        } catch (error) {
          emit(errorListeners, error);
          globalThis.window?.dispatchEvent?.(new CustomEvent('delta-replay-data-error', { detail: error }));
          throw error;
        }
      });
    },

    async importLocalDataset(file) {
      return enqueue(async () => {
        emit(loadingListeners, { source: 'local-file', name: file?.name || 'local dataset' });
        try {
          const metadata = await localDatasetRepository.importFile(file);
          emit(localDatasetListeners, metadata);
          globalThis.window?.dispatchEvent?.(new CustomEvent('delta-replay-local-datasets-changed', { detail: metadata }));
          globalThis.window?.dispatchEvent?.(new CustomEvent('select-replay-dataset', {
            detail: { datasetId: metadata.id, source: 'local' },
          }));
          return metadata;
        } catch (error) {
          emit(errorListeners, error);
          globalThis.window?.dispatchEvent?.(new CustomEvent('delta-replay-data-error', { detail: error }));
          throw error;
        }
      });
    },

    async clearLocalDataset(id) {
      return enqueue(async () => {
        await localDatasetRepository.remove(id);
        if (appState.replayDatasetId === id && appState.replayDatasetSource === 'local') {
          appState.setReplayDatasetId(null);
        }
        globalThis.window?.dispatchEvent?.(new CustomEvent('delta-replay-local-datasets-changed'));
      });
    },

    async getLocalDataset(id) {
      return localDatasetRepository.get(id);
    },

    snapshotLocalDatasets() {
      return localDatasetRepository.list();
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
      return enqueue(async () => {
        let candles = candleStore.getAll();
        let metadata = candleStore.getMetadata() || {};

        if (appState.mode === 'replay' && appState.replayDatasetId) {
          if (appState.replayDatasetSource === 'local') {
            const record = await localDatasetRepository.get(appState.replayDatasetId);
            if (!record?.metadata || !Array.isArray(record.candles)) {
              return { status: 'empty', message: 'The active browser-local replay dataset is no longer available.' };
            }
            candles = record.candles;
            metadata = record.metadata;
          } else if (typeof datasetRepository.getCandles === 'function') {
            const record = await datasetRepository.getCandles(appState.replayDatasetId);
            if (!record?.metadata || !Array.isArray(record.candles)) {
              return { status: 'empty', message: 'The active GitHub replay dataset is no longer available.' };
            }
            candles = record.candles;
            metadata = record.metadata;
          }
        }

        if (!candles.length) return { status: 'empty', message: 'No active replay dataset is loaded.' };

        const result = CandleIntegrity.process(candles, {
          timeframeSec: metadata.timeframeSec,
          from: metadata.effectiveFrom ?? metadata.from ?? candles[0].time,
          to: metadata.effectiveTo ?? metadata.to ?? candles[candles.length - 1].time,
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
      const mapping = {
        [DATA_WORKSPACE_EVENTS.READY]: readyListeners,
        [DATA_WORKSPACE_EVENTS.READY_DEGRADED]: readyListeners,
        [DATA_WORKSPACE_EVENTS.LOADING_STARTED]: loadingListeners,
        [DATA_WORKSPACE_EVENTS.PROGRESS]: progressListeners,
        [DATA_WORKSPACE_EVENTS.ERROR]: errorListeners,
        [DATA_WORKSPACE_EVENTS.LOCAL_DATASET_CHANGED]: localDatasetListeners,
      };
      const eventSet = mapping[event];
      if (!eventSet) throw new Error(`Unsupported data workspace event: ${event}`);
      eventSet.add(handler);
      return () => eventSet.delete(handler);
    },

    listDatasets() {
      return datasetRepository.list();
    },

    listLocalDatasets() {
      return localDatasetRepository.list();
    },

    deleteDataset(id) {
      return enqueue(async () => {
        await datasetRepository.remove(id);
        if (appState.replayDatasetId === id) appState.setReplayDatasetId(null);
        globalThis.window?.dispatchEvent?.(new CustomEvent('delta-replay-datasets-changed'));
      });
    },

    deleteLocalDataset(id) {
      return port.clearLocalDataset(id);
    },

    getDatasetCsv(id) {
      return datasetRepository.getCsv(id);
    },

    getLocalDatasetCsv(id) {
      return localDatasetRepository.getCsv(id);
    },

    storageEstimate() {
      const estimate = globalThis.navigator?.storage?.estimate;
      return estimate ? estimate.call(globalThis.navigator.storage).catch(() => null) : Promise.resolve(null);
    },
  };

  return assertDataWorkspacePort(port);
}
