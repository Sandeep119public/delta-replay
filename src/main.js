import { ReplayEngine } from './replay/ReplayEngine.js';
import { ChartManager } from './chart/ChartManager.js';
import { ChartAdapter } from './chart/ChartAdapter.js';
import { LocalCandleProvider } from './data/LocalCandleProvider.js';
import { DeltaCandleProvider, TIMEFRAME_SECONDS } from './data/DeltaCandleProvider.js';
import { BinanceCandleProvider } from './data/BinanceCandleProvider.js';
import { HistoricalDataManager, DataEvents } from './data/HistoricalDataManager.js';
import { CandleStore } from './data/CandleStore.js';
import { CandleCache } from './data/CandleCache.js';
import { AppState } from './state/AppState.js';
import { SymbolSelector } from './ui/SymbolSelector.js';
import { TimeframeSelector } from './ui/TimeframeSelector.js';
import { Timeline } from './ui/Timeline.js';
import { ReplayControls } from './ui/ReplayControls.js';
import { toUnixSeconds, unixToDateTimeInput, formatTime } from './utils/time.js';
import { PaperTradingEngine } from './trading/PaperTradingEngine.js';
import { TradingPanel } from './ui/TradingPanel.js';
import { DataError, ErrorCategory, LoadingState } from './data/DataError.js';

const VISIBLE_WINDOW = 1000;

// ===== CORE STATE =====
const appState = new AppState();
const candleStore = new CandleStore();
appState.setCandleStore(candleStore);
const engine = new ReplayEngine();
const binanceProvider = new BinanceCandleProvider();
const deltaProvider = new DeltaCandleProvider();
const localProvider = new LocalCandleProvider();
const candleCache = new CandleCache({ dbName: 'delta-replay-futures-v1' });
const dataManager = new HistoricalDataManager({ provider: binanceProvider, store: candleStore, cache: candleCache, concurrency: 2, chunkSize: 1000, strictMode: true });

const tradingEngine = new PaperTradingEngine({ startingBalance: 10000, replayEngine: engine });

// ===== LOADING STATE MACHINE =====
let loadingState = LoadingState.IDLE;
let currentDataError = null;
let loadToken = 0;
let currentAbort = null;
let retryCount = 0;
const MAX_RETRIES = 3;

function transitionLoadingState(newState, dataError = null) {
  loadingState = newState;
  currentDataError = dataError;
  updateErrorPanel();
  updateLoadButton();
  updateModeBanner();
}

// ===== DOM REFERENCES =====
const symbolSelect = document.getElementById('symbol-select');
const timeframeSelect = document.getElementById('timeframe-select');
const loadBtn = document.getElementById('load-btn');
const dataStatus = document.getElementById('data-status');
const chartContainer = document.getElementById('chart-container');
const overlay = document.getElementById('chart-overlay');
const overlayText = document.getElementById('overlay-text');
const fromDateEl = document.getElementById('from-date');
const fromTimeEl = document.getElementById('from-time');
const toDateEl = document.getElementById('to-date');
const toTimeEl = document.getElementById('to-time');
const replayDateEl = document.getElementById('replay-date');
const replayTimeEl = document.getElementById('replay-time');
const headerStartReplayBtn = document.getElementById('header-start-replay-btn');
const cacheBadge = document.getElementById('cache-badge');
const modeBanner = document.getElementById('mode-banner');
const modeIndicator = document.getElementById('mode-indicator');
const progressPanel = document.getElementById('progress-panel');
const progressText = document.getElementById('progress-text');
const progressPct = document.getElementById('progress-pct');
const marketTimeEl = document.getElementById('market-time');
const marketTimeFull = document.getElementById('market-time-full');
const sliderEl = document.getElementById('timeline-slider');
const startLabelEl = document.getElementById('timeline-start-label');
const currentLabelEl = document.getElementById('timeline-current-label');
const endLabelEl = document.getElementById('timeline-end-label');
const indexLabelEl = document.getElementById('timeline-index-label');
const timeLabelEl = document.getElementById('timeline-time-label');
const startIndexLabelEl = document.getElementById('start-index-label');
const startTimeLabelEl = document.getElementById('start-time-label');
const startReplayBtn = document.getElementById('start-replay-btn');
const jumpDateEl = document.getElementById('jump-date');
const jumpTimeEl = document.getElementById('jump-time');
const jumpBtn = document.getElementById('jump-btn');
const jumpError = document.getElementById('jump-error');
const playBtn = document.getElementById('btn-play');
const pauseBtn = document.getElementById('btn-pause');
const stepBtn = document.getElementById('btn-step');
const resetBtn = document.getElementById('btn-reset');
const speedSelect = document.getElementById('speed-select');
const statusEl = document.getElementById('replay-status');
const followBtn = document.getElementById('btn-follow');
const errorPanel = document.getElementById('error-panel');
const errorPanelTitle = document.getElementById('error-panel-title');
const errorPanelMessage = document.getElementById('error-panel-message');
const errorPanelContext = document.getElementById('error-panel-context');
const errorPanelDismiss = document.getElementById('error-panel-dismiss');
const errorPanelRetry = document.getElementById('error-panel-retry');
const errorPanelDetails = document.getElementById('error-panel-details');

// ===== INIT UI =====
new SymbolSelector(symbolSelect, appState);
new TimeframeSelector(timeframeSelect, appState);

// ===== ACTION GUARDS =====
engine.registerActionGuard((action) => {
  if (tradingEngine.hasOpenPosition()) {
    const msg = action === 'load'
      ? 'Cannot load new data while a position is open — close position or reset account first.'
      : `Cannot ${action} while a position is open — close position first.`;
    showTradingError(msg);
    return { allowed: false, reason: msg };
  }
  return { allowed: true };
});

