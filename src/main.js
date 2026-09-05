import { ReplayEngine } from './replay/ReplayEngine.js';
import { ChartManager } from './chart/ChartManager.js';
import { ChartAdapter } from './chart/ChartAdapter.js';
import { BinanceCandleProvider } from './data/BinanceCandleProvider.js';
import { HistoricalDataManager } from './data/HistoricalDataManager.js';
import { CandleStore } from './data/CandleStore.js';
import { CandleCache } from './data/CandleCache.js';
import { AppState } from './state/AppState.js';
import { SymbolSelector } from './ui/SymbolSelector.js';
import { TimeframeSelector } from './ui/TimeframeSelector.js';
import { Timeline } from './ui/Timeline.js';
import { ReplayControls } from './ui/ReplayControls.js';
import { ErrorPanel } from './ui/ErrorPanel.js';
import { ModeBanner } from './ui/ModeBanner.js';
import { ReplayCoordinator, VISIBLE_WINDOW } from './app/ReplayCoordinator.js';
import { PaperTradingEngine, EXECUTION_TIMING } from './trading/PaperTradingEngine.js';
import { TradingPanel } from './ui/TradingPanel.js';
import { toUnixSeconds, unixToDateTimeInput, formatTime } from './utils/time.js';
import { resolvePresetTarget, resolveReplayTargetUnixSeconds } from './utils/replayRange.js';

// ===== 1. CORE ENGINES & STATE =====
const appState = new AppState();
const candleStore = new CandleStore();
appState.setCandleStore(candleStore);

const engine = new ReplayEngine();
const binanceProvider = new BinanceCandleProvider();
const candleCache = new CandleCache({ dbName: 'delta-replay-futures-v1' });
const dataManager = new HistoricalDataManager({
  provider: binanceProvider,
  store: candleStore,
  cache: candleCache,
  concurrency: 2,
  chunkSize: 1000,
  strictMode: true,
});

const tradingEngine = new PaperTradingEngine({
  startingBalance: 10000,
  replayEngine: engine,
  executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
});

// Action guard: prohibit loading or destructive changes during active position
engine.registerActionGuard((action) => {
  if (tradingEngine.hasOpenPosition()) {
    const msg = action === 'load'
      ? 'Cannot load new data while a position is open — close position or reset account first.'
      : `Cannot ${action} while a position is open — close position first.`;
    coordinator.showTradingError(msg);
    return { allowed: false, reason: msg };
  }
  return { allowed: true };
});

// ===== 2. DOM REFERENCES =====
const symbolSelect = document.getElementById('symbol-select');
const timeframeSelect = document.getElementById('timeframe-select');
const chartContainer = document.getElementById('chart-container');
const sliderEl = document.getElementById('timeline-slider');
const startLabelEl = document.getElementById('timeline-start-label');
const currentLabelEl = document.getElementById('timeline-current-label');
const endLabelEl = document.getElementById('timeline-end-label');
const indexLabelEl = document.getElementById('timeline-index-label');
const timeLabelEl = document.getElementById('timeline-time-label');
const startIndexLabelEl = document.getElementById('start-index-label');
const startTimeLabelEl = document.getElementById('start-time-label');
const startReplayBtn = document.getElementById('start-replay-btn');
const headerStartReplayBtn = document.getElementById('header-start-replay-btn');
const playBtn = document.getElementById('btn-play');
const pauseBtn = document.getElementById('btn-pause');
const stepBtn = document.getElementById('btn-step');
const resetBtn = document.getElementById('btn-reset');
const speedSelect = document.getElementById('speed-select');
const statusEl = document.getElementById('replay-status');
const followBtn = document.getElementById('btn-follow');
const replayDateEl = document.getElementById('replay-date');
const replayTimeEl = document.getElementById('replay-time');
const jumpDateEl = document.getElementById('jump-date');
const jumpTimeEl = document.getElementById('jump-time');
const jumpBtn = document.getElementById('jump-btn');
const jumpError = document.getElementById('jump-error');
const chartFloatingBar = document.getElementById('chart-floating-bar');
const chartPosBadge = document.getElementById('chart-pos-badge');
const chartPosEntry = document.getElementById('chart-pos-entry');
const chartPosPnl = document.getElementById('chart-pos-pnl');
const btnChartClose = document.getElementById('btn-chart-close');
const chartToast = document.getElementById('chart-toast');
const slInput = document.getElementById('sl-price');
const tpInput = document.getElementById('tp-price');
const limitPriceInput = document.getElementById('limit-price');
const stopPriceInput = document.getElementById('stop-price');
const orderTypeSelect = document.getElementById('order-type');

