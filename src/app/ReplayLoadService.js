import { DataEvents } from '../data/HistoricalDataManager.js';
import { DataError, ErrorCategory, LoadingState } from '../data/DataError.js';
import { calculateAutoRange, findClosestCandleIndex } from '../utils/replayRange.js';
import { isRetryableCategory as isRetryableErrorCategory } from '../ports/ErrorPresentationPort.js';

const MAX_RETRIES = 3;

/**
 * Application-owned replay load capability.
 *
 * Owns async load-session identity, cancellation, retry policy, data
 * hydration, and load-related presentation callbacks. ReplayCoordinator
 * remains a stable facade/orchestrator above this service.
 */
export function createReplayLoadService({
  dataManager,
  candleStore,
  appState,
  replayEngine,
  tradingEngine,
  timeline,
  controls,
  modeBanner,
  errorPanel,
  tradingErrorView = null,
  dataStatusEl = null,
  cacheBadgeEl = null,
  startReplayBtn = null,
  headerStartReplayBtn = null,
  loadBtn = null,
  fromDateEl = null,
  fromTimeEl = null,
  toDateEl = null,
  toTimeEl = null,
  updatePreviewWindow,
}) {
  const required = { dataManager, candleStore, appState, replayEngine, timeline, controls, modeBanner };
  for (const [name, value] of Object.entries(required)) {
    if (!value) throw new TypeError(`createReplayLoadService requires ${name}`);
  }
  if (typeof updatePreviewWindow !== 'function') {
    throw new TypeError('createReplayLoadService requires updatePreviewWindow callback');
  }

  let loadToken = 0;
  let currentAbort = null;
  let retryTimer = null;
  let retryCount = 0;
  let progressUnsubscribe = null;
  let destroyed = false;

  function updateLoadButton() {
    if (!loadBtn) return;
    if (appState.loadingState === LoadingState.LOADING) {
      loadBtn.disabled = true;
      loadBtn.textContent = 'LOADING…';
    } else {
      loadBtn.disabled = false;
      loadBtn.textContent = 'LOAD DATA';
    }
  }

  function showTradingError(msg) {
    tradingErrorView?.show(msg);
  }

  function clearProgressSubscription() {
    if (!progressUnsubscribe) return;
    try { progressUnsubscribe(); } catch (error) { console.warn('[ReplayLoadService] progress unsubscribe failed', error); }
    progressUnsubscribe = null;
  }

  function clearCurrentLoad() {
    clearProgressSubscription();
    if (currentAbort) {
      try { currentAbort.abort(); } catch (error) { console.warn('[ReplayLoadService] abort failed', error); }
      currentAbort = null;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function invalidateCurrentLoad() {
    loadToken++;
    clearCurrentLoad();
  }

  function resetRetryState() {
    retryCount = 0;
    appState.setRetryCount(0);
  }

  async function loadAndPrepareReplay({ targetSec = null, autoStart = false } = {}) {
    if (destroyed) return;
    if (tradingEngine && tradingEngine.hasOpenPosition()) {
      showTradingError('Cannot change replay date while a position is open — close position or reset account first.');
      return;
    }

    const token = ++loadToken;
    clearCurrentLoad();
    const abortController = new AbortController();
    currentAbort = abortController;
    const signal = abortController.signal;
    const symbol = appState.symbol;
    const timeframe = appState.timeframe;
    const resolvedTarget = Number.isFinite(targetSec) ? targetSec : Math.floor(Date.now() / 1000) - 86400;
    const { from, to } = calculateAutoRange(resolvedTarget, timeframe);

    if (fromDateEl && toDateEl) {
      try {
        const fromIso = new Date(from * 1000).toISOString();
        const toIso = new Date(to * 1000).toISOString();
        fromDateEl.value = fromIso.slice(0, 10);
        if (fromTimeEl) fromTimeEl.value = fromIso.slice(11, 16);
        toDateEl.value = toIso.slice(0, 10);
        if (toTimeEl) toTimeEl.value = toIso.slice(11, 16);
      } catch (error) { console.warn('[ReplayLoadService] sync date controls failed', error); }
    }

    appState.transitionLoading(LoadingState.LOADING);
    if (dataStatusEl) dataStatusEl.textContent = `Loading ${symbol} ${timeframe}...`;
    errorPanel?.hide();
    updateLoadButton();
    modeBanner?.update({ replayState: replayEngine.getState(), appState, candleStore });

    const onProgress = ({ completed, totalChunks, pct, loaded }) => {
      if (token !== loadToken || destroyed) return;
      if (dataStatusEl) dataStatusEl.textContent = `Loading ${symbol} · ${timeframe} — chunk ${completed}/${totalChunks} (${pct}%) — ${loaded} candles`;
    };
    progressUnsubscribe = dataManager.on(DataEvents.PROGRESS, onProgress);

    let retryScheduled = false;
    try {
      const { candles, metadata } = await dataManager.load({ symbol, timeframe, from, to, signal, strict: true, halfOpen: true });
      clearProgressSubscription();
      if (token !== loadToken || signal.aborted || destroyed) return;
      if (!candles || !candles.length) throw Object.assign(new Error('No candles returned'), { code: 'NO_DATA' });

      resetRetryState();
      appState.setCandles(candles);
      replayEngine.load(candles);
      appState.setReplayState(replayEngine.getState());
      timeline?.setTotal(candles.length, candles);

      let replayIdx = findClosestCandleIndex(resolvedTarget, candleStore, candles);
      if (replayIdx < 0) replayIdx = Math.max(0, Math.floor(candles.length * 0.25));
      appState.setPendingStartIndex(replayIdx);
      controls?.setStartIndex(replayIdx);
      timeline?.setPosition(replayIdx);
      updatePreviewWindow(replayIdx);

      const startCandle = candleStore.get(replayIdx);
      if (startCandle && tradingEngine) tradingEngine.onMarketCandle({ candle: startCandle, index: replayIdx });
      if (startReplayBtn) startReplayBtn.disabled = false;
      if (headerStartReplayBtn) headerStartReplayBtn.disabled = false;
      if (cacheBadgeEl) cacheBadgeEl.classList.toggle('hidden', !metadata?.cached);
      const cachedTag = metadata?.cached ? ' [Cached]' : '';
      if (dataStatusEl) dataStatusEl.textContent = `Ready: ${symbol} ${timeframe} (${candles.length.toLocaleString()} candles)${cachedTag}`;
      timeline?.setEnabled(true);
      appState.transitionLoading(LoadingState.SUCCESS);
      modeBanner?.update({ replayState: replayEngine.getState(), appState, candleStore });
      if (autoStart) replayEngine.start(replayIdx);
    } catch (err) {
      clearProgressSubscription();
      if (err?.name === 'AbortError') {
        if (token === loadToken) {
          appState.transitionLoading(LoadingState.ABORTED);
          if (dataStatusEl) dataStatusEl.textContent = 'Load cancelled';
        }
        return;
      }
      if (token !== loadToken || destroyed) return;

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
      appState.transitionLoading(stateMap[dataErr.category] || LoadingState.UNKNOWN_ERROR, dataErr);
      errorPanel?.show(dataErr);
      if (dataErr.category === ErrorCategory.NO_DATA) {
        if (dataStatusEl) dataStatusEl.textContent = 'No candles found for this date';
      } else if (dataErr.category === ErrorCategory.HTTP) {
        if (dataStatusEl) dataStatusEl.textContent = `HTTP ${dataErr.context.status || 'error'} — ${symbol} ${timeframe}`;
      } else if ([ErrorCategory.NETWORK, ErrorCategory.CORS, ErrorCategory.TIMEOUT].includes(dataErr.category)) {
        if (dataStatusEl) dataStatusEl.textContent = `Network error — ${symbol} ${timeframe}`;
      } else if (dataStatusEl) {
        dataStatusEl.textContent = 'Error loading replay candles';
      }

      if (isRetryableErrorCategory(dataErr.category) && retryCount < MAX_RETRIES) {
        retryCount++;
        appState.setRetryCount(retryCount);
        const backoff = Math.min(5000, Math.pow(2, retryCount - 1) * 1000);
        if (dataStatusEl) dataStatusEl.textContent = `Retrying… ${retryCount}/${MAX_RETRIES}`;
        appState.transitionLoading(LoadingState.LOADING);
        retryScheduled = true;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (token === loadToken && !destroyed) loadAndPrepareReplay({ targetSec: resolvedTarget, autoStart });
        }, backoff);
        return;
      }
      resetRetryState();
    } finally {
      if (token === loadToken) {
        if (!retryScheduled) appState.setLoading(false);
        if (currentAbort === abortController) currentAbort = null;
        if (!retryScheduled) updateLoadButton();
        modeBanner?.update({ replayState: replayEngine.getState(), appState, candleStore });
      }
    }
  }

  return Object.freeze({
    loadAndPrepareReplay,
    updateLoadButton,
    clearCurrentLoad,
    invalidateCurrentLoad,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      loadToken++;
      clearCurrentLoad();
      tradingErrorView?.destroy?.();
    },
    get retryCount() { return retryCount; },
  });
}