// ===== CHART + TIMELINE =====
const chartManager = new ChartManager(chartContainer);
try { chartManager.init(); } catch (e) { showError('Chart initialization failed: ' + e.message); }
const adapter = new ChartAdapter(engine, chartManager);
adapter.attach();

chartManager.onAutoFollowChange((isFollow) => {
  if (followBtn) {
    if (isFollow) followBtn.classList.add('hidden');
    else followBtn.classList.remove('hidden');
  }
});

if (followBtn) {
  followBtn.addEventListener('click', () => {
    chartManager.setAutoFollow(true);
    const idx = engine.getState().currentIndex;
    if (idx >= 0) {
      const c = candleStore.get(idx);
      if (c) chartManager.setRevealedMax(c.time);
      const win = candleStore.sliceWindow(Math.max(0, idx - VISIBLE_WINDOW + 1), idx);
      chartManager.setData(win, { fit: false });
      chartManager.followCurrent();
    }
    followBtn.classList.add('hidden');
  });
}

function updateRevealedMax(idx) {
  const c = candleStore.get(idx);
  if (c) chartManager.setRevealedMax(c.time);
}

const origShowPreview = adapter.showPreview.bind(adapter);
adapter.showPreview = (candlesOrStore) => {
  if (Array.isArray(candlesOrStore)) {
    if (candlesOrStore.length > VISIBLE_WINDOW) {
      const win = candlesOrStore.slice(Math.max(0, pendingStartIndex - VISIBLE_WINDOW + 1), pendingStartIndex + 1);
      chartManager.setData(win);
    } else {
      chartManager.setData(candlesOrStore);
    }
  } else {
    chartManager.setData(candlesOrStore);
  }
};

function updatePreviewWindow(idx) {
  if (!candleStore.getCount()) return;
  const win = candleStore.sliceWindow(Math.max(0, idx - VISIBLE_WINDOW + 1), idx);
  chartManager.setData(win);
  chartManager.setRevealedMax(candleStore.get(idx)?.time ?? null);
  chartManager.setAutoFollow(true);
}

function applyWindowedChart(idx) {
  const total = candleStore.getCount();
  if (total === 0) return;
  const start = Math.max(0, idx - VISIBLE_WINDOW + 1);
  const win = candleStore.sliceWindow(start, idx);
  chartManager.setData(win, { fit: false });
}

// ===== DATE & REPLAY RANGE DEFAULTS =====
function getReplayTargetUnixSeconds() {
  if (replayDateEl && replayDateEl.value) {
    try {
      return toUnixSeconds(replayDateEl.value, replayTimeEl?.value || '00:00');
    } catch {}
  }
  if (fromDateEl && fromDateEl.value) {
    try {
      return toUnixSeconds(fromDateEl.value, fromTimeEl?.value || '00:00');
    } catch {}
  }
  // Default to 1 day ago
  return Math.floor(Date.now() / 1000) - 86400;
}

function calculateAutoRange(targetSec, timeframe = '1m') {
  const tfSec = TIMEFRAME_SECONDS[timeframe] || 60;
  const nowSec = Math.floor(Date.now() / 1000);
  
  // Prior historical context (e.g. 350 candles before target for chart background)
  const contextCandles = 350;
  const futureCandles = 1200;

  let from = Math.floor(targetSec - contextCandles * tfSec);
  let to = Math.min(nowSec, Math.floor(targetSec + futureCandles * tfSec));

  // If target is near now, adjust window backwards so there's enough candles
  if (to - from < 500 * tfSec) {
    from = Math.max(0, to - 1500 * tfSec);
  }

  return { from, to };
}

function setDefaultRange() {
  const nowSec = Math.floor(Date.now() / 1000);
  const toSec = Math.floor(nowSec / 60) * 60;
  const replaySec = toSec - 86400; // 1 day ago default replay start
  const replayInput = unixToDateTimeInput(replaySec);
  const toInput = unixToDateTimeInput(toSec);
  const fromInput = unixToDateTimeInput(toSec - 86400 * 2);

  if (replayDateEl) {
    replayDateEl.value = replayInput.date;
    if (replayTimeEl) replayTimeEl.value = replayInput.time;
    const todayStr = new Date(toSec * 1000).toISOString().slice(0, 10);
    replayDateEl.min = '2020-01-01';
    replayDateEl.max = todayStr;
  }

  if (fromDateEl && toDateEl) {
    fromDateEl.value = fromInput.date;
    if (fromTimeEl) fromTimeEl.value = fromInput.time;
    toDateEl.value = toInput.date;
    if (toTimeEl) toTimeEl.value = toInput.time;
  }
  
  if (jumpDateEl) {
    jumpDateEl.value = replayInput.date;
    if (jumpTimeEl) jumpTimeEl.value = replayInput.time;
  }
}
setDefaultRange();

function findClosestIndex(targetSec) {
  if (candleStore.getCount()) return candleStore.findIndexByTime(targetSec);
  const candles = appState.candles;
  if (!candles.length) return -1;
  let lo = 0, hi = candles.length - 1, best = 0, minDiff = Infinity;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const diff = Math.abs(candles[mid].time - targetSec);
    if (diff < minDiff) { minDiff = diff; best = mid; }
    if (candles[mid].time === targetSec) return mid;
    if (candles[mid].time < targetSec) lo = mid + 1; else hi = mid - 1;
  }
  if (best > 0 && Math.abs(candles[best - 1].time - targetSec) < minDiff) best--;
  if (best < candles.length - 1 && Math.abs(candles[best + 1].time - targetSec) < Math.abs(candles[best].time - targetSec)) best++;
  return best;
}

