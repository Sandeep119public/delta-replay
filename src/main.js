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
import { ReplayCoordinator } from './app/ReplayCoordinator.js';
import { ReplayCommandController } from './app/ReplayCommandController.js';
import { PaperTradingEngine, EXECUTION_TIMING } from './trading/PaperTradingEngine.js';
import { TradingIntentResolver } from './trading/TradingIntentResolver.js';
import { TradingPanel } from './ui/TradingPanel.js';
import { ToastNotificationView } from './ui/ToastNotificationView.js';
import { FloatingPositionView } from './ui/FloatingPositionView.js';
import { ReplayDateSelector } from './ui/ReplayDateSelector.js';

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

// Guard: prohibit loading or destructive changes during active position
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
const slInput = document.getElementById('sl-price');
const tpInput = document.getElementById('tp-price');
const limitPriceInput = document.getElementById('limit-price');
const stopPriceInput = document.getElementById('stop-price');
const orderTypeSelect = document.getElementById('order-type');
const loadBtn = document.getElementById('load-btn');

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

const commandController = new ReplayCommandController({
  engine,
  appState,
  candleStore,
  tradingEngine,
  coordinator,
  headerBtn: headerStartReplayBtn,
  onError: (msg) => coordinator.showTradingError(msg),
});
commandController.bindKeyboardShortcuts();

const toastView = new ToastNotificationView();
const floatingPosView = new FloatingPositionView({ tradingEngine });