// ===== 3. COMPONENT INSTANTIATION =====
const symbolSelector = new SymbolSelector(symbolSelect, appState);
const timeframeSelector = new TimeframeSelector(timeframeSelect, appState);
const chartManager = new ChartManager(chartContainer);
try { chartManager.init(); } catch (e) { console.error('Chart init failed:', e); }

const adapter = new ChartAdapter(engine, chartManager);
adapter.attach();

const timeline = new Timeline({
  sliderEl,
  startLabelEl,
  currentLabelEl,
  endLabelEl,
  indexLabelEl,
  timeLabelEl,
  startIndexLabelEl,
  appState,
  engine,
  startTimeLabelEl,
});

const controls = new ReplayControls({
  playBtn,
  pauseBtn,
  stepBtn,
  resetBtn,
  startReplayBtn,
  speedSelect,
  statusEl,
  engine,
});

const errorPanel = new ErrorPanel({
  onRetry: () => coordinator.loadAndPrepareReplay({ autoStart: false }),
});

const modeBanner = new ModeBanner();

const coordinator = new ReplayCoordinator({
  dataManager,
  candleStore,
  appState,
  replayEngine: engine,
  tradingEngine,
  chartManager,
  chartAdapter: adapter,
  timeline,
  controls,
  errorPanel,
  modeBanner,
});

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
  orderTypeSelect,
  limitPriceInput,
  stopPriceInput,
  pendingListEl: document.getElementById('pending-orders-list'),
  posSlEl: document.getElementById('pos-sl'),
  posTpEl: document.getElementById('pos-tp'),
  slInput,
  tpInput,
  setRiskBtn: document.getElementById('btn-set-risk'),
  clearRiskBtn: document.getElementById('btn-clear-risk'),
});

// ===== 4. USER INTERACTIONS & EVENT WIRES =====

// Symbol & Timeframe Component Listeners
symbolSelector.onChange((symbol) => {
  coordinator.handleSymbolTimeframeChange('symbol', symbol, symbolSelect);
});
timeframeSelector.onChange((timeframe) => {
  coordinator.handleSymbolTimeframeChange('timeframe', timeframe, timeframeSelect);
});

// Date Picker Default Initialization
function setDefaultRange() {
  const nowSec = Math.floor(Date.now() / 1000);
  const toSec = Math.floor(nowSec / 60) * 60;
  const replaySec = toSec - 86400;
  const replayInput = unixToDateTimeInput(replaySec);

  if (replayDateEl) {
    replayDateEl.value = replayInput.date;
    if (replayTimeEl) replayTimeEl.value = replayInput.time;
    replayDateEl.min = '2020-01-01';
    replayDateEl.max = new Date(toSec * 1000).toISOString().slice(0, 10);
  }
  if (jumpDateEl) {
    jumpDateEl.value = replayInput.date;
    if (jumpTimeEl) jumpTimeEl.value = replayInput.time;
  }
}
setDefaultRange();

// Date Presets
const presetChips = document.querySelectorAll('.preset-chip');
function selectPreset(presetKey) {
  presetChips.forEach(chip => {
    if (chip.dataset.preset === presetKey) chip.classList.add('active');
    else chip.classList.remove('active');
  });

  const { targetSec, recommendedTimeframe } = resolvePresetTarget(presetKey, appState.timeframe);
  if (recommendedTimeframe !== appState.timeframe && timeframeSelect) {
    timeframeSelect.value = recommendedTimeframe;
    appState.timeframe = recommendedTimeframe;
  }

  const dt = unixToDateTimeInput(targetSec);
  if (replayDateEl) replayDateEl.value = dt.date;
  if (replayTimeEl) replayTimeEl.value = dt.time;
  if (jumpDateEl) jumpDateEl.value = dt.date;
  if (jumpTimeEl) jumpTimeEl.value = dt.time;

  coordinator.loadAndPrepareReplay({ targetSec, autoStart: false });
}