// ===== MODE BANNER / OVERLAY =====
function updateModeBanner(state) {
  const hasData = candleStore.getCount() > 0 || appState.candles.length > 0;
  const st = state?.status ?? engine.getState().status;
  modeBanner.className = 'mode-banner';
  let label = ''; let showProgress = false;
  if (!hasData || st === 'idle') {
    modeBanner.classList.add('mode-idle');
    label = hasData ? 'NO REPLAY STARTED' : 'NO DATA LOADED';
    showProgress = false;
  } else if (st === 'ready') {
    modeBanner.classList.add('mode-ready');
    label = 'PREVIEW MODE — READY TO REPLAY';
    showProgress = true;
  } else if (st === 'playing') {
    modeBanner.classList.add('mode-playing');
    label = '\u25b6 PLAYING';
    showProgress = true;
  } else if (st === 'paused') {
    modeBanner.classList.add('mode-paused');
    label = '\u23f8 PAUSED';
    showProgress = true;
  } else if (st === 'ended') {
    modeBanner.classList.add('mode-ended');
    label = 'REPLAY COMPLETE';
    showProgress = true;
  } else label = st.toUpperCase();
  modeIndicator.textContent = label;
  if (showProgress) progressPanel.classList.remove('hidden'); else progressPanel.classList.add('hidden');

  // Chart overlay logic
  if (!hasData) {
    if (loadingState === LoadingState.LOADING) {
      overlayText.textContent = 'Loading historical data\u2026';
      overlay.classList.remove('hidden');
    } else if (loadingState === LoadingState.NETWORK_ERROR || loadingState === LoadingState.HTTP_ERROR || loadingState === LoadingState.TIMEOUT || loadingState === LoadingState.INVALID_DATA || loadingState === LoadingState.UNKNOWN_ERROR) {
      overlayText.textContent = "Couldn't load historical candles.\nChoose a symbol and date range, then click Load Data.";
      overlay.classList.remove('hidden');
    } else if (loadingState === LoadingState.EMPTY) {
      overlayText.textContent = 'No candles found for the selected range.';
      overlay.classList.remove('hidden');
    } else {
      overlayText.textContent = 'No market data\n\nChoose a symbol and date range,\nthen click Load Data.';
      overlay.classList.remove('hidden');
    }
  } else if (st === 'ended') {
    overlayText.textContent = 'REPLAY COMPLETE — press RESET to replay';
    overlay.classList.remove('hidden');
  } else if (loadingState === LoadingState.LOADING) {
    overlayText.textContent = 'Loading historical data\u2026';
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

function updateProgress(state) {
  const s = state ?? engine.getState();
  const total = candleStore.getCount() || appState.candles.length;
  const idx = s.currentIndex;
  if (total === 0) {
    progressText.textContent = '0 / 0'; progressPct.textContent = '0%';
    marketTimeEl.textContent = '\u2014'; marketTimeFull.textContent = 'CURRENT MARKET TIME: \u2014';
    return;
  }
  if (s.status === 'ready' || s.status === 'idle') {
    progressText.textContent = `${pendingStartIndex + 1} / ${total}`;
    progressPct.textContent = ((pendingStartIndex + 1) / total * 100).toFixed(2) + '%';
    const c = candleStore.get(pendingStartIndex) || appState.candles[pendingStartIndex];
    const t = c ? formatTime(c.time) : '\u2014';
    marketTimeEl.textContent = t; marketTimeFull.textContent = `CURRENT MARKET TIME: ${t}`;
  } else {
    const pctVal = total > 0 && idx >= 0 ? ((idx + 1) / total * 100).toFixed(2) : '0.00';
    progressText.textContent = `${idx >= 0 ? idx + 1 : 0} / ${total}`;
    progressPct.textContent = pctVal + '%';
    const c = idx >= 0 ? (candleStore.get(idx) || appState.candles[idx]) : null;
    const t = c ? formatTime(c.time) : '\u2014';
    marketTimeEl.textContent = t; marketTimeFull.textContent = `CURRENT MARKET TIME: ${t}`;
  }
}

function onReplayEventSync(state) { updateModeBanner(state); updateProgress(state); }

// ===== LOAD BUTTON UX =====
function updateLoadButton() {
  if (loadingState === LoadingState.LOADING) {
    loadBtn.disabled = true;
    loadBtn.textContent = 'LOADING\u2026';
  } else {
    loadBtn.disabled = false;
    loadBtn.textContent = 'LOAD DATA';
  }
}

// ===== ERROR PANEL =====
function showErrorPanel(dataError) {
  if (!dataError) { hideErrorPanel(); return; }
  currentDataError = dataError;
  errorPanelTitle.textContent = 'Data Error';
  errorPanelMessage.textContent = dataError.userMessage;
  errorPanelContext.classList.add('hidden');
  errorPanelContext.textContent = '';
  errorPanel.classList.remove('hidden');
  // Show retry only for retryable errors
  const retryable = isRetryableCategory(dataError.category);
  errorPanelRetry.classList.toggle('hidden', !retryable);
  // Show context summary
  const ctxParts = [];
  if (dataError.context.symbol && dataError.context.timeframe) {
    ctxParts.push(`${dataError.context.symbol} \u00b7 ${dataError.context.timeframe}`);
  }
  if (dataError.context.start != null && dataError.context.end != null) {
    const fmt = (ts) => { try { return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; } catch { return String(ts); } };
    ctxParts.push(`${fmt(dataError.context.start)} \u2192 ${fmt(dataError.context.end)}`);
  }
  if (ctxParts.length) {
    errorPanelMessage.textContent += '\n' + ctxParts.join(' \u00b7 ');
  }
}

function hideErrorPanel() {
  errorPanel.classList.add('hidden');
  currentDataError = null;
}

function updateErrorPanel() {
  if (currentDataError) showErrorPanel(currentDataError);
  else if (loadingState !== LoadingState.IDLE && loadingState !== LoadingState.LOADING && loadingState !== LoadingState.SUCCESS) {
    // Keep panel visible for error states
  } else {
    hideErrorPanel();
  }
}

if (errorPanelDismiss) errorPanelDismiss.addEventListener('click', hideErrorPanel);
if (errorPanelDetails) {
  errorPanelDetails.addEventListener('click', () => {
    if (errorPanelContext.classList.contains('hidden') && currentDataError) {
      errorPanelContext.textContent = currentDataError.toTechnicalString();
      errorPanelContext.classList.remove('hidden');
      errorPanelDetails.textContent = 'Hide Details';
    } else {
      errorPanelContext.classList.add('hidden');
      errorPanelDetails.textContent = 'Details';
    }
  });
}
if (errorPanelRetry) {
  errorPanelRetry.addEventListener('click', () => {
    hideErrorPanel();
    loadData();
  });
}

function isRetryableCategory(category) {
  return category === ErrorCategory.NETWORK || category === ErrorCategory.TIMEOUT || category === ErrorCategory.CORS;
}

// ===== LEGACY ERROR DISPLAY (for backward compat) =====
function showError(msg) {
  if (!msg) { hideError(); return; }
  const dataErr = new DataError({
    category: ErrorCategory.UNKNOWN,
    technicalMessage: msg,
    userMessage: msg,
  });
  showErrorPanel(dataErr);
}
function hideError() {
  hideErrorPanel();
}

function showTradingError(msg) {
  const errEl = document.getElementById('trading-error');
  if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); setTimeout(() => { errEl.textContent = ''; errEl.classList.add('hidden'); }, 3000); }
}