const dateSelector = new ReplayDateSelector({
  appState,
  coordinator,
  candleStore,
  engine,
  commandController,
  timeframeSelect,
  onJump: (idx) => {
    const st = engine.getState();
    if (st.status === 'idle' || st.status === 'ready') {
      appState.setPendingStartIndex(idx);
      controls.setStartIndex(idx);
      timeline.setPosition(idx);
      modeBanner.update({ replayState: st, appState, candleStore });
      coordinator.updatePreviewWindow(idx);
    } else if (st.status === 'playing') {
      if (!tradingEngine.canSeek()) {
        dateSelector._showJumpError('Cannot jump while position open');
        return;
      }
      commandController.pause();
      commandController.trySeek(idx);
    } else if (st.status === 'paused' || st.status === 'ended') {
      commandController.trySeek(idx);
    }
  },
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
symbolSelector.onChange((symbol) => coordinator.handleSymbolTimeframeChange('symbol', symbol, symbolSelect));
timeframeSelector.onChange((timeframe) => coordinator.handleSymbolTimeframeChange('timeframe', timeframe, timeframeSelect));

document.querySelectorAll('.qty-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const qtyInput = document.getElementById('trade-qty');
    if (qtyInput && chip.dataset.qty) {
      qtyInput.value = chip.dataset.qty;
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
});

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
    if (st.status === 'playing') commandController.pause();
    const ok = commandController.trySeek(idx);
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

chartManager.onAutoFollowChange((isFollow) => {
  if (followBtn) followBtn.classList.toggle('hidden', isFollow);
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

// ===== 5. TRADING OVERLAY & EVENT SYNCHRONIZATION =====
function syncChartTradingLines() {
  const positions = tradingEngine.getPositions();
  const activePos = positions.length > 0 ? positions[0] : null;
  chartManager.updatePositionLines(activePos);
  const pendingOrders = tradingEngine.getPendingOrders ? tradingEngine.getPendingOrders() : [];
  chartManager.updateOrderLines(pendingOrders);
  floatingPosView.render(activePos);
}

chartManager.onChartClick(({ price }) => {
  if (!Number.isFinite(price) || price <= 0) return;
  const positions = tradingEngine.getPositions();
  const activePos = positions.length > 0 ? positions[0] : null;
  const intent = TradingIntentResolver.resolveClickIntent(price, activePos);
  if (!intent) return;

  if (intent.action === 'SET_TP') {
    const res = tradingEngine.setTakeProfit(intent.symbol, intent.price);
    if (res.success) {
      if (tpInput) tpInput.value = intent.price.toFixed(2);
      toastView.show(`Take Profit set to $${intent.price.toFixed(2)}`);
    } else {
      coordinator.showTradingError(res.message);
    }
  } else if (intent.action === 'SET_SL') {
    const res = tradingEngine.setStopLoss(intent.symbol, intent.price);
    if (res.success) {
      if (slInput) slInput.value = intent.price.toFixed(2);
      toastView.show(`Stop Loss set to $${intent.price.toFixed(2)}`);
    } else {
      coordinator.showTradingError(res.message);
    }
  } else {
    const type = orderTypeSelect ? orderTypeSelect.value : 'MARKET';
    if (type === 'LIMIT' && limitPriceInput) {
      limitPriceInput.value = intent.price.toFixed(2);
      toastView.show(`Limit Price set to $${intent.price.toFixed(2)}`);
    } else if (type === 'STOP_MARKET' && stopPriceInput) {
      stopPriceInput.value = intent.price.toFixed(2);
      toastView.show(`Stop Price set to $${intent.price.toFixed(2)}`);
    }
  }
  syncChartTradingLines();
  tradingPanel.render();
});

tradingEngine.on('positionOpened', syncChartTradingLines);
tradingEngine.on('positionUpdated', syncChartTradingLines);
tradingEngine.on('positionClosed', () => {
  chartManager.updatePositionLines(null);
  floatingPosView.render(null);
  syncChartTradingLines();
});
tradingEngine.on('accountReset', () => {
  chartManager.clearTradingLines();
  floatingPosView.render(null);
});
tradingEngine.on('orderPlaced', syncChartTradingLines);
tradingEngine.on('orderTriggered', syncChartTradingLines);
tradingEngine.on('orderFilled', (payload) => {
  syncChartTradingLines();
  const o = payload?.order ?? payload;
  if (o?.type && o.type !== 'MARKET') {
    const typeLabel = o.type === 'STOP_MARKET' ? 'Stop' : 'Limit';
    const priceStr = o.filledPrice != null ? ` @ $${Number(o.filledPrice).toFixed(2)}` : '';
    toastView.show(`✓ ${typeLabel} ${o.side} Filled${priceStr}`);
  }
});
tradingEngine.on('orderCancelled', syncChartTradingLines);
tradingEngine.on('stopLossTriggered', (p) => {
  syncChartTradingLines();
  toastView.show(`🛑 Stop Loss Triggered${p?.price != null ? ` @ $${Number(p.price).toFixed(2)}` : ''}`);
});
tradingEngine.on('takeProfitTriggered', (p) => {
  syncChartTradingLines();
  toastView.show(`🎯 Take Profit Triggered${p?.price != null ? ` @ $${Number(p.price).toFixed(2)}` : ''}`);
});
tradingEngine.on('positionLiquidated', (p) => {
  syncChartTradingLines();
  toastView.show(`⚠️ Position Liquidated${p?.liquidationPrice != null ? ` @ $${Number(p.liquidationPrice).toFixed(2)}` : ''}`);
});

// ===== 6. ENGINE LIFECYCLE EVENTS =====
engine.on('stateChanged', (s) => {
  appState.setReplayState(s);
  if (s.currentIndex >= 0) timeline.setPosition(s.currentIndex);
  modeBanner.update({ replayState: s, appState, candleStore });
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
  } else if (s.index !== undefined) {
    updateRevealedMax(s.index);
  }
  modeBanner.update({ replayState: s, appState, candleStore });
});

if (loadBtn) {
  loadBtn.addEventListener('click', () => coordinator.loadAndPrepareReplay({ autoStart: false }));
}

// ===== 7. BOOTSTRAP =====
modeBanner.update({ replayState: engine.getState(), appState, candleStore });
coordinator.loadAndPrepareReplay({ autoStart: false });