presetChips.forEach(chip => {
  chip.addEventListener('click', () => selectPreset(chip.dataset.preset));
});
const defaultChip = document.querySelector('.preset-chip[data-preset="1d"]');
if (defaultChip) defaultChip.classList.add('active');

// Date Inputs Change (Debounced)
let dateInputDebounce = null;
function handleReplayDateInputChange() {
  presetChips.forEach(c => c.classList.remove('active'));
  clearTimeout(dateInputDebounce);
  dateInputDebounce = setTimeout(() => {
    const targetSec = resolveReplayTargetUnixSeconds(replayDateEl?.value, replayTimeEl?.value);
    coordinator.loadAndPrepareReplay({ targetSec, autoStart: false });
  }, 400);
}
if (replayDateEl) replayDateEl.addEventListener('change', handleReplayDateInputChange);
if (replayTimeEl) replayTimeEl.addEventListener('change', handleReplayDateInputChange);

// Quick Quantity Chips
document.querySelectorAll('.qty-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const qtyInput = document.getElementById('trade-qty');
    if (qtyInput && chip.dataset.qty) {
      qtyInput.value = chip.dataset.qty;
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
});

// Timeline Slider Sync
timeline.onChange((idx) => {
  appState.setPendingStartIndex(idx);
  controls.setStartIndex(idx);
  modeBanner.update({ replayState: engine.getState(), appState, candleStore });
  const st = engine.getState();
  if (st.status === 'ready' || st.status === 'idle') {
    coordinator.updatePreviewWindow(idx);
  }
});

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
    appState.setPendingStartIndex(idx);
    controls.setStartIndex(idx);
    modeBanner.update({ replayState: st, appState, candleStore });
    coordinator.updatePreviewWindow(idx);
  }
});

// Chart Auto-Follow Button
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
      coordinator.applyWindowedChart(idx);
      chartManager.followCurrent();
    }
    followBtn.classList.add('hidden');
  });
}

function updateRevealedMax(idx) {
  const c = candleStore.get(idx);
  if (c) chartManager.setRevealedMax(c.time);
}

// ===== 5. TRADING OVERLAYS & CHART CLICKS =====
let toastTimeout = null;
function showTradingToast(msg) {
  if (!chartToast) return;
  chartToast.textContent = msg;
  chartToast.classList.remove('hidden');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { chartToast.classList.add('hidden'); }, 2500);
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
  if (chartPosEntry) chartPosEntry.textContent = `@ $${Number(pos.entryPrice).toFixed(2)}`;
  if (chartPosPnl) {
    const pnl = Number(pos.unrealizedPnL || 0);
    chartPosPnl.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
    chartPosPnl.className = `chart-pos-pnl ${pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`;
  }
}

function syncChartTradingLines() {
  const positions = tradingEngine.getPositions();
  const activePos = positions.length > 0 ? positions[0] : null;
  chartManager.updatePositionLines(activePos);
  const pendingOrders = tradingEngine.getPendingOrders ? tradingEngine.getPendingOrders() : [];
  chartManager.updateOrderLines(pendingOrders);
  updateChartPositionPill(activePos);
}

if (btnChartClose) {
  btnChartClose.addEventListener('click', () => {
    const positions = tradingEngine.getPositions();
    if (positions.length > 0) tradingEngine.closePosition(positions[0].symbol);
  });
}

// Chart Click Handler for SL / TP / Orders
chartManager.onChartClick(({ price }) => {
  if (!Number.isFinite(price) || price <= 0) return;
  const positions = tradingEngine.getPositions();
  const activePos = positions.length > 0 ? positions[0] : null;
  const intent = chartManager.tradingOverlay.resolveClickIntent(price, activePos);
  if (!intent) return;

  if (intent.action === 'SET_TP') {
    const res = tradingEngine.setTakeProfit(intent.symbol, intent.price);
    if (res.success) {
      if (tpInput) tpInput.value = intent.price.toFixed(2);
      showTradingToast(`Take Profit set to $${intent.price.toFixed(2)}`);
    } else {
      coordinator.showTradingError(res.message);
    }
  } else if (intent.action === 'SET_SL') {
    const res = tradingEngine.setStopLoss(intent.symbol, intent.price);
    if (res.success) {
      if (slInput) slInput.value = intent.price.toFixed(2);
      showTradingToast(`Stop Loss set to $${intent.price.toFixed(2)}`);
    } else {
      coordinator.showTradingError(res.message);
    }
  } else {
    const type = orderTypeSelect ? orderTypeSelect.value : 'MARKET';
    if (type === 'LIMIT' && limitPriceInput) {
      limitPriceInput.value = intent.price.toFixed(2);
      showTradingToast(`Limit Price set to $${intent.price.toFixed(2)}`);
    } else if (type === 'STOP_MARKET' && stopPriceInput) {
      stopPriceInput.value = intent.price.toFixed(2);
      showTradingToast(`Stop Price set to $${intent.price.toFixed(2)}`);
    }
  }
  syncChartTradingLines();
  tradingPanel.render();
});

