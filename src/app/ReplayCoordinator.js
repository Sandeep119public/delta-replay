import { DataEvents } from '../data/HistoricalDataManager.js';
import { DataError, ErrorCategory, LoadingState } from '../data/DataError.js';
import { calculateAutoRange, findClosestCandleIndex } from '../utils/replayRange.js';
import { isRetryableCategory as isRetryableErrorCategory } from '../ports/ErrorPresentationPort.js';
import { createReplayPreviewService, VISIBLE_WINDOW } from './ReplayPreviewService.js';
import { createDatasetChangeService } from './DatasetChangeService.js';

export { VISIBLE_WINDOW };
const MAX_RETRIES = 3;

/**
 * ReplayCoordinator coordinates historical data ingestion and replay preparation.
 * DOM elements are injected by the composition root. It does not query document IDs.
 */
export class ReplayCoordinator {
  constructor({
    dataManager, candleStore, appState, replayEngine, tradingEngine, chartManager,
    chartAdapter, timeline, controls, errorPanel, modeBanner, tradingErrorView = null,
    dataStatusEl = null, cacheBadgeEl = null, startReplayBtn = null,
    headerStartReplayBtn = null, loadBtn = null, fromDateEl = null, fromTimeEl = null,
    toDateEl = null, toTimeEl = null,
  }) {
    this.dataManager = dataManager;
    this.candleStore = candleStore;
    this.appState = appState;
    this.replayEngine = replayEngine;
    this.tradingEngine = tradingEngine;
    this.chartManager = chartManager;
    this.chartAdapter = chartAdapter;
    this.timeline = timeline;
    this.controls = controls;
    this.errorPanel = errorPanel;
    this.modeBanner = modeBanner;
    this.tradingErrorView = tradingErrorView;
    this.dataStatusEl = dataStatusEl;
    this.cacheBadgeEl = cacheBadgeEl;
    this.startReplayBtn = startReplayBtn;
    this.headerStartReplayBtn = headerStartReplayBtn;
    this.loadBtn = loadBtn;
    this.fromDateEl = fromDateEl;
    this.fromTimeEl = fromTimeEl;
    this.toDateEl = toDateEl;
    this.toTimeEl = toTimeEl;
    this._loadToken = 0;
    this._currentAbort = null;
    this._retryTimer = null;
    this._retryCount = 0;
    this._progressUnsubscribe = null;
    this._destroyed = false;
    // Capability services: preview rendering and dataset switching live
    // outside the coordinator; it remains a thin orchestrator that owns the
    // load session and delegates.
    this.previewService = createReplayPreviewService({
      candleStore: this.candleStore,
      chartManager: this.chartManager,
      chartAdapter: this.chartAdapter,
    });
    this.datasetChangeService = createDatasetChangeService({
      tradingEngine: this.tradingEngine,
      appState: this.appState,
      candleStore: this.candleStore,
      replayEngine: this.replayEngine,
      chartManager: this.chartManager,
      timeline: this.timeline,
      controls: this.controls,
      startReplayBtn: this.startReplayBtn,
      headerStartReplayBtn: this.headerStartReplayBtn,
      reportError: (msg) => this.showTradingError(msg),
      invalidateLoad: () => {
        this._loadToken++;
        this._clearCurrentLoad();
      },
      reload: () => this.loadAndPrepareReplay({ autoStart: false }),
    });
  }

  updateLoadButton() {
    if (!this.loadBtn) return;
    if (this.appState.loadingState === LoadingState.LOADING) {
      this.loadBtn.disabled = true;
      this.loadBtn.textContent = 'LOADING…';
    } else {
      this.loadBtn.disabled = false;
      this.loadBtn.textContent = 'LOAD DATA';
    }
  }

  updatePreviewWindow(idx) {
    this.previewService.updatePreviewWindow(idx);
  }

  applyWindowedChart(idx) {
    this.previewService.applyWindowedChart(idx);
  }

  handleSymbolTimeframeChange(kind, newValue, selectElement) {
    return this.datasetChangeService.handleSymbolTimeframeChange(kind, newValue, selectElement);
  }

  showTradingError(msg) {
    this.tradingErrorView?.show(msg);
  }

