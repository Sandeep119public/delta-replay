import { ReplayEngine } from './replay/ReplayEngine.js';
import { ChartManager } from './chart/ChartManager.js';
import { ChartAdapter } from './chart/ChartAdapter.js';
import { LocalCandleProvider } from './data/LocalCandleProvider.js';
import { DeltaCandleProvider } from './data/DeltaCandleProvider.js';
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
const deltaProvider = new DeltaCandleProvider();
const localProvider = new LocalCandleProvider();
const candleCache = new CandleCache();
const dataManager = new HistoricalDataManager({ provider: deltaProvider, store: candleStore, cache: candleCache, concurrency: 2, chunkSize: 2000 });

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

// ===== GUARDS =====
const _origSeek = engine.seek.bind(engine);
const _origReset = engine.reset.bind(engine);
const _origStart = engine.start.bind(engine);
const _origLoad = engine.load.bind(engine);

function _guardBlocked(action) {
  if (tradingEngine.hasOpenPosition()) {
    const msg = `Cannot ${action} while a position is open — close position first.`;
    showTradingError(msg);
    return true;
  }
  return false;
}

engine.seek = (idx) => _guardBlocked('seek') ? engine.getState() : _origSeek(idx);
engine.reset = () => _guardBlocked('reset replay') ? engine.getState() : _origReset();
engine.start = (idx) => _guardBlocked('start replay') ? engine.getState() : _origStart(idx);
engine.load = (candles) => {
  if (tradingEngine.hasOpenPosition()) {
    showTradingError('Cannot load new data while a position is open — close position or reset account first.');
    return engine.getState();
  }
  return _origLoad(candles);
};

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