// ===== TIMELINE =====
let pendingStartIndex = 0;
const timeline = new Timeline({ sliderEl, startLabelEl, currentLabelEl, endLabelEl, indexLabelEl, timeLabelEl, startIndexLabelEl, appState, engine, startTimeLabelEl });
const controls = new ReplayControls({ playBtn, pauseBtn, stepBtn, resetBtn, startReplayBtn, speedSelect, statusEl, engine });

timeline.onChange((idx) => {
  pendingStartIndex = idx;
  controls.setStartIndex(idx);
  updateProgress(engine.getState());
  const st = engine.getState();
  if (st.status === 'ready' || st.status === 'idle') {
    updatePreviewWindow(idx);
  }
});

// ===== SYMBOL / TIMEFRAME CHANGE =====
function handleSymbolTimeframeChange(kind) {
  if (tradingEngine.hasOpenPosition()) {
    showTradingError(`Cannot change ${kind} while a position is open — close position first.`);
    if (kind === 'symbol') symbolSelect.value = appState.symbol;
    else timeframeSelect.value = appState.timeframe;
    return;
  }
  if (kind === 'symbol') appState.symbol = symbolSelect.value;
  else appState.timeframe = timeframeSelect.value;

  try { tradingEngine.clearPendingOrders(kind === 'symbol' ? 'SYMBOL_CHANGE' : 'TIMEFRAME_CHANGE'); } catch {}
  loadToken++;
  if (currentAbort) { try { currentAbort.abort(); } catch {} currentAbort = null; }
  try { engine.stop(); } catch {}
  candleStore.clear();
  appState.setCandles([]);
  timeline.setTotal(0, []);
  chartManager.clear();
  chartManager.setRevealedMax(null);
  chartManager.setAutoFollow(true);
  pendingStartIndex = 0;
  controls.setStartIndex(0);
  startReplayBtn.disabled = true;
  if (headerStartReplayBtn) headerStartReplayBtn.disabled = false;
  transitionLoadingState(LoadingState.IDLE);
  if (followBtn) followBtn.classList.add('hidden');

  // Automatically load historical data for the new symbol/timeframe
  loadAndPrepareReplay({ autoStart: false });
}

symbolSelect.addEventListener('change', () => {
  if (tradingEngine.hasOpenPosition()) {
    showTradingError('Cannot change symbol while a position is open — close position first.');
    symbolSelect.value = appState.symbol;
    return;
  }
  handleSymbolTimeframeChange('symbol');
});

timeframeSelect.addEventListener('change', () => {
  if (tradingEngine.hasOpenPosition()) {
    showTradingError('Cannot change timeframe while a position is open — close position first.');
    timeframeSelect.value = appState.timeframe;
    return;
  }
  handleSymbolTimeframeChange('timeframe');
});

// ===== PRESET CHIPS =====
const presetChips = document.querySelectorAll('.preset-chip');
function selectPreset(presetKey) {
  presetChips.forEach(chip => {
    if (chip.dataset.preset === presetKey) chip.classList.add('active');
    else chip.classList.remove('active');
  });

  const nowSec = Math.floor(Date.now() / 1000);
  let targetSec = nowSec - 86400;

  if (presetKey === '1d') {
    targetSec = nowSec - 86400;
    if (timeframeSelect && appState.timeframe === '1m') {
      timeframeSelect.value = '5m';
      appState.timeframe = '5m';
    }
  } else if (presetKey === '3d') {
    targetSec = nowSec - 3 * 86400;
    if (timeframeSelect && (appState.timeframe === '1m' || appState.timeframe === '3m')) {
      timeframeSelect.value = '15m';
      appState.timeframe = '15m';
    }
  } else if (presetKey === '7d') {
    targetSec = nowSec - 7 * 86400;
    if (timeframeSelect && ['1m', '3m', '5m'].includes(appState.timeframe)) {
      timeframeSelect.value = '1h';
      appState.timeframe = '1h';
    }
  } else if (presetKey === '30d') {
    targetSec = nowSec - 30 * 86400;
    if (timeframeSelect && ['1m', '3m', '5m', '15m'].includes(appState.timeframe)) {
      timeframeSelect.value = '1h';
      appState.timeframe = '1h';
    }
  } else if (presetKey === 'now') {
    targetSec = nowSec - 6 * 3600;
  }

  const dt = unixToDateTimeInput(targetSec);
  if (replayDateEl) replayDateEl.value = dt.date;
  if (replayTimeEl) replayTimeEl.value = dt.time;
  if (jumpDateEl) jumpDateEl.value = dt.date;
  if (jumpTimeEl) jumpTimeEl.value = dt.time;

  loadAndPrepareReplay({ targetSec, autoStart: false });
}

