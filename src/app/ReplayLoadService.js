import { CandleIntegrity } from '../data/CandleIntegrity.js';
import { LoadingState } from '../data/DataError.js';

export function createReplayLoadService({
  datasetRepository,
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
  for (const [name, value] of Object.entries(required)) if (!value) throw new TypeError(`createReplayLoadService requires ${name}`);
  if (typeof hasOpenPosition !== 'function') throw new TypeError('createReplayLoadService requires hasOpenPosition() capability');
  if (typeof hasPendingOrders !== 'function') throw new TypeError('createReplayLoadService requires hasPendingOrders() capability');
  if (typeof hasTradingActivity !== 'function') throw new TypeError('createReplayLoadService requires hasTradingActivity() capability');
  if (typeof updatePreviewWindow !== 'function') throw new TypeError('createReplayLoadService requires updatePreviewWindow callback');

  let loadToken = 0;
  let destroyed = false;

  function reportStatus() {
    modeBanner?.update?.(statusView.snapshot());
  }

  async function loadAndPrepareReplay({ datasetId = null, autoStart = false } = {}) {
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
    if (dataStatusEl) dataStatusEl.textContent = 'Loading saved replay dataset…';
    reportStatus();

    try {
      const datasets = await datasetRepository.list();
      if (token !== loadToken || destroyed) return null;

      const selectedId = datasetId || appState.replayDatasetId || datasets[0]?.id;
      if (!selectedId) {
        const error = new Error('No saved replay dataset. Download historical Binance data first.');
        error.code = 'NO_DATASET';
        throw error;
      }

      const metadata = datasets.find((dataset) => dataset.id === selectedId) || await datasetRepository.get(selectedId);
      if (!metadata) throw new Error('Selected replay dataset no longer exists');
      const loadResult = await replayEngine.loadDataset(selectedId);
      const total = Number(loadResult.total || loadResult.totalCandles || metadata.count || 0);
      if (!total) throw new Error('Saved replay dataset is empty');
      const candles = Array.isArray(loadResult.visibleCandles) ? loadResult.visibleCandles : [];

      if (token !== loadToken || destroyed) return null;
      if (!Array.isArray(candles) || !candles.length) throw new Error('Saved replay dataset is empty');

      const from = Number(metadata.from ?? candles[0]?.time ?? 0);
      const to = Number(metadata.to ?? candles[candles.length - 1]?.time ?? from);
      const timeframeSec = metadata.timeframe === '1m' ? 60
        : metadata.timeframe === '3m' ? 180
        : metadata.timeframe === '5m' ? 300
        : metadata.timeframe === '15m' ? 900
        : metadata.timeframe === '30m' ? 1800
        : metadata.timeframe === '1h' ? 3600
        : metadata.timeframe === '2h' ? 7200
        : metadata.timeframe === '4h' ? 14400
        : metadata.timeframe === '6h' ? 21600
        : metadata.timeframe === '8h' ? 28800
        : metadata.timeframe === '12h' ? 43200
        : metadata.timeframe === '1d' ? 86400
        : metadata.timeframe === '3d' ? 259200
        : metadata.timeframe === '1w' ? 604800
        : null;
      const integrity = CandleIntegrity.process(candles, {
        from,
        to,
        timeframeSec,
        origin: 0,
        strict: true,
        policy: 'STRICT',
        timestampUnit: 'seconds',
      });

      if (token !== loadToken || destroyed) return null;

      appState.setReplayDatasetId(metadata.id);
      appState.setCandles(integrity.validCandles, {
        ...metadata,
        datasetId: metadata.id,
        totalCandles: total,
        saved: true,
        format: metadata.format || 'CSV',
        quality: 'VALID',
      });
      appState.setReplayState(replayEngine.getState());
      timeline?.setTotal(total, integrity.validCandles);
      appState.setPendingStartIndex(0);
      controls?.setStartIndex(0);
      timeline?.setPosition(0);
      updatePreviewWindow(0);

      if (startReplayBtn) startReplayBtn.disabled = false;
      if (headerStartReplayBtn) headerStartReplayBtn.disabled = false;
      if (cacheBadgeEl) cacheBadgeEl.classList.add('hidden');
      if (dataStatusEl) dataStatusEl.textContent = `Saved dataset: ${metadata.symbol} · ${metadata.timeframe} · ${total.toLocaleString()} candles`;
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
        errorPanel?.show({ category: 'INVALID_DATA', userMessage: error?.message || 'Saved dataset failed validation', message: error?.message || String(error) });
        if (dataStatusEl) dataStatusEl.textContent = 'Saved dataset failed validation';
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
