import { DataEvents } from '../data/HistoricalDataManager.js';
import { DataError, ErrorCategory, LoadingState } from '../data/DataError.js';
import { calculateAutoRange, findClosestCandleIndex } from '../utils/replayRange.js';
import { ErrorPanel } from '../ui/ErrorPanel.js';

export const VISIBLE_WINDOW = 1000;
const MAX_RETRIES = 3;

/**
 * ReplayCoordinator coordinates historical data ingestion, caching,
 * engine loading, error recovery, and UI status updates.
 */
export class ReplayCoordinator {
  constructor({
    dataManager,
    candleStore,
    appState,
    replayEngine,
    tradingEngine,
    chartManager,
    chartAdapter,
    timeline,
    controls,
    errorPanel,
    modeBanner,
    dataStatusEl = document.getElementById('data-status'),
    cacheBadgeEl = document.getElementById('cache-badge'),
    startReplayBtn = document.getElementById('start-replay-btn'),
    headerStartReplayBtn = document.getElementById('header-start-replay-btn'),
    loadBtn = document.getElementById('load-btn'),
    fromDateEl = document.getElementById('from-date'),
    fromTimeEl = document.getElementById('from-time'),
    toDateEl = document.getElementById('to-date'),
    toTimeEl = document.getElementById('to-time'),
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
    this._retryCount = 0;
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
    if (!this.candleStore.getCount()) return;
    this.chartAdapter.showPreview(this.candleStore, idx, VISIBLE_WINDOW);
    this.chartManager.setAutoFollow(true);
  }

  applyWindowedChart(idx) {
    const total = this.candleStore.getCount();
    if (total === 0) return;
    const start = Math.max(0, idx - VISIBLE_WINDOW + 1);
    const win = this.candleStore.sliceWindow(start, idx);
    this.chartManager.setData(win, { fit: false });
  }

  handleSymbolTimeframeChange(kind, newValue, selectElement) {
    if (this.tradingEngine && this.tradingEngine.hasOpenPosition()) {
      const msg = `Cannot change ${kind} while a position is open — close position first.`;
      this.showTradingError(msg);
      if (selectElement) {
        selectElement.value = kind === 'symbol' ? this.appState.symbol : this.appState.timeframe;
      }
      return false;
    }

    if (kind === 'symbol') this.appState.symbol = newValue;
    else this.appState.timeframe = newValue;

    try {
      this.tradingEngine?.clearPendingOrders(kind === 'symbol' ? 'SYMBOL_CHANGE' : 'TIMEFRAME_CHANGE');
    } catch {}

    this._loadToken++;
    if (this._currentAbort) {
      try { this._currentAbort.abort(); } catch {}
      this._currentAbort = null;
    }

    try { this.replayEngine.stop(); } catch {}
    this.candleStore.clear();
    this.appState.setCandles([]);
    this.timeline?.setTotal(0, []);
    this.chartManager?.clear();
    this.chartManager?.setRevealedMax(null);
    this.chartManager?.setAutoFollow(true);

    this.appState.setPendingStartIndex(0);
    this.controls?.setStartIndex(0);
    if (this.startReplayBtn) this.startReplayBtn.disabled = true;
    if (this.headerStartReplayBtn) this.headerStartReplayBtn.disabled = false;
    this.appState.transitionLoading(LoadingState.IDLE);

    return this.loadAndPrepareReplay({ autoStart: false });
  }

  showTradingError(msg) {
    const errEl = document.getElementById('trading-error');
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
      setTimeout(() => {
        errEl.textContent = '';
        errEl.classList.add('hidden');
      }, 3000);
    }
  }

