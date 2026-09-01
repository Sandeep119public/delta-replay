import { ReplayEngine } from './replay/ReplayEngine.js';
import { ChartManager } from './chart/ChartManager.js';
import { ChartAdapter } from './chart/ChartAdapter.js';
import { LocalCandleProvider } from './data/LocalCandleProvider.js';
import { DeltaCandleProvider } from './data/DeltaCandleProvider.js';
import { AppState } from './state/AppState.js';
import { SymbolSelector } from './ui/SymbolSelector.js';
import { TimeframeSelector } from './ui/TimeframeSelector.js';
import { Timeline } from './ui/Timeline.js';
import { ReplayControls } from './ui/ReplayControls.js';
import { toUnixSeconds, unixToDateTimeInput, formatTime } from './utils/time.js';
import { PaperTradingEngine } from './trading/PaperTradingEngine.js';
import { TradingPanel } from './ui/TradingPanel.js';

const appState = new AppState();
const engine = new ReplayEngine();
const deltaProvider = new DeltaCandleProvider();
const localProvider = new LocalCandleProvider(); // basePath defaults to import.meta.env.BASE_URL + 'sample-data' for Pages subpath

// --- Paper Trading Engine (isolated, only MARKET_CANDLE) ---
const tradingEngine = new PaperTradingEngine({ startingBalance: 10000, replayEngine: engine });

// Integration-level guards: disallow time-travel while position is open
// Keep ReplayEngine generic; guard at application layer to prevent bypass.
const _origSeek = engine.seek.bind(engine);
const _origReset = engine.reset.bind(engine);
const _origStart = engine.start.bind(engine);
const _origLoad = engine.load.bind(engine);

function _guardBlocked(action) {
  if (tradingEngine.hasOpenPosition()) {
    const msg = `Cannot ${action} while a position is open — close position first.`;
    showError(msg);
    const errEl = document.getElementById('trading-error');
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
      setTimeout(() => { errEl.textContent = ''; errEl.classList.add('hidden'); }, 3000);
    }
    return true;
  }
  return false;
}

engine.seek = (idx) => {
  if (_guardBlocked('seek')) return engine.getState();
  return _origSeek(idx);
};
engine.reset = () => {
  if (_guardBlocked('reset replay')) return engine.getState();
  return _origReset();
};
engine.start = (idx) => {
  if (_guardBlocked('start replay')) return engine.getState();
  return _origStart(idx);
};
engine.load = (candles) => {
  if (tradingEngine.hasOpenPosition()) {
    // Block data reload via direct engine.load as well (e.g., loadData)
    // Allow initial load when no position? Already blocked above, but keep consistent
    const msg = 'Cannot load new data while a position is open — close position or reset account first.';
    showError(msg);
    const errEl = document.getElementById('trading-error');
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); setTimeout(() => { errEl.textContent = ''; errEl.classList.add('hidden'); }, 3000); }
    return engine.getState();
  }
  return _origLoad(candles);
};

// DOM
const symbolSelect = document.getElementById('symbol-select');
const timeframeSelect = document.getElementById('timeframe-select');
const loadBtn = document.getElementById('load-btn');
const dataStatus = document.getElementById('data-status');
const chartContainer = document.getElementById('chart-container');
const errorBanner = document.getElementById('error-banner');
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

// Trading panel DOM
const tradingPanelEl = document.getElementById('trading-panel');

// Init UI components
new SymbolSelector(symbolSelect, appState);
new TimeframeSelector(timeframeSelect, appState);

const timeline = new Timeline({
  sliderEl, startLabelEl, currentLabelEl, endLabelEl,
  indexLabelEl, timeLabelEl, startIndexLabelEl,
  appState, engine,
  startTimeLabelEl
});

const controls = new ReplayControls({
  playBtn, pauseBtn, stepBtn, resetBtn, startReplayBtn, speedSelect, statusEl, engine
});

// Trading panel wiring
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
});

// Chart
const chartManager = new ChartManager(chartContainer);
try {
  chartManager.init();
} catch (e) {
  showError('Chart initialization failed: ' + e.message);
}
const adapter = new ChartAdapter(engine, chartManager);
adapter.attach();

// Defaults for date range: last 24h (UTC)
function setDefaultRange() {
  const nowSec = Math.floor(Date.now() / 1000);
  const toSec = Math.floor(nowSec / 60) * 60;
  const fromSec = toSec - 86400;
  const from = unixToDateTimeInput(fromSec);
  const to = unixToDateTimeInput(toSec);
  if (fromDateEl && toDateEl) {
    fromDateEl.value = from.date;
    fromTimeEl.value = from.time;
    toDateEl.value = to.date;
    toTimeEl.value = to.time;
  }
}
setDefaultRange();

