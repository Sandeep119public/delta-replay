import { CandleStore } from '../data/CandleStore.js';
import { CandleIntegrity } from '../data/CandleIntegrity.js';
import { DATA_WORKSPACE_EVENTS, assertDataWorkspacePort } from '../ports/DataWorkspacePort.js';

export function createDataWorkspacePort({ dataManager, candleStore, candleCache, appState, datasetRepository }) {
  if (!candleStore || !candleCache || !appState || !datasetRepository) {
    throw new TypeError('createDataWorkspacePort requires candleStore, candleCache, appState, and datasetRepository');
  }

  let operationTail = Promise.resolve();
  const readyListeners = new Set();
  const loadingListeners = new Set();
  const progressListeners = new Set();
  const errorListeners = new Set();

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
          emitReady({ candles: [], metadata, quality: 'VALID', dataset });
          globalThis.window?.dispatchEvent?.(new CustomEvent('delta-replay-datasets-changed'));
          return { candles: [], metadata, quality: 'VALID', savedDataset: dataset };
        } catch (error) {
          emit(errorListeners, error);
          globalThis.window?.dispatchEvent?.(new CustomEvent('delta-replay-data-error', { detail: error }));
          throw error;
        }
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
      if (event === DATA_WORKSPACE_EVENTS.LOADING_STARTED) {
        loadingListeners.add(handler);
        return () => loadingListeners.delete(handler);
      }
      if (event === DATA_WORKSPACE_EVENTS.PROGRESS) {
        progressListeners.add(handler);
        return () => progressListeners.delete(handler);
      }
      if (event === DATA_WORKSPACE_EVENTS.ERROR) {
        errorListeners.add(handler);
        return () => errorListeners.delete(handler);
      }
      throw new Error(`Unsupported data workspace event: ${event}`);
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