  async loadAndPrepareReplay({ targetSec = null, autoStart = false } = {}) {
    if (this.tradingEngine && this.tradingEngine.hasOpenPosition()) {
      this.showTradingError('Cannot change replay date while a position is open — close position or reset account first.');
      return;
    }

    const token = ++this._loadToken;
    if (this._currentAbort) {
      try { this._currentAbort.abort(); } catch {}
    }
    const abortController = new AbortController();
    this._currentAbort = abortController;
    const signal = abortController.signal;

    const symbol = this.appState.symbol;
    const timeframe = this.appState.timeframe;
    const resolvedTarget = Number.isFinite(targetSec)
      ? targetSec
      : Math.floor(Date.now() / 1000) - 86400;

    const { from, to } = calculateAutoRange(resolvedTarget, timeframe);

    // Sync legacy date inputs if present
    if (this.fromDateEl && this.toDateEl) {
      try {
        const fromIso = new Date(from * 1000).toISOString();
        const toIso = new Date(to * 1000).toISOString();
        this.fromDateEl.value = fromIso.slice(0, 10);
        if (this.fromTimeEl) this.fromTimeEl.value = fromIso.slice(11, 16);
        this.toDateEl.value = toIso.slice(0, 10);
        if (this.toTimeEl) this.toTimeEl.value = toIso.slice(11, 16);
      } catch {}
    }

    this.appState.transitionLoading(LoadingState.LOADING);
    if (this.dataStatusEl) this.dataStatusEl.textContent = `Loading ${symbol} ${timeframe}...`;
    this.errorPanel?.hide();
    this.updateLoadButton();
    this.modeBanner?.update({ replayState: this.replayEngine.getState(), appState: this.appState, candleStore: this.candleStore });

    const onProgress = ({ completed, totalChunks, pct, loaded }) => {
      if (token !== this._loadToken) return;
      if (this.dataStatusEl) {
        this.dataStatusEl.textContent = `Loading ${symbol} · ${timeframe} — chunk ${completed}/${totalChunks} (${pct}%) — ${loaded} candles`;
      }
    };
    this.dataManager.on(DataEvents.PROGRESS, onProgress);

    try {
      const { candles, metadata } = await this.dataManager.load({
        symbol,
        timeframe,
        from,
        to,
        signal,
        strict: true,
        halfOpen: true,
      });
      this.dataManager.off(DataEvents.PROGRESS, onProgress);

      if (token !== this._loadToken || signal.aborted) return;
      if (!candles || !candles.length) {
        throw Object.assign(new Error('No candles returned'), { code: 'NO_DATA' });
      }

      this._retryCount = 0;
      this.appState.setRetryCount(0);
      this.appState.setCandles(candles);
      this.replayEngine.load(candles);
      this.appState.setReplayState(this.replayEngine.getState());
      this.timeline?.setTotal(candles.length, candles);

      // Find closest index for replay start point
      let replayIdx = findClosestCandleIndex(resolvedTarget, this.candleStore, candles);
      if (replayIdx < 0) replayIdx = Math.max(0, Math.floor(candles.length * 0.25));
      this.appState.setPendingStartIndex(replayIdx);

      this.controls?.setStartIndex(replayIdx);
      this.timeline?.setPosition(replayIdx);
      this.updatePreviewWindow(replayIdx);

      const startCandle = this.candleStore.get(replayIdx);
      if (startCandle && this.tradingEngine) {
        this.tradingEngine.onMarketCandle({ candle: startCandle, index: replayIdx });
      }

      if (this.startReplayBtn) this.startReplayBtn.disabled = false;
      if (this.headerStartReplayBtn) this.headerStartReplayBtn.disabled = false;

      // Cache indicator
      if (this.cacheBadgeEl) {
        if (metadata?.cached) this.cacheBadgeEl.classList.remove('hidden');
        else this.cacheBadgeEl.classList.add('hidden');
      }

      const cachedTag = metadata?.cached ? ' [Cached]' : '';
      if (this.dataStatusEl) {
        this.dataStatusEl.textContent = `Ready: ${symbol} ${timeframe} (${candles.length.toLocaleString()} candles)${cachedTag}`;
      }

      this.timeline?.setEnabled(true);
      this.appState.transitionLoading(LoadingState.SUCCESS);
      this.modeBanner?.update({ replayState: this.replayEngine.getState(), appState: this.appState, candleStore: this.candleStore });

      if (autoStart) {
        this.replayEngine.start(replayIdx);
      }
    } catch (err) {
      this.dataManager.off(DataEvents.PROGRESS, onProgress);

      if (err?.name === 'AbortError') {
        if (token === this._loadToken) {
          this.appState.transitionLoading(LoadingState.ABORTED);
          if (this.dataStatusEl) this.dataStatusEl.textContent = 'Load cancelled';
        }
        return;
      }

      if (token !== this._loadToken) return;

      let dataErr;
      if (err instanceof DataError) {
        dataErr = err;
      } else if (err?.category) {
        dataErr = new DataError({ category: err.category, technicalMessage: err.message, context: err.context || {} });
      } else {
        dataErr = DataError.fromGenericError(err);
      }
      dataErr.context = dataErr.context || {};
      dataErr.context.symbol = symbol;
      dataErr.context.timeframe = timeframe;
      dataErr.context.start = from;
      dataErr.context.end = to;

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
      const newState = stateMap[dataErr.category] || LoadingState.UNKNOWN_ERROR;
      this.appState.transitionLoading(newState, dataErr);
      this.errorPanel?.show(dataErr);

      if (dataErr.category === ErrorCategory.NO_DATA) {
        if (this.dataStatusEl) this.dataStatusEl.textContent = 'No candles found for this date';
      } else if (dataErr.category === ErrorCategory.HTTP) {
        if (this.dataStatusEl) this.dataStatusEl.textContent = `HTTP ${dataErr.context.status || 'error'} — ${symbol} ${timeframe}`;
      } else if (dataErr.category === ErrorCategory.NETWORK || dataErr.category === ErrorCategory.CORS || dataErr.category === ErrorCategory.TIMEOUT) {
        if (this.dataStatusEl) this.dataStatusEl.textContent = `Network error — ${symbol} ${timeframe}`;
      } else {
        if (this.dataStatusEl) this.dataStatusEl.textContent = 'Error loading replay candles';
      }

      const retryable = ErrorPanel.isRetryableCategory(dataErr.category);
      if (retryable && this._retryCount < MAX_RETRIES) {
        this._retryCount++;
        this.appState.setRetryCount(this._retryCount);
        const backoff = Math.min(5000, Math.pow(2, this._retryCount - 1) * 1000);
        if (this.dataStatusEl) this.dataStatusEl.textContent = `Retrying… ${this._retryCount}/${MAX_RETRIES}`;
        this.appState.transitionLoading(LoadingState.LOADING);
        setTimeout(() => {
          if (token === this._loadToken) {
            this.loadAndPrepareReplay({ targetSec: resolvedTarget, autoStart });
          }
        }, backoff);
        return;
      }

      this._retryCount = 0;
      this.appState.setRetryCount(0);
    } finally {
      if (token === this._loadToken) {
        this.appState.setLoading(false);
        if (this._currentAbort === abortController) this._currentAbort = null;
        this.updateLoadButton();
        this.modeBanner?.update({ replayState: this.replayEngine.getState(), appState: this.appState, candleStore: this.candleStore });
      }
    }
  }
}