presetChips.forEach(chip => {
  chip.addEventListener('click', () => {
    selectPreset(chip.dataset.preset);
  });
});

// Set default preset chip active
const default1dChip = document.querySelector('.preset-chip[data-preset="1d"]');
if (default1dChip) default1dChip.classList.add('active');

// ===== DATE INPUT CHANGE LISTENERS =====
let dateInputDebounce = null;
function handleReplayDateInputChange() {
  presetChips.forEach(c => c.classList.remove('active'));
  clearTimeout(dateInputDebounce);
  dateInputDebounce = setTimeout(() => {
    const targetSec = getReplayTargetUnixSeconds();
    loadAndPrepareReplay({ targetSec, autoStart: false });
  }, 400);
}

if (replayDateEl) replayDateEl.addEventListener('change', handleReplayDateInputChange);
if (replayTimeEl) replayTimeEl.addEventListener('change', handleReplayDateInputChange);

// ===== QUICK QUANTITY CHIPS =====
const qtyChips = document.querySelectorAll('.qty-chip');
const qtyInput = document.getElementById('trade-qty');
qtyChips.forEach(chip => {
  chip.addEventListener('click', () => {
    if (qtyInput && chip.dataset.qty) {
      qtyInput.value = chip.dataset.qty;
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
});

// ===== TRADING PANEL =====
const tradingPanel = new TradingPanel({
  tradingEngine,
  balanceEl: document.getElementById('acct-balance'),
  equityEl: document.getElementById('acct-equity'),
  realizedEl: document.getElementById('acct-realized'),
  unrealizedEl: document.getElementById('acct-unrealized'),
  feesEl: document.getElementById('acct-fees'),
  posSymbolEl: document.getElementById('pos-symbol'),
  posSideEl: document.getElementById('pos-side'),
  posQtyEl: document.getElementById('pos-qty'),
  posEntryEl: document.getElementById('pos-entry'),
  posCurrentEl: document.getElementById('pos-current'),
  posPnlEl: document.getElementById('pos-pnl'),
  qtyInput: document.getElementById('trade-qty'),
  buyBtn: document.getElementById('btn-buy'),
  sellBtn: document.getElementById('btn-sell'),
  closeBtn: document.getElementById('btn-close'),
  resetBtn: document.getElementById('btn-reset-acct'),
  tradesListEl: document.getElementById('trades-list'),
  errorEl: document.getElementById('trading-error'),
  orderTypeSelect: document.getElementById('order-type'),
  limitPriceInput: document.getElementById('limit-price'),
  stopPriceInput: document.getElementById('stop-price'),
  pendingListEl: document.getElementById('pending-orders-list'),
  posSlEl: document.getElementById('pos-sl'),
  posTpEl: document.getElementById('pos-tp'),
  slInput: document.getElementById('sl-price'),
  tpInput: document.getElementById('tp-price'),
  setRiskBtn: document.getElementById('btn-set-risk'),
  clearRiskBtn: document.getElementById('btn-clear-risk'),
});

// ===== CHART TRADING OVERLAYS & INTERACTIVE CLICK =====
const chartFloatingBar = document.getElementById('chart-floating-bar');
const chartPosBadge = document.getElementById('chart-pos-badge');
const chartPosEntry = document.getElementById('chart-pos-entry');
const chartPosPnl = document.getElementById('chart-pos-pnl');
const btnChartClose = document.getElementById('btn-chart-close');
const chartToast = document.getElementById('chart-toast');
let toastTimeout = null;

function showTradingToast(msg) {
  if (!chartToast) return;
  chartToast.textContent = msg;
  chartToast.classList.remove('hidden');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    chartToast.classList.add('hidden');
  }, 2500);
}

function updateChartPositionPill(pos) {
  if (!chartFloatingBar) return;
  if (!pos) {
    chartFloatingBar.classList.add('hidden');
    return;
  }
  chartFloatingBar.classList.remove('hidden');
  if (chartPosBadge) {
    chartPosBadge.textContent = `${pos.side} ${pos.quantity}`;
    chartPosBadge.className = `chart-pos-badge ${pos.side === 'LONG' ? 'pos-long' : 'pos-short'}`;
  }
  if (chartPosEntry) {
    chartPosEntry.textContent = `@ $${Number(pos.entryPrice).toFixed(2)}`;
  }
  if (chartPosPnl) {
    const pnl = Number(pos.unrealizedPnL || 0);
    chartPosPnl.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
    chartPosPnl.className = `chart-pos-pnl ${pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`;
  }
}

if (btnChartClose) {
  btnChartClose.addEventListener('click', () => {
    const positions = tradingEngine.getPositions();
    if (positions.length > 0) {
      tradingEngine.closePosition(positions[0].symbol);
    }
  });
}

function syncChartTradingLines() {
  const positions = tradingEngine.getPositions();
  const activePos = positions.length > 0 ? positions[0] : null;
  chartManager.updatePositionLines(activePos);
  
  const pendingOrders = tradingEngine.getPendingOrders ? tradingEngine.getPendingOrders() : [];
  chartManager.updateOrderLines(pendingOrders);
  updateChartPositionPill(activePos);
}

tradingEngine.on('positionOpened', syncChartTradingLines);
tradingEngine.on('positionUpdated', syncChartTradingLines);
tradingEngine.on('positionClosed', () => {
  chartManager.updatePositionLines(null);
  updateChartPositionPill(null);
  syncChartTradingLines();
});
tradingEngine.on('accountReset', () => {
  chartManager.clearTradingLines();
  updateChartPositionPill(null);
});
tradingEngine.on('orderPlaced', syncChartTradingLines);
tradingEngine.on('orderTriggered', syncChartTradingLines);
tradingEngine.on('orderFilled', syncChartTradingLines);
tradingEngine.on('orderCancelled', syncChartTradingLines);
tradingEngine.on('stopLossTriggered', syncChartTradingLines);
tradingEngine.on('takeProfitTriggered', syncChartTradingLines);

// Interactive Chart Click Handler for SL / TP / Orders
chartManager.onChartClick(({ price }) => {
  if (!Number.isFinite(price) || price <= 0) return;
  const positions = tradingEngine.getPositions();
  if (positions.length > 0) {
    const p = positions[0];
    const isLong = p.side === 'LONG';
    const entryPrice = Number(p.entryPrice);
    
    // Determine whether clicked price is TP or SL based on position direction
    const isTP = isLong ? (price > entryPrice) : (price < entryPrice);
    const slInput = document.getElementById('sl-price');
    const tpInput = document.getElementById('tp-price');
    
    if (isTP) {
      const res = tradingEngine.setTakeProfit(p.symbol, price);
      if (res.success) {
        if (tpInput) tpInput.value = price.toFixed(2);
        showTradingToast(`Take Profit set to $${price.toFixed(2)}`);
      } else {
        showTradingError(res.message);
      }
    } else {
      const res = tradingEngine.setStopLoss(p.symbol, price);
      if (res.success) {
        if (slInput) slInput.value = price.toFixed(2);
        showTradingToast(`Stop Loss set to $${price.toFixed(2)}`);
      } else {
        showTradingError(res.message);
      }
    }
    syncChartTradingLines();
    tradingPanel.render();
  } else {
    // Fill active Limit / Stop price input in the order form if selected
    const limitInput = document.getElementById('limit-price');
    const stopInput = document.getElementById('stop-price');
    const orderTypeSelect = document.getElementById('order-type');
    const type = orderTypeSelect ? orderTypeSelect.value : 'MARKET';
    if (type === 'LIMIT' && limitInput) {
      limitInput.value = price.toFixed(2);
      showTradingToast(`Limit Price set to $${price.toFixed(2)}`);
    } else if (type === 'STOP_MARKET' && stopInput) {
      stopInput.value = price.toFixed(2);
      showTradingToast(`Stop Price set to $${price.toFixed(2)}`);
    }
  }
});

// ===== JUMP =====
function handleJump() {
  jumpError.classList.add('hidden'); jumpError.textContent = '';
  const total = candleStore.getCount() || appState.candles.length;
  if (!total) { jumpError.textContent = 'Load data first'; jumpError.classList.remove('hidden'); return; }
  if (!jumpDateEl.value) { jumpError.textContent = 'Select date'; jumpError.classList.remove('hidden'); return; }
  let target;
  try { target = toUnixSeconds(jumpDateEl.value, jumpTimeEl.value || '00:00'); } catch (e) { jumpError.textContent = e.message; jumpError.classList.remove('hidden'); return; }
  const idx = findClosestIndex(target);
  if (idx < 0) { jumpError.textContent = 'No candle found for that time'; jumpError.classList.remove('hidden'); return; }
  const c = candleStore.get(idx) || appState.candles[idx];
  if (c && Math.abs(c.time - target) > 86400 && dataStatus) {
    dataStatus.textContent = `Jumped to nearest candle: ${formatTime(c.time)}`;
  }
  const st = engine.getState();
  if (st.status === 'idle' || st.status === 'ready') {
    pendingStartIndex = idx; controls.setStartIndex(idx); timeline.setPosition(idx); updateProgress(st); updatePreviewWindow(idx);
  } else if (st.status === 'playing') {
    if (!tradingEngine.canSeek()) { jumpError.textContent = 'Cannot jump while position open'; jumpError.classList.remove('hidden'); return; }
    try { engine.pause(); } catch {}
    trySeek(idx);
  } else if (st.status === 'paused' || st.status === 'ended') { trySeek(idx); }
}
if (jumpBtn) jumpBtn.addEventListener('click', handleJump);

function trySeek(idx) {
  if (tradingEngine.hasOpenPosition()) {
    showTradingError('Cannot seek while a position is open — close position first.');
    return false;
  }
  try { engine.seek(idx); return true; }
  catch (e) { showError(e.message); return false; }
}

// ===== LOAD & PREPARE REPLAY =====
async function loadAndPrepareReplay({ targetSec = null, autoStart = false } = {}) {
  if (tradingEngine.hasOpenPosition()) {
    showTradingError('Cannot change replay date while a position is open — close position or reset account first.');
    return;
  }

  const token = ++loadToken;
  if (currentAbort) { try { currentAbort.abort(); } catch {} }
  const abortController = new AbortController();
  currentAbort = abortController;
  const signal = abortController.signal;

  const symbol = appState.symbol;
  const timeframe = appState.timeframe;
  const resolvedTarget = targetSec ?? getReplayTargetUnixSeconds();
  const { from, to } = calculateAutoRange(resolvedTarget, timeframe);

  // Sync inputs
  const fromDt = unixToDateTimeInput(from);
  const toDt = unixToDateTimeInput(to);
  if (fromDateEl) { fromDateEl.value = fromDt.date; fromTimeEl.value = fromDt.time; }
  if (toDateEl) { toDateEl.value = toDt.date; toTimeEl.value = toDt.time; }

  // Transition to LOADING
  transitionLoadingState(LoadingState.LOADING);
  dataStatus.textContent = `Loading ${symbol} ${timeframe}...`;
  hideError();

  const onProgress = ({ completed, totalChunks, pct, loaded }) => {
    if (token !== loadToken) return;
    dataStatus.textContent = `Loading ${symbol} · ${timeframe} — chunk ${completed}/${totalChunks} (${pct}%) — ${loaded} candles`;
  };
  const onChunk = () => {};
  dataManager.on(DataEvents.PROGRESS, onProgress);
  dataManager.on(DataEvents.CHUNK_RECEIVED, onChunk);

  try {
    const { candles, metadata } = await dataManager.load({ symbol, timeframe, from, to, signal, strict: true, halfOpen: true });
    dataManager.off(DataEvents.PROGRESS, onProgress);
    dataManager.off(DataEvents.CHUNK_RECEIVED, onChunk);

    if (token !== loadToken) return;
    if (signal.aborted) return;
    if (!candles.length) throw Object.assign(new Error('No candles returned'), { code: 'NO_DATA' });

    // SUCCESS
    retryCount = 0;
    appState.setCandles(candles);
    engine.load(candles);
    appState.setReplayState(engine.getState());
    timeline.setTotal(candles.length, candles);

    // Find closest index for replay start point
    let replayIdx = findClosestIndex(resolvedTarget);
    if (replayIdx < 0) replayIdx = Math.max(0, Math.floor(candles.length * 0.25));
    pendingStartIndex = replayIdx;

    controls.setStartIndex(pendingStartIndex);
    timeline.setPosition(pendingStartIndex);
    updatePreviewWindow(pendingStartIndex);
    const startCandle = candleStore.get(pendingStartIndex);
    if (startCandle && tradingEngine) {
      tradingEngine.onMarketCandle({ candle: startCandle, index: pendingStartIndex });
    }
    startReplayBtn.disabled = false;
    if (headerStartReplayBtn) headerStartReplayBtn.disabled = false;

    // Cache indicator
    if (cacheBadge) {
      if (metadata?.cached) cacheBadge.classList.remove('hidden');
      else cacheBadge.classList.add('hidden');
    }

    const fromLbl = new Date(from * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    const toLbl = new Date(to * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    const cachedTag = metadata?.cached ? ' [Cached]' : '';
    dataStatus.textContent = `Ready: ${symbol} ${timeframe} (${candles.length.toLocaleString()} candles)${cachedTag}`;

    timeline.setEnabled(true);
    transitionLoadingState(LoadingState.SUCCESS);
    updateModeBanner(engine.getState());
    updateProgress(engine.getState());

    if (autoStart) {
      engine.start(pendingStartIndex);
    }

  } catch (err) {
    dataManager.off(DataEvents.PROGRESS, onProgress);
    dataManager.off(DataEvents.CHUNK_RECEIVED, onChunk);

    if (err?.name === 'AbortError') {
      if (token === loadToken) {
        transitionLoadingState(LoadingState.ABORTED);
        dataStatus.textContent = 'Load cancelled';
      }
      return;
    }

    if (token !== loadToken) return;

    let dataErr;
    if (err instanceof DataError) {
      dataErr = err;
    } else if (err?.category) {
      dataErr = new DataError({ category: err.category, technicalMessage: err.message, context: err.context || {} });
    } else {
      dataErr = DataError.fromGenericError(err);
    }
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
    transitionLoadingState(newState, dataErr);

    if (dataErr.category === ErrorCategory.NO_DATA) {
      dataStatus.textContent = 'No candles found for this date';
    } else if (dataErr.category === ErrorCategory.HTTP) {
      dataStatus.textContent = `HTTP ${dataErr.context.status || 'error'} — ${symbol} ${timeframe}`;
    } else if (dataErr.category === ErrorCategory.NETWORK || dataErr.category === ErrorCategory.CORS || dataErr.category === ErrorCategory.TIMEOUT) {
      dataStatus.textContent = `Network error — ${symbol} ${timeframe}`;
    } else {
      dataStatus.textContent = 'Error loading replay candles';
    }

    if (isRetryableCategory(dataErr.category) && retryCount < MAX_RETRIES) {
      retryCount++;
      const backoff = Math.min(5000, Math.pow(2, retryCount - 1) * 1000);
      dataStatus.textContent = `Retrying… ${retryCount}/${MAX_RETRIES}`;
      transitionLoadingState(LoadingState.LOADING);
      setTimeout(() => {
        if (token === loadToken) loadAndPrepareReplay({ targetSec: resolvedTarget, autoStart });
      }, backoff);
      return;
    }

    retryCount = 0;

  } finally {
    if (token === loadToken) {
      appState.setLoading(false);
      if (currentAbort === abortController) currentAbort = null;
      updateLoadButton();
      updateModeBanner(engine.getState());
    }
  }
}

// Backward-compatible loadData function
async function loadData() {
  return loadAndPrepareReplay({ autoStart: false });
}

// ===== HEADER START REPLAY BUTTON =====
if (headerStartReplayBtn) {
  headerStartReplayBtn.addEventListener('click', () => {
    const st = engine.getState();
    const hasData = candleStore.getCount() > 0 || appState.candles.length > 0;
    if (!hasData) {
      loadAndPrepareReplay({ autoStart: true });
      return;
    }
    if (st.status === 'ready') {
      engine.start(pendingStartIndex);
      engine.play();
    } else if (st.status === 'paused') {
      engine.play();
    } else if (st.status === 'playing') {
      engine.pause();
    } else if (st.status === 'ended') {
      engine.reset();
      engine.start(pendingStartIndex);
      engine.play();
    } else {
      loadAndPrepareReplay({ autoStart: true });
    }
  });
}

// ===== ENGINE EVENTS =====
engine.on('stateChanged', (s) => {
  appState.setReplayState(s);
  if (s.currentIndex >= 0) timeline.setPosition(s.currentIndex);
  onReplayEventSync(s);
  if (s.status === 'ready') {
    timeline.setEnabled(true);
    startReplayBtn.disabled = false;
    if (headerStartReplayBtn) {
      headerStartReplayBtn.innerHTML = '<span class="icon">▶</span> START REPLAY';
      headerStartReplayBtn.disabled = false;
    }
  } else if (s.status === 'playing') {
    timeline.setEnabled(true);
    startReplayBtn.disabled = true;
    if (headerStartReplayBtn) {
      headerStartReplayBtn.innerHTML = '<span class="icon">⏸</span> PAUSE';
      headerStartReplayBtn.disabled = false;
    }
  } else if (s.status === 'paused') {
    timeline.setEnabled(true);
    startReplayBtn.disabled = true;
    if (headerStartReplayBtn) {
      headerStartReplayBtn.innerHTML = '<span class="icon">▶</span> RESUME';
      headerStartReplayBtn.disabled = false;
    }
  } else if (s.status === 'ended') {
    timeline.setEnabled(true);
    startReplayBtn.disabled = true;
    dataStatus.textContent = `Replay ended at ${s.currentIndex + 1} / ${s.totalCandles}`;
    if (headerStartReplayBtn) {
      headerStartReplayBtn.innerHTML = '<span class="icon">↺</span> REPLAY AGAIN';
      headerStartReplayBtn.disabled = false;
    }
  }
});
engine.on('started', (payload) => {
  const idx = payload?.index ?? pendingStartIndex;
  dataStatus.textContent = `Replaying from candle #${idx + 1}`;
  timeline.setPosition(idx);
  updateRevealedMax(idx);
  onReplayEventSync(engine.getState());
});
engine.on('played', () => onReplayEventSync(engine.getState()));
engine.on('paused', () => onReplayEventSync(engine.getState()));
engine.on('stepped', (p) => {
  onReplayEventSync(engine.getState());
  if (p?.index !== undefined) updateRevealedMax(p.index);
});
engine.on('seeked', (p) => {
  onReplayEventSync(engine.getState());
  if (p?.index !== undefined) updateRevealedMax(p.index);
});
engine.on('ended', () => onReplayEventSync(engine.getState()));
engine.on('reset', (s) => {
  if (s.status === 'ready') {
    updatePreviewWindow(pendingStartIndex);
    updateRevealedMax(pendingStartIndex);
    timeline.setTotal(candleStore.getCount() || appState.candles.length, candleStore.getAll().length ? candleStore.getAll() : appState.candles);
    startReplayBtn.disabled = false;
    if (headerStartReplayBtn) {
      headerStartReplayBtn.innerHTML = '<span class="icon">▶</span> START REPLAY';
      headerStartReplayBtn.disabled = false;
    }
  } else if (s.index !== undefined) {
    updateRevealedMax(s.index);
  }
  onReplayEventSync(s);
});
engine.on('loaded', () => onReplayEventSync(engine.getState()));

// ===== SLIDER =====
sliderEl.addEventListener('change', () => {
  const idx = Number(sliderEl.value);
  const st = engine.getState();
  if (st.status === 'paused' || st.status === 'playing' || st.status === 'ended') {
    if (st.status === 'playing') { try { engine.pause(); } catch {} }
    const ok = trySeek(idx);
    if (!ok) {
      sliderEl.value = String(st.currentIndex);
      timeline.setPosition(st.currentIndex);
    }
  } else {
    pendingStartIndex = idx; controls.setStartIndex(idx); updateProgress(st); updatePreviewWindow(idx);
  }
});

// ===== LOAD BUTTON =====
if (loadBtn) loadBtn.addEventListener('click', () => { retryCount = 0; hideErrorPanel(); loadData(); });

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    const s = engine.getState();
    const hasData = candleStore.getCount() > 0 || appState.candles.length > 0;
    if (!hasData) return;
    if (s.status === 'ready') {
      engine.start(pendingStartIndex);
      engine.play();
    } else if (s.status === 'paused') {
      engine.play();
    } else if (s.status === 'playing') {
      engine.pause();
    } else if (s.status === 'ended') {
      engine.reset();
      engine.start(pendingStartIndex);
      engine.play();
    }
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    try { engine.stepForward(); } catch {}
  } else if (e.code === 'KeyR') {
    e.preventDefault();
    const hasData = candleStore.getCount() > 0 || appState.candles.length > 0;
    if (!hasData) return;
    engine.reset();
    const st = engine.getState();
    if (st.status === 'ready') {
      updatePreviewWindow(pendingStartIndex);
      timeline.setTotal(candleStore.getCount() || appState.candles.length, candleStore.getAll().length ? candleStore.getAll() : appState.candles);
      controls.setStartIndex(pendingStartIndex);
      startReplayBtn.disabled = false;
    } else if (st.status === 'paused' && st.currentIndex >= 0) {
      updateRevealedMax(st.currentIndex);
      timeline.setPosition(st.currentIndex);
      applyWindowedChart(st.currentIndex);
    }
  } else if (e.code === 'Escape') {
    const s = engine.getState();
    if (s.status === 'playing') engine.pause();
  }
});

// ===== INIT =====
transitionLoadingState(LoadingState.IDLE);
updateProgress();
loadAndPrepareReplay({ autoStart: false });