// ===== DATE DEFAULTS =====
function setDefaultRange() {
  const nowSec = Math.floor(Date.now() / 1000);
  const toSec = Math.floor(nowSec / 60) * 60;
  const fromSec = toSec - 86400;
  const from = unixToDateTimeInput(fromSec);
  const to = unixToDateTimeInput(toSec);
  if (fromDateEl && toDateEl) {
    fromDateEl.value = from.date; fromTimeEl.value = from.time;
    toDateEl.value = to.date; toTimeEl.value = to.time;
    const todayStr = new Date(toSec * 1000).toISOString().slice(0, 10);
    const minStr = '2020-01-01';
    for (const el of [fromDateEl, toDateEl]) { el.min = minStr; el.max = todayStr; }
    for (const el of [fromDateEl, toDateEl]) el.type = 'date';
    for (const el of [fromTimeEl, toTimeEl]) { el.type = 'time'; el.step = '60'; }
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
  transitionLoadingState(LoadingState.IDLE);
  dataStatus.textContent = `${kind === 'symbol' ? 'Symbol' : 'Timeframe'} changed — click LOAD DATA`;
  if (followBtn) followBtn.classList.add('hidden');
}

symbolSelect.addEventListener('change', () => {
  if (tradingEngine.hasOpenPosition()) {
    showTradingError('Cannot change symbol while a position is open — close position first.');
    symbolSelect.value = appState.symbol;
    return;
  }
  if (candleStore.getCount() || appState.candles.length || engine.getState().status !== 'idle') {
    handleSymbolTimeframeChange('symbol');
  } else {
    appState.symbol = symbolSelect.value;
    try { tradingEngine.clearPendingOrders('SYMBOL_CHANGE'); } catch {}
    if (currentAbort) { try { currentAbort.abort(); } catch {} } loadToken++;
    chartManager.setRevealedMax(null); chartManager.setAutoFollow(true);
  }
});

timeframeSelect.addEventListener('change', () => {
  if (tradingEngine.hasOpenPosition()) {
    showTradingError('Cannot change timeframe while a position is open — close position first.');
    timeframeSelect.value = appState.timeframe;
    return;
  }
  if (candleStore.getCount() || appState.candles.length || engine.getState().status !== 'idle') {
    handleSymbolTimeframeChange('timeframe');
  } else {
    appState.timeframe = timeframeSelect.value;
    try { tradingEngine.clearPendingOrders('TIMEFRAME_CHANGE'); } catch {}
    if (currentAbort) { try { currentAbort.abort(); } catch {} } loadToken++;
    chartManager.setRevealedMax(null); chartManager.setAutoFollow(true);
  }
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

// ===== LOAD DATA (with state machine + race protection + retry) =====
async function loadData() {
  if (tradingEngine.hasOpenPosition()) {
    showTradingError('Cannot load new data while a position is open — close position or reset account first.');
    return;
  }

  const token = ++loadToken;
  if (currentAbort) { try { currentAbort.abort(); } catch {} }
  const abortController = new AbortController();
  currentAbort = abortController;
  const signal = abortController.signal;

  const symbol = appState.symbol;
  const timeframe = appState.timeframe;
  let from, to;

  // Validate dates
  try {
    if (!fromDateEl.value || !toDateEl.value) throw new Error('Select both FROM and TO dates (UTC)');
    from = toUnixSeconds(fromDateEl.value, fromTimeEl.value || '00:00');
    to = toUnixSeconds(toDateEl.value, toTimeEl.value || '00:00');
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('Invalid date/time');
    if (from >= to) throw new Error('FROM must be before TO');
    const maxRangeSec = 365 * 86400 * 2;
    if (to - from > maxRangeSec) throw new Error('Range too large (max ~730 days). Reduce range.');
  } catch (err) {
    const dataErr = new DataError({
      category: ErrorCategory.INVALID_REQUEST,
      technicalMessage: err.message,
      context: { symbol, timeframe, from, to },
    });
    transitionLoadingState(LoadingState.INVALID_DATA, dataErr);
    dataStatus.textContent = 'Invalid date range';
    return;
  }

  // Transition to LOADING
  transitionLoadingState(LoadingState.LOADING);
  dataStatus.textContent = `Loading ${symbol} ${timeframe}...`;
  hideError();

  // Progress tracking
  const onProgress = ({ completed, totalChunks, pct, loaded }) => {
    if (token !== loadToken) return;
    dataStatus.textContent = `Loading ${symbol} \u00b7 ${timeframe} \u2014 chunk ${completed}/${totalChunks} (${pct}%) \u2014 ${loaded} candles`;
  };
  const onChunk = ({ index, count }) => {};
  dataManager.on(DataEvents.PROGRESS, onProgress);
  dataManager.on(DataEvents.CHUNK_RECEIVED, onChunk);

  try {
    const { candles, metadata } = await dataManager.load({ symbol, timeframe, from, to, signal });
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
    pendingStartIndex = Number(timeline.getSelectedIndex());
    controls.setStartIndex(pendingStartIndex);
    updatePreviewWindow(pendingStartIndex);
    startReplayBtn.disabled = false;

    const fromLbl = new Date(from * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    const toLbl = new Date(to * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    const gapInfo = metadata.gaps?.length ? ` \u2022 ${metadata.gaps.length} gaps` : ' \u2022 no gaps';
    const dupInfo = metadata.duplicatesRemoved ? ` \u2022 ${metadata.duplicatesRemoved} dups removed` : '';
    dataStatus.textContent = `Loaded: ${symbol} ${timeframe} ${candles.length.toLocaleString()} candles (${fromLbl} \u2192 ${toLbl})${gapInfo}${dupInfo} \u2022 actual ${formatTime(metadata.actualFirst)} \u2192 ${formatTime(metadata.actualLast)}`;
    timeline.setEnabled(true);
    transitionLoadingState(LoadingState.SUCCESS);
    updateModeBanner(engine.getState());
    updateProgress(engine.getState());

  } catch (err) {
    dataManager.off(DataEvents.PROGRESS, onProgress);
    dataManager.off(DataEvents.CHUNK_RECEIVED, onChunk);

    // Abort handling
    if (err?.name === 'AbortError') {
      if (token === loadToken) {
        transitionLoadingState(LoadingState.ABORTED);
        dataStatus.textContent = 'Load cancelled';
      }
      return;
    }

    if (token !== loadToken) return;

    // Build DataError
    let dataErr;
    if (err instanceof DataError) {
      dataErr = err;
    } else if (err?.category) {
      dataErr = new DataError({ category: err.category, technicalMessage: err.message, context: err.context || {} });
    } else {
      dataErr = DataError.fromGenericError(err);
    }
    // Enrich context
    dataErr.context.symbol = symbol;
    dataErr.context.timeframe = timeframe;
    dataErr.context.start = from;
    dataErr.context.end = to;

    // Determine loading state from error category
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

    // Update data status
    if (dataErr.category === ErrorCategory.NO_DATA) {
      dataStatus.textContent = 'No candles found for this range';
    } else if (dataErr.category === ErrorCategory.HTTP) {
      dataStatus.textContent = `HTTP ${dataErr.context.status || 'error'} \u2014 ${symbol} ${timeframe}`;
    } else if (dataErr.category === ErrorCategory.NETWORK || dataErr.category === ErrorCategory.CORS || dataErr.category === ErrorCategory.TIMEOUT) {
      dataStatus.textContent = `Network error \u2014 ${symbol} ${timeframe}`;
    } else if (dataErr.category === ErrorCategory.INVALID_REQUEST) {
      dataStatus.textContent = 'Invalid request';
    } else {
      dataStatus.textContent = 'Error loading candles';
    }

    // Auto-retry for retryable errors
    if (isRetryableCategory(dataErr.category) && retryCount < MAX_RETRIES) {
      retryCount++;
      const backoff = Math.min(5000, Math.pow(2, retryCount - 1) * 1000);
      dataStatus.textContent = `Retrying\u2026 ${retryCount}/${MAX_RETRIES}`;
      transitionLoadingState(LoadingState.LOADING);
      setTimeout(() => {
        if (token === loadToken) loadData();
      }, backoff);
      return;
    }

    retryCount = 0;

  } finally {
    if (token === loadToken) {
      appState.setLoading(false);
      if (currentAbort === abortController) currentAbort = null;
      if (loadingState !== LoadingState.ABORTED && loadingState !== LoadingState.SUCCESS && loadingState !== LoadingState.EMPTY) {
        // Keep error state
      } else if (loadingState === LoadingState.SUCCESS) {
        // Already set
      }
      updateLoadButton();
      updateModeBanner(engine.getState());
    }
  }
}

// ===== ENGINE EVENTS =====
engine.on('stateChanged', (s) => {
  appState.setReplayState(s);
  if (s.currentIndex >= 0) timeline.setPosition(s.currentIndex);
  onReplayEventSync(s);
  if (s.status === 'ready') { timeline.setEnabled(true); startReplayBtn.disabled = false; }
  else if (s.status === 'playing' || s.status === 'paused' || s.status === 'ended') { timeline.setEnabled(true); startReplayBtn.disabled = true; }
  if (s.status === 'ended') { dataStatus.textContent = `Replay ended at ${s.currentIndex + 1} / ${s.totalCandles}`; }
});
engine.on('started', (payload) => {
  const idx = payload?.index ?? pendingStartIndex;
  dataStatus.textContent = `Replaying from ${idx}`;
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
    trySeek(idx);
  } else {
    pendingStartIndex = idx; controls.setStartIndex(idx); updateProgress(st); updatePreviewWindow(idx);
  }
});

// ===== LOAD BUTTON =====
loadBtn.addEventListener('click', () => { retryCount = 0; hideErrorPanel(); loadData(); });

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    const s = engine.getState();
    if (s.status === 'paused') engine.play();
    else if (s.status === 'playing') engine.pause();
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    try { engine.stepForward(); } catch {}
  } else if (e.code === 'KeyR') {
    e.preventDefault();
    engine.reset();
    const st = engine.getState();
    if (st.status === 'ready') {
      updatePreviewWindow(pendingStartIndex);
      timeline.setTotal(candleStore.getCount() || appState.candles.length, candleStore.getAll().length ? candleStore.getAll() : appState.candles);
      controls.setStartIndex(pendingStartIndex);
      startReplayBtn.disabled = false;
    }
  } else if (e.code === 'Escape') {
    const s = engine.getState();
    if (s.status === 'playing') engine.pause();
  }
});

// ===== INIT =====
transitionLoadingState(LoadingState.IDLE);
updateProgress();
loadData();
