import { CandleIntegrity } from '../data/CandleIntegrity.js';
import { LoadingState } from '../data/DataError.js';

export function createReplayLoadService({
  datasetRepository,
  localDatasetRepository = null,
  candleStore,
  appState,
  replayEngine,
  hasOpenPosition,
  hasPendingOrders,
  hasTradingActivity,
  statusView,
  timeline,
  controls,
  modeBanner,
  errorPanel,
  tradingErrorView = null,
  dataStatusEl = null,
  cacheBadgeEl = null,
  startReplayBtn = null,
  headerStartReplayBtn = null,
  updatePreviewWindow,
}) {
  const required = { datasetRepository, candleStore, appState, replayEngine, statusView, timeline, controls, modeBanner };
  for (const [name, value] of Object.entries(required)) if (!value) throw new TypeError('createReplayLoadService requires ' + name);
  if (typeof hasOpenPosition !== 'function') throw new TypeError('createReplayLoadService requires hasOpenPosition() capability');
  if (typeof hasPendingOrders !== 'function') throw new TypeError('createReplayLoadService requires hasPendingOrders() capability');
  if (typeof hasTradingActivity !== 'function') throw new TypeError('createReplayLoadService requires hasTradingActivity() capability');
  if (typeof updatePreviewWindow !== 'function') throw new TypeError('createReplayLoadService requires updatePreviewWindow callback');

  let loadToken = 0;
  let destroyed = false;

  function reportStatus() {
    modeBanner?.update?.(statusView.snapshot());
  }

  function timeframeSeconds(value) {
    return {
      '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
      '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800,
      '12h': 43200, '1d': 86400, '3d': 259200, '1w': 604800,
    }[value] || null;
  }

  async function loadAndPrepareReplay({ datasetId = null, datasetSource = null, autoStart = false } = {}) {
    if (destroyed) return null;
    if (hasTradingActivity()) {
      tradingErrorView?.show('Cannot replace replay data after trading activity. Reset the simulation first.');
      return null;
    }
    if (hasOpenPosition() || hasPendingOrders()) {
      tradingErrorView?.show('Cannot change replay data while a position is open or a pending order exists. Close the position and cancel pending orders first.');
      return null;
    }

    const token = ++loadToken;
    appState.transitionLoading(LoadingState.LOADING);
    errorPanel?.hide();
    if (dataStatusEl) dataStatusEl.textContent = 'Loading replay dataset…';
    reportStatus();

    try {
      const source = datasetSource || appState.replayDatasetSource || 'github';
      let metadata;
      let candles;
      let loadResult;

      if (source === 'local') {
        if (!localDatasetRepository) throw new Error('Browser local dataset storage is unavailable');
        const record = await localDatasetRepository.get(datasetId);
        if (!record?.metadata || !Array.isArray(record.candles)) throw new Error('Local replay dataset was not found in this browser');
        metadata = record.metadata;
        candles = record.candles;
        if (typeof replayEngine.loadLocalDataset !== 'function') throw new Error('Chunked local replay loading is unavailable');
        loadResult = await replayEngine.loadLocalDataset(candles);
      } else {
        const datasets = await datasetRepository.list();
        if (token !== loadToken || destroyed) return null;

        const selectedId = datasetId || appState.replayDatasetId || datasets[0]?.id;
        if (!selectedId) {
          const error = new Error('No saved replay dataset. Download historical Binance data first.');
          error.code = 'NO_DATASET';
          throw error;
        }

        metadata = datasets.find((dataset) => dataset.id === selectedId) || await datasetRepository.get(selectedId);
        if (!metadata) throw new Error('Selected replay dataset no longer exists');
        loadResult = await replayEngine.loadDataset(selectedId);
        if (typeof datasetRepository.getRange === 'function') {
          const preview = await datasetRepository.getRange(selectedId, { offset: 0, limit: 2000 });
          candles = preview.candles;
        } else {
          candles = Array.isArray(loadResult.visibleCandles) ? loadResult.visibleCandles : [];
        }
      }

      if (token !== loadToken || destroyed) return null;
      const total = Number(loadResult?.total || loadResult?.totalCandles || metadata.count || candles?.length || 0);
      if (!total) throw new Error('Replay dataset is empty');

      const previewCandles = Array.isArray(candles) ? candles.slice(0, 2000) : [];
      if (!previewCandles.length) throw new Error('Replay dataset preview is empty');

      const timeframeSec = metadata.timeframeSec || timeframeSeconds(metadata.timeframe);
      const integrity = CandleIntegrity.process(previewCandles, {
        from: previewCandles[0].time,
        to: previewCandles[previewCandles.length - 1].time,
        timeframeSec,
        origin: 0,
        strict: true,
        policy: 'STRICT',
        timestampUnit: 'seconds',
      });

      if (token !== loadToken || destroyed) return null;
      if (!integrity.validCandles.length) throw new Error('Replay dataset preview failed validation');

      const replayMetadata = {
        ...metadata,
        datasetId: metadata.id,
        local: source === 'local',
        saved: source !== 'local',
        source: source === 'local' ? 'local-file' : 'binance',
        quality: 'VALID',
      };

      appState.setReplayDatasetId(metadata.id, source);
      appState.symbol = metadata.symbol;
      appState.timeframe = metadata.timeframe;
      appState.setCandles(integrity.validCandles, replayMetadata);
      appState.setReplayState(replayEngine.getState());
      timeline?.setTotal(total, integrity.validCandles);
      appState.setPendingStartIndex(0);
      controls?.setStartIndex(0);
      timeline?.setPosition(0);
      updatePreviewWindow(0);

      if (startReplayBtn) startReplayBtn.disabled = false;
      if (headerStartReplayBtn) headerStartReplayBtn.disabled = false;
      if (cacheBadgeEl) cacheBadgeEl.classList.add('hidden');
      if (dataStatusEl) {
        const label = source === 'local' ? 'Local dataset: ' : 'Saved dataset: ';
        dataStatusEl.textContent = label + metadata.symbol + ' · ' + metadata.timeframe + ' · ' + total.toLocaleString() + ' candles';
      }
      timeline?.setEnabled(true);
      appState.transitionLoading(LoadingState.SUCCESS);
      reportStatus();

      if (autoStart) await replayEngine.start(0, metadata.symbol);
      return metadata;
    } catch (error) {
      if (token !== loadToken || destroyed) return null;
      if (error?.code === 'NO_DATASET') {
        appState.transitionLoading(LoadingState.EMPTY, error);
        errorPanel?.show({ category: 'NO_DATA', userMessage: error.message, message: error.message });
        if (dataStatusEl) dataStatusEl.textContent = 'No saved replay dataset';
      } else {
        appState.transitionLoading(LoadingState.INVALID_DATA, error);
        errorPanel?.show({ category: 'INVALID_DATA', userMessage: error?.message || 'Replay dataset failed validation', message: error?.message || String(error) });
        if (dataStatusEl) dataStatusEl.textContent = 'Replay dataset failed validation';
      }
      reportStatus();
      throw error;
    } finally {
      if (token === loadToken && !destroyed) {
        appState.setLoading(false);
        reportStatus();
      }
    }
  }

  return Object.freeze({
    loadAndPrepareReplay,
    updateLoadButton() {},
    clearCurrentLoad() { loadToken += 1; },
    invalidateCurrentLoad() { loadToken += 1; },
    listDatasets: () => datasetRepository.list(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      loadToken += 1;
      tradingErrorView?.destroy?.();
    },
  });
}