// Trading Engine Event Listeners
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
tradingEngine.on('orderFilled', (payload) => {
  syncChartTradingLines();
  const o = payload?.order ?? payload;
  if (o?.type && o.type !== 'MARKET') {
    const typeLabel = o.type === 'STOP_MARKET' ? 'Stop' : 'Limit';
    const priceStr = o.filledPrice != null ? ` @ $${Number(o.filledPrice).toFixed(2)}` : '';
    showTradingToast(`✓ ${typeLabel} ${o.side} Filled${priceStr}`);
  }
});
tradingEngine.on('orderCancelled', syncChartTradingLines);
tradingEngine.on('stopLossTriggered', (p) => {
  syncChartTradingLines();
  showTradingToast(`🛑 Stop Loss Triggered${p?.price != null ? ` @ $${Number(p.price).toFixed(2)}` : ''}`);
});
tradingEngine.on('takeProfitTriggered', (p) => {
  syncChartTradingLines();
  showTradingToast(`🎯 Take Profit Triggered${p?.price != null ? ` @ $${Number(p.price).toFixed(2)}` : ''}`);
});
tradingEngine.on('positionLiquidated', (p) => {
  syncChartTradingLines();
  showTradingToast(`⚠️ Position Liquidated${p?.liquidationPrice != null ? ` @ $${Number(p.liquidationPrice).toFixed(2)}` : ''}`);
});

// ===== 6. JUMP TO CANDLE =====
function trySeek(idx) {
  if (tradingEngine.hasOpenPosition()) {
    coordinator.showTradingError('Cannot seek while a position is open — close position first.');
    return false;
  }
  try {
    engine.seek(idx);
    return true;
  } catch (e) {
    errorPanel.showGeneric(e.message);
    return false;
  }
}

if (jumpBtn) {
  jumpBtn.addEventListener('click', () => {
    jumpError.classList.add('hidden');
    jumpError.textContent = '';
    const total = candleStore.getCount() || appState.candles.length;
    if (!total) { jumpError.textContent = 'Load data first'; jumpError.classList.remove('hidden'); return; }
    if (!jumpDateEl?.value) { jumpError.textContent = 'Select date'; jumpError.classList.remove('hidden'); return; }

    let target;
    try {
      target = toUnixSeconds(jumpDateEl.value, jumpTimeEl?.value || '00:00');
    } catch (e) {
      jumpError.textContent = e.message;
      jumpError.classList.remove('hidden');
      return;
    }

    const idx = candleStore.findIndexByTime(target);
    if (idx < 0) {
      jumpError.textContent = 'No candle found for that time';
      jumpError.classList.remove('hidden');
      return;
    }

    const st = engine.getState();
    if (st.status === 'idle' || st.status === 'ready') {
      appState.setPendingStartIndex(idx);
      controls.setStartIndex(idx);
      timeline.setPosition(idx);
      modeBanner.update({ replayState: st, appState, candleStore });
      coordinator.updatePreviewWindow(idx);
    } else if (st.status === 'playing') {
      if (!tradingEngine.canSeek()) {
        jumpError.textContent = 'Cannot jump while position open';
        jumpError.classList.remove('hidden');
        return;
      }
      try { engine.pause(); } catch {}
      trySeek(idx);
    } else if (st.status === 'paused' || st.status === 'ended') {
      trySeek(idx);
    }
  });
}