// --------- Helpers ---------

function findClosestIndex(targetSec) {
  const candles = appState.candles;
  if (!candles.length) return -1;
  // binary search for closest >= target or nearest
  let lo = 0, hi = candles.length - 1, best = 0;
  let minDiff = Infinity;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const diff = Math.abs(candles[mid].time - targetSec);
    if (diff < minDiff) { minDiff = diff; best = mid; }
    if (candles[mid].time === targetSec) return mid;
    if (candles[mid].time < targetSec) lo = mid + 1;
    else hi = mid - 1;
  }
  // refine: choose nearest; if tie, prefer lower
  // Check neighbors for closer
  if (best > 0 && Math.abs(candles[best - 1].time - targetSec) < minDiff) best--;
  if (best < candles.length - 1 && Math.abs(candles[best + 1].time - targetSec) < Math.abs(candles[best].time - targetSec)) best++;
  return best;
}

function updateModeBanner(state) {
  const hasData = appState.candles.length > 0;
  const st = state?.status ?? engine.getState().status;
  // Reset classes
  modeBanner.className = 'mode-banner';
  let label = '';
  let showProgress = false;
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
    label = '▶ PLAYING';
    showProgress = true;
  } else if (st === 'paused') {
    modeBanner.classList.add('mode-paused');
    label = '⏸ PAUSED';
    showProgress = true;
  } else if (st === 'ended') {
    modeBanner.classList.add('mode-ended');
    label = 'REPLAY COMPLETE';
    showProgress = true;
  } else {
    label = st.toUpperCase();
  }
  modeIndicator.textContent = label;
  if (showProgress) progressPanel.classList.remove('hidden');
  else progressPanel.classList.add('hidden');

  // overlay for empty/loading
  if (!hasData) {
    if (appState.loading) {
      overlayText.textContent = 'LOADING HISTORICAL DATA…';
      overlay.classList.remove('hidden');
    } else if (appState.error) {
      overlayText.textContent = 'ERROR — ' + appState.error;
      overlay.classList.remove('hidden');
    } else {
      overlayText.textContent = 'Select historical range and click LOAD DATA';
      overlay.classList.remove('hidden');
    }
  } else if (st === 'ended') {
    overlayText.textContent = 'REPLAY COMPLETE — press RESET to replay';
    overlay.classList.remove('hidden');
  } else if (appState.loading) {
    overlayText.textContent = 'LOADING HISTORICAL DATA…';
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

function updateProgress(state) {
  const s = state ?? engine.getState();
  const total = appState.candles.length;
  const idx = s.currentIndex;
  const count = idx >= 0 ? idx + 1 : (s.status === 'ready' ? 0 : 0);
  // For ready/preview, show 0 / total but market time is preview current slider?
  if (total === 0) {
    progressText.textContent = '0 / 0';
    progressPct.textContent = '0%';
    marketTimeEl.textContent = '—';
    marketTimeFull.textContent = 'CURRENT MARKET TIME: —';
    return;
  }
  if (s.status === 'ready' || s.status === 'idle') {
    // Preview: progress is pending start
    progressText.textContent = `${pendingStartIndex + 1} / ${total}`;
    const pct = ((pendingStartIndex + 1) / total * 100).toFixed(2) + '%';
    progressPct.textContent = pct;
    const c = appState.candles[pendingStartIndex];
    const t = c ? formatTime(c.time) : '—';
    marketTimeEl.textContent = t;
    marketTimeFull.textContent = `CURRENT MARKET TIME: ${t}`;
  } else {
    const pctVal = total > 0 && idx >= 0 ? ((idx + 1) / total * 100).toFixed(2) : '0.00';
    progressText.textContent = `${idx >= 0 ? idx + 1 : 0} / ${total}`;
    progressPct.textContent = pctVal + '%';
    const c = idx >= 0 ? appState.candles[idx] : null;
    const candlesVisible = idx >= 0 ? engine.getVisibleCandles() : [];
    // Prefer engine's visible candle time if available
    const t = c ? formatTime(c.time) : (candlesVisible.length ? formatTime(candlesVisible[candlesVisible.length - 1].time) : '—');
    marketTimeEl.textContent = t;
    marketTimeFull.textContent = `CURRENT MARKET TIME: ${t}`;
  }
}

function onReplayEventSync(state) {
  updateModeBanner(state);
  updateProgress(state);
}

// SEEK safety: disallow seek while position open
function trySeek(idx) {
  if (tradingEngine.hasOpenPosition()) {
    showError('Cannot seek while a position is open — close position first.');
    // also surface via trading panel
    const errEl = document.getElementById('trading-error');
    if (errEl) {
      errEl.textContent = 'Seek blocked: close open position first';
      errEl.classList.remove('hidden');
      setTimeout(() => { errEl.textContent = ''; errEl.classList.add('hidden'); }, 3000);
    }
    return false;
  }
  try {
    engine.seek(idx);
    return true;
  } catch (e) {
    showError(e.message);
    return false;
  }
}

// Timeline -> controls linkage
let pendingStartIndex = 0;
timeline.onChange((idx) => {
  pendingStartIndex = idx;
  controls.setStartIndex(idx);
  updateProgress(engine.getState());
  // sync start time label is inside timeline
});

// Jump-to-time handling (with seek safety)
function handleJump() {
  jumpError.classList.add('hidden');
  jumpError.textContent = '';
  const candles = appState.candles;
  if (!candles.length) {
    jumpError.textContent = 'Load data first';
    jumpError.classList.remove('hidden');
    return;
  }
  if (!jumpDateEl.value) {
    jumpError.textContent = 'Select date';
    jumpError.classList.remove('hidden');
    return;
  }
  let target;
  try {
    target = toUnixSeconds(jumpDateEl.value, jumpTimeEl.value || '00:00');
  } catch (e) {
    jumpError.textContent = e.message;
    jumpError.classList.remove('hidden');
    return;
  }
  const idx = findClosestIndex(target);
  if (idx < 0) {
    jumpError.textContent = 'No candle found for that time';
    jumpError.classList.remove('hidden');
    return;
  }
  const st = engine.getState();
  if (st.status === 'idle' || st.status === 'ready') {
    // Preview: move start selection
    pendingStartIndex = idx;
    controls.setStartIndex(idx);
    timeline.setPosition(idx);
    updateProgress(st);
  } else if (st.status === 'playing') {
    if (!tradingEngine.canSeek()) {
      jumpError.textContent = 'Cannot jump while position open';
      jumpError.classList.remove('hidden');
      return;
    }
    // Safest: pause then seek
    try { engine.pause(); } catch {}
    trySeek(idx);
  } else if (st.status === 'paused' || st.status === 'ended') {
    trySeek(idx);
  }
}
if (jumpBtn) jumpBtn.addEventListener('click', handleJump);

// Load logic with race protection + AbortSignal
let loadToken = 0;
let currentAbort = null;

async function loadData() {
  if (tradingEngine.hasOpenPosition()) {
    showError('Cannot load new data while a position is open — close position or reset account first.');
    const errEl = document.getElementById('trading-error');
    if (errEl) { errEl.textContent = 'Cannot load new data while a position is open'; errEl.classList.remove('hidden'); setTimeout(() => { errEl.textContent = ''; errEl.classList.add('hidden'); }, 3000); }
    return;
  }
  const token = ++loadToken;
  if (currentAbort) {
    try { currentAbort.abort(); } catch {}
  }
  const abortController = new AbortController();
  currentAbort = abortController;
  const signal = abortController.signal;

  const symbol = appState.symbol;
  const timeframe = appState.timeframe;

  let from, to;
  try {
    if (!fromDateEl.value || !toDateEl.value) throw new Error('Select both FROM and TO dates (UTC)');
    from = toUnixSeconds(fromDateEl.value, fromTimeEl.value || '00:00');
    to = toUnixSeconds(toDateEl.value, toTimeEl.value || '00:00');
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('Invalid date/time');
    if (from >= to) throw new Error('FROM must be before TO');
    const maxRangeSec = 365 * 86400;
    if (to - from > maxRangeSec) throw new Error('Range too large (max ~365 days). Reduce range.');
  } catch (err) {
    showError(err.message);
    dataStatus.textContent = 'Invalid date range';
    appState.setError(err.message);
    updateModeBanner();
    return;
  }

  appState.setLoading(true);
  appState.clearError();
  hideError();
  dataStatus.textContent = `Loading ${symbol} ${timeframe}...`;
  loadBtn.disabled = true;
  loadBtn.textContent = 'LOADING...';
  updateModeBanner();

  const provider = deltaProvider;

  try {
    const candles = await provider.getCandles({ symbol, timeframe, from, to, signal });
    if (token !== loadToken) return;
    if (signal.aborted) return;

    if (!candles.length) throw new Error('No candles returned');

    appState.setCandles(candles);
    engine.load(candles);
    appState.setReplayState(engine.getState());

    adapter.showPreview(candles);
    timeline.setTotal(candles.length, candles);
    pendingStartIndex = Number(timeline.getSelectedIndex());
    controls.setStartIndex(pendingStartIndex);

    startReplayBtn.disabled = false;
    const fromLbl = new Date(from * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    const toLbl = new Date(to * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    dataStatus.textContent = `Loaded: ${symbol} ${timeframe} ${candles.length} candles (${fromLbl} → ${toLbl})`;
    timeline.setEnabled(true);
    updateModeBanner(engine.getState());
    updateProgress(engine.getState());
  } catch (err) {
    if (err?.name === 'AbortError') return;
    if (token !== loadToken) return;
    let msg = err.message || String(err);
    if (err.code) {
      const map = {
        'INVALID_REQUEST': 'Invalid request',
        'NO_DATA': 'No data',
        'TIMEOUT': 'Request timeout',
        'NETWORK_ERROR': 'Network error',
        'CORS_ERROR': 'CORS/Network error',
        'API_ERROR': 'Exchange API error',
        'INVALID_RESPONSE': 'Invalid response',
      };
      const prefix = map[err.code] ? `${map[err.code]}: ` : `[${err.code}] `;
      msg = prefix + msg;
    }
    showError(msg);
    appState.setError(msg);
    dataStatus.textContent = 'Error loading candles';
    updateModeBanner();
  } finally {
    if (token === loadToken) {
      appState.setLoading(false);
      loadBtn.disabled = false;
      loadBtn.textContent = 'LOAD DATA';
      if (currentAbort === abortController) currentAbort = null;
      updateModeBanner(engine.getState());
    }
  }
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.remove('hidden');
}
function hideError() {
  errorBanner.classList.add('hidden');
  errorBanner.textContent = '';
}

// Engine -> AppState sync (event-driven, no polling)
engine.on('stateChanged', (s) => {
  appState.setReplayState(s);
  if (s.currentIndex >= 0) timeline.setPosition(s.currentIndex);
  onReplayEventSync(s);
  if (s.status === 'ready') {
    timeline.setEnabled(true);
    startReplayBtn.disabled = false;
  } else if (s.status === 'playing' || s.status === 'paused' || s.status === 'ended') {
    timeline.setEnabled(true);
    startReplayBtn.disabled = true;
  }
  if (s.status === 'ended') {
    dataStatus.textContent = `Replay ended at ${s.currentIndex + 1} / ${s.totalCandles}`;
  }
});

engine.on('started', (payload) => {
  dataStatus.textContent = `Replaying from ${payload?.index ?? pendingStartIndex}`;
  timeline.setPosition(payload?.index ?? pendingStartIndex);
  onReplayEventSync(engine.getState());
});
engine.on('played', () => onReplayEventSync(engine.getState()));
engine.on('paused', () => onReplayEventSync(engine.getState()));
engine.on('stepped', () => onReplayEventSync(engine.getState()));
engine.on('seeked', () => onReplayEventSync(engine.getState()));
engine.on('ended', () => onReplayEventSync(engine.getState()));
engine.on('reset', (s) => {
  if (s.status === 'ready') {
    adapter.showPreview(appState.candles);
    timeline.setTotal(appState.candles.length, appState.candles);
    startReplayBtn.disabled = false;
  }
  onReplayEventSync(s);
  // replay reset DOES NOT reset trading account (separate concerns)
});
engine.on('loaded', () => onReplayEventSync(engine.getState()));

sliderEl.addEventListener('change', () => {
  const idx = Number(sliderEl.value);
  const st = engine.getState();
  if (st.status === 'paused' || st.status === 'playing' || st.status === 'ended') {
    if (st.status === 'playing') {
      try { engine.pause(); } catch {}
    }
    trySeek(idx);
  } else {
    pendingStartIndex = idx;
    controls.setStartIndex(idx);
    updateProgress(st);
  }
});

// Buttons
loadBtn.addEventListener('click', loadData);

// Keyboard shortcuts — guarded to not interfere with typing
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
    if (st.status === 'paused' || st.status === 'ready') {
      if (st.status === 'ready') {
        adapter.showPreview(appState.candles);
        timeline.setTotal(appState.candles.length, appState.candles);
        controls.setStartIndex(pendingStartIndex);
        startReplayBtn.disabled = false;
      }
    }
  } else if (e.code === 'Escape') {
    // Stop/pause if playing
    const s = engine.getState();
    if (s.status === 'playing') engine.pause();
  }
});

// Initial overlay state
updateModeBanner();
updateProgress();

// Auto-load on startup with default range
loadData();