  _clearProgressSubscription() {
    if (!this._progressUnsubscribe) return;
    try { this._progressUnsubscribe(); } catch (error) { console.warn('[ReplayCoordinator] progress unsubscribe failed', error); }
    this._progressUnsubscribe = null;
  }

  _clearCurrentLoad() {
    this._clearProgressSubscription();
    if (this._currentAbort) {
      try { this._currentAbort.abort(); } catch (error) { console.warn('[ReplayCoordinator] abort failed', error); }
      this._currentAbort = null;
    }
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._loadToken++;
    this._clearCurrentLoad();
    this.tradingErrorView?.destroy?.();
  }

  async loadAndPrepareReplay({ targetSec = null, autoStart = false } = {}) {
    if (this._destroyed) return;
    if (this.tradingEngine && this.tradingEngine.hasOpenPosition()) {
      this.showTradingError('Cannot change replay date while a position is open — close position or reset account first.');
      return;
    }
    const token = ++this._loadToken;
    this._clearCurrentLoad();
    const abortController = new AbortController();
    this._currentAbort = abortController;
    const signal = abortController.signal;
    const symbol = this.appState.symbol;
    const timeframe = this.appState.timeframe;
    const resolvedTarget = Number.isFinite(targetSec) ? targetSec : Math.floor(Date.now() / 1000) - 86400;
    const { from, to } = calculateAutoRange(resolvedTarget, timeframe);

    if (this.fromDateEl && this.toDateEl) {
      try {
        const fromIso = new Date(from * 1000).toISOString();
        const toIso = new Date(to * 1000).toISOString();
        this.fromDateEl.value = fromIso.slice(0, 10);
        if (this.fromTimeEl) this.fromTimeEl.value = fromIso.slice(11, 16);
        this.toDateEl.value = toIso.slice(0, 10);
        if (this.toTimeEl) this.toTimeEl.value = toIso.slice(11, 16);
      } catch (error) { console.warn('[ReplayCoordinator] sync legacy date controls failed', error); }
    }

    this.appState.transitionLoading(LoadingState.LOADING);
    if (this.dataStatusEl) this.dataStatusEl.textContent = `Loading ${symbol} ${timeframe}...`;
    this.errorPanel?.hide();
    this.updateLoadButton();
    this.modeBanner?.update({ replayState: this.replayEngine.getState(), appState: this.appState, candleStore: this.candleStore });

    const onProgress = ({ completed, totalChunks, pct, loaded }) => {
      if (token !== this._loadToken || this._destroyed) return;
      if (this.dataStatusEl) this.dataStatusEl.textContent = `Loading ${symbol} · ${timeframe} — chunk ${completed}/${totalChunks} (${pct}%) — ${loaded} candles`;
    };
    this._progressUnsubscribe = this.dataManager.on(DataEvents.PROGRESS, onProgress);

    let retryScheduled = false;
    try {
      const { candles, metadata } = await this.dataManager.load({ symbol, timeframe, from, to, signal, strict: true, halfOpen: true });
      this._clearProgressSubscription();
      if (token !== this._loadToken || signal.aborted || this._destroyed) return;
      if (!candles || !candles.length) throw Object.assign(new Error('No candles returned'), { code: 'NO_DATA' });

      this._retryCount = 0;
      this.appState.setRetryCount(0);
      this.appState.setCandles(candles);
      this.replayEngine.load(candles);
      this.appState.setReplayState(this.replayEngine.getState());
      this.timeline?.setTotal(candles.length, candles);

      let replayIdx = findClosestCandleIndex(resolvedTarget, this.candleStore, candles);
      if (replayIdx < 0) replayIdx = Math.max(0, Math.floor(candles.length * 0.25));
      this.appState.setPendingStartIndex(replayIdx);
      this.controls?.setStartIndex(replayIdx);
      this.timeline?.setPosition(replayIdx);
      this.updatePreviewWindow(replayIdx);

      const startCandle = this.candleStore.get(replayIdx);
      if (startCandle && this.tradingEngine) this.tradingEngine.onMarketCandle({ candle: startCandle, index: replayIdx });
      if (this.startReplayBtn) this.startReplayBtn.disabled = false;
      if (this.headerStartReplayBtn) this.headerStartReplayBtn.disabled = false;
      if (this.cacheBadgeEl) this.cacheBadgeEl.classList.toggle('hidden', !metadata?.cached);
      const cachedTag = metadata?.cached ? ' [Cached]' : '';
      if (this.dataStatusEl) this.dataStatusEl.textContent = `Ready: ${symbol} ${timeframe} (${candles.length.toLocaleString()} candles)${cachedTag}`;
      this.timeline?.setEnabled(true);
      this.appState.transitionLoading(LoadingState.SUCCESS);
      this.modeBanner?.update({ replayState: this.replayEngine.getState(), appState: this.appState, candleStore: this.candleStore });
      if (autoStart) this.replayEngine.start(replayIdx);
    } catch (err) {
      this._clearProgressSubscription();
      if (err?.name === 'AbortError') {
        if (token === this._loadToken) {
          this.appState.transitionLoading(LoadingState.ABORTED);
          if (this.dataStatusEl) this.dataStatusEl.textContent = 'Load cancelled';
        }
        return;
      }
      if (token !== this._loadToken || this._destroyed) return;
      let dataErr;
      if (err instanceof DataError) dataErr = err;
      else if (err?.category) dataErr = new DataError({ category: err.category, technicalMessage: err.message, context: err.context || {} });
      else dataErr = DataError.fromGenericError(err);
      dataErr.context = dataErr.context || {};
      Object.assign(dataErr.context, { symbol, timeframe, start: from, end: to });
      const stateMap = {
        [ErrorCategory.NETWORK]: LoadingState.NETWORK_ERROR,
        [ErrorCategory.TIMEOUT]: LoadingState.TIMEOUT,
        [ErrorCategory.CORS]: LoadingState.NETWORK_ERROR,
        [ErrorCategory.HTTP]: LoadingState.HTTP_ERROR,
        [ErrorCategory.INVALID_RESPONSE]: LoadingState.INVALID_DATA,
        [ErrorCategory.INVALID_REQUEST]: LoadingState.INVALID_DATA,
        [ErrorCategory.NO_DATA]: LoadingState.EMPTY,
        [ErrorCategory.ABORTED]: LoadingState.ABORTED,
        [ErrorCategory.UNKNOWN]: LoadingState.UNKNOWN_ERROR,
      };
      this.appState.transitionLoading(stateMap[dataErr.category] || LoadingState.UNKNOWN_ERROR, dataErr);
      this.errorPanel?.show(dataErr);
      if (dataErr.category === ErrorCategory.NO_DATA) {
        if (this.dataStatusEl) this.dataStatusEl.textContent = 'No candles found for this date';
      } else if (dataErr.category === ErrorCategory.HTTP) {
        if (this.dataStatusEl) this.dataStatusEl.textContent = `HTTP ${dataErr.context.status || 'error'} — ${symbol} ${timeframe}`;
      } else if ([ErrorCategory.NETWORK, ErrorCategory.CORS, ErrorCategory.TIMEOUT].includes(dataErr.category)) {
        if (this.dataStatusEl) this.dataStatusEl.textContent = `Network error — ${symbol} ${timeframe}`;
      } else if (this.dataStatusEl) {
        this.dataStatusEl.textContent = 'Error loading replay candles';
      }

      if (isRetryableErrorCategory(dataErr.category) && this._retryCount < MAX_RETRIES) {
        this._retryCount++;
        this.appState.setRetryCount(this._retryCount);
        const backoff = Math.min(5000, Math.pow(2, this._retryCount - 1) * 1000);
        if (this.dataStatusEl) this.dataStatusEl.textContent = `Retrying… ${this._retryCount}/${MAX_RETRIES}`;
        this.appState.transitionLoading(LoadingState.LOADING);
        retryScheduled = true;
        this._retryTimer = setTimeout(() => {
          this._retryTimer = null;
          if (token === this._loadToken && !this._destroyed) this.loadAndPrepareReplay({ targetSec: resolvedTarget, autoStart });
        }, backoff);
        return;
      }
      this._retryCount = 0;
      this.appState.setRetryCount(0);
    } finally {
      if (token === this._loadToken) {
        if (!retryScheduled) this.appState.setLoading(false);
        if (this._currentAbort === abortController) this._currentAbort = null;
        if (!retryScheduled) this.updateLoadButton();
        this.modeBanner?.update({ replayState: this.replayEngine.getState(), appState: this.appState, candleStore: this.candleStore });
      }
    }
  }
}