// ===== 7. HEADER START REPLAY BUTTON =====
if (headerStartReplayBtn) {
  headerStartReplayBtn.addEventListener('click', () => {
    const st = engine.getState();
    const hasData = candleStore.getCount() > 0 || appState.candles.length > 0;
    if (!hasData) {
      coordinator.loadAndPrepareReplay({ autoStart: true });
      return;
    }
    if (st.status === 'ready') {
      engine.start(appState.pendingStartIndex);
      engine.play();
    } else if (st.status === 'paused') {
      engine.play();
    } else if (st.status === 'playing') {
      engine.pause();
    } else if (st.status === 'ended') {
      engine.reset();
      engine.start(appState.pendingStartIndex);
      engine.play();
    } else {
      coordinator.loadAndPrepareReplay({ autoStart: true });
    }
  });
}

// ===== 8. ENGINE LIFECYCLE EVENTS =====
engine.on('stateChanged', (s) => {
  appState.setReplayState(s);
  if (s.currentIndex >= 0) timeline.setPosition(s.currentIndex);
  modeBanner.update({ replayState: s, appState, candleStore });

  if (headerStartReplayBtn) {
    if (s.status === 'ready') {
      headerStartReplayBtn.innerHTML = '<span class="icon">▶</span> START REPLAY';
    } else if (s.status === 'playing') {
      headerStartReplayBtn.innerHTML = '<span class="icon">⏸</span> PAUSE';
    } else if (s.status === 'paused') {
      headerStartReplayBtn.innerHTML = '<span class="icon">▶</span> RESUME';
    } else if (s.status === 'ended') {
      headerStartReplayBtn.innerHTML = '<span class="icon">↺</span> REPLAY AGAIN';
    }
  }
});

engine.on('started', (payload) => {
  const idx = payload?.index ?? appState.pendingStartIndex;
  timeline.setPosition(idx);
  updateRevealedMax(idx);
  modeBanner.update({ replayState: engine.getState(), appState, candleStore });
});

engine.on('stepped', (p) => {
  modeBanner.update({ replayState: engine.getState(), appState, candleStore });
  if (p?.index !== undefined) updateRevealedMax(p.index);
});

engine.on('seeked', (p) => {
  modeBanner.update({ replayState: engine.getState(), appState, candleStore });
  if (p?.index !== undefined) updateRevealedMax(p.index);
});

engine.on('reset', (s) => {
  if (s.status === 'ready') {
    coordinator.updatePreviewWindow(appState.pendingStartIndex);
    updateRevealedMax(appState.pendingStartIndex);
    timeline.setTotal(candleStore.getCount(), candleStore.getAll());
    if (headerStartReplayBtn) {
      headerStartReplayBtn.innerHTML = '<span class="icon">▶</span> START REPLAY';
    }
  } else if (s.index !== undefined) {
    updateRevealedMax(s.index);
  }
  modeBanner.update({ replayState: s, appState, candleStore });
});

// ===== 9. KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    const s = engine.getState();
    const hasData = candleStore.getCount() > 0 || appState.candles.length > 0;
    if (!hasData) return;
    if (s.status === 'ready') {
      engine.start(appState.pendingStartIndex);
      engine.play();
    } else if (s.status === 'paused') {
      engine.play();
    } else if (s.status === 'playing') {
      engine.pause();
    } else if (s.status === 'ended') {
      engine.reset();
      engine.start(appState.pendingStartIndex);
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
      coordinator.updatePreviewWindow(appState.pendingStartIndex);
      timeline.setTotal(candleStore.getCount(), candleStore.getAll());
      controls.setStartIndex(appState.pendingStartIndex);
    } else if (st.status === 'paused' && st.currentIndex >= 0) {
      updateRevealedMax(st.currentIndex);
      timeline.setPosition(st.currentIndex);
      coordinator.applyWindowedChart(st.currentIndex);
    }
  } else if (e.code === 'Escape') {
    const s = engine.getState();
    if (s.status === 'playing') engine.pause();
  }
});

// Legacy load button support
const loadBtn = document.getElementById('load-btn');
if (loadBtn) {
  loadBtn.addEventListener('click', () => {
    coordinator.loadAndPrepareReplay({ autoStart: false });
  });
}

// ===== 10. INITIALIZATION =====
modeBanner.update({ replayState: engine.getState(), appState, candleStore });
coordinator.loadAndPrepareReplay({ autoStart: false });
