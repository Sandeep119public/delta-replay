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
import { ChartTradingController } from './ui/ChartTradingController.js';
import { ThemeManager } from './ui/ThemeManager.js';
import { TradingEvents } from './trading/TradingEvents.js';
import { ReplayEvents } from './replay/ReplayEvents.js';
import { Router, router } from './router/Router.js';
import { Navigation } from './ui/Navigation.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { StrategiesPage } from './pages/StrategiesPage.js';
import { JournalPage } from './pages/JournalPage.js';
import { PersonalityWidget } from './ui/PersonalityWidget.js';
import { Persona } from './personality/Persona.js';

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
const themeSelect = document.getElementById('theme-select');

// ===== 3. COMPONENT INSTANTIATION =====
const chartManager = new ChartManager(chartContainer);
const themeManager = new ThemeManager({
  selectEl: themeSelect,
  defaultTheme: 'dark',
  onThemeChange: (theme) => chartManager.applyTheme(theme),
});

const symbolSelector = new SymbolSelector(symbolSelect, appState);
const timeframeSelector = new TimeframeSelector(timeframeSelect, appState);
try { chartManager.init(themeManager.getTheme()); } catch (e) { console.error('Chart init failed:', e); }

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
  followBtn,
  onFollowClick: () => {
    chartManager.setAutoFollow(true);
    const idx = engine.getState().currentIndex;
    if (idx >= 0) {
      const c = candleStore.get(idx);
      if (c) chartManager.setRevealedMax(c.time);
      coordinator.applyWindowedChart(idx);
      chartManager.followCurrent();
    }
  },
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

timeline.onChange((idx) => {
  appState.setPendingStartIndex(idx);
  controls.setStartIndex(idx);
  modeBanner.update({ replayState: engine.getState(), appState, candleStore });
  const st = engine.getState();
  if (st.status === 'ready' || st.status === 'idle') {
    coordinator.updatePreviewWindow(idx);
  }
});

timeline.onCommit((idx) => {
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
  controls.setAutoFollow(isFollow);
});

function updateRevealedMax(idx) {
  const c = candleStore.get(idx);
  if (c) chartManager.setRevealedMax(c.time);
}

// ===== 5. TRADING OVERLAY & EVENT SYNCHRONIZATION =====
const chartTradingController = new ChartTradingController({
  chartManager,
  tradingEngine,
  tradingPanel,
  floatingPosView,
  toastView,
  orderFormView: tradingPanel.orderFormView,
  coordinator,
  slInput,
  tpInput,
  limitPriceInput,
  stopPriceInput,
  orderTypeSelect,
});

// ===== 6. ENGINE LIFECYCLE EVENTS =====
engine.on(ReplayEvents.STATE_CHANGED, (s) => {
  appState.setReplayState(s);
  if (s.currentIndex >= 0) timeline.setPosition(s.currentIndex);
  modeBanner.update({ replayState: s, appState, candleStore });
});

engine.on(ReplayEvents.STARTED, (payload) => {
  const idx = payload?.index ?? appState.pendingStartIndex;
  timeline.setPosition(idx);
  updateRevealedMax(idx);
  modeBanner.update({ replayState: engine.getState(), appState, candleStore });
});

engine.on(ReplayEvents.STEPPED, (p) => {
  modeBanner.update({ replayState: engine.getState(), appState, candleStore });
  if (p?.index !== undefined) updateRevealedMax(p.index);
});

engine.on(ReplayEvents.SEEKED, (p) => {
  modeBanner.update({ replayState: engine.getState(), appState, candleStore });
  if (p?.index !== undefined) updateRevealedMax(p.index);
});

engine.on(ReplayEvents.RESET, (s) => {
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

// ===== 8. NAVIGATION, MULTI-PAGE ROUTER & PERSONALITY =====
const navigation = new Navigation();

const dashboardPage = new DashboardPage(tradingEngine);
const strategiesPage = new StrategiesPage();
const journalPage = new JournalPage(tradingEngine);

router.register('replay', null);
router.register('dashboard', DashboardPage);
router.register('analytics', null);
router.register('strategies', StrategiesPage);
router.register('journal', JournalPage);
router.register('settings', null);

// Initialize personality assistant
const persona = new Persona();
const personalityWidget = new PersonalityWidget(persona);
if (document.body) {
  document.body.appendChild(personalityWidget.getElement());
}

// React to closed trades
const onTradeExecuted = (payload) => {
  const trade = payload?.trade || payload;
  const pnl = trade?.netPnL ?? trade?.realizedPnL ?? trade?.pnl ?? 0;
  const result = pnl >= 0 ? 'win' : 'loss';
  personalityWidget.reactToTrade(result, trade?.symbol || 'BTCUSDT', pnl);
};
tradingEngine.on(TradingEvents.TRADE_EXECUTED, onTradeExecuted);
tradingEngine.on('trade-executed', onTradeExecuted);
tradingEngine.on(TradingEvents.POSITION_CLOSED, onTradeExecuted);

// Page change event listener
window.addEventListener('pagechange', (e) => {
  const { page } = e.detail;
  if (page === 'dashboard') {
    dashboardPage.render();
  } else if (page === 'strategies') {
    strategiesPage.render();
  } else if (page === 'journal') {
    journalPage.render();
  } else if (page === 'analytics') {
    renderAnalyticsCharts();
  } else if (page === 'replay') {
    try {
      chartManager.chart?.applyOptions({});
    } catch (_) {}
  }
});

// Setup Settings Page
function setupSettings() {
  document.querySelectorAll('.theme-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const theme = pill.dataset.theme;
      if (theme) {
        themeManager.setTheme(theme);
        document.querySelectorAll('.theme-pill').forEach(p => p.classList.toggle('active', p === pill));
      }
    });
  });

  const compactSwitch = document.getElementById('setting-compact');
  compactSwitch?.addEventListener('change', (e) => {
    document.body.classList.toggle('compact-mode', e.target.checked);
  });

  const animSwitch = document.getElementById('setting-animations');
  animSwitch?.addEventListener('change', (e) => {
    document.body.classList.toggle('no-animations', !e.target.checked);
  });

  const autoscrollSwitch = document.getElementById('setting-autoscroll');
  autoscrollSwitch?.addEventListener('change', (e) => {
    chartManager.setAutoFollow(e.target.checked);
  });

  const clearCacheBtn = document.getElementById('btn-clear-cache');
  clearCacheBtn?.addEventListener('click', async () => {
    try {
      await candleCache.clear?.();
      toastView.showToast('Cache cleared successfully', 'success');
    } catch (err) {
      toastView.showToast('Failed to clear cache: ' + err.message, 'error');
    }
  });

  const exportBtn = document.getElementById('btn-export');
  exportBtn?.addEventListener('click', () => {
    const trades = tradingEngine.getTradeHistory?.() || [];
    if (trades.length === 0) {
      toastView.showToast('No trades to export', 'info');
      return;
    }
    const headers = ['id', 'symbol', 'side', 'quantity', 'entryPrice', 'exitPrice', 'realizedPnL', 'netPnL', 'openedAt', 'closedAt', 'exitReason'];
    const rows = trades.map(t => [
      t.id, t.symbol, t.side, t.quantity, t.entryPrice, t.exitPrice,
      t.realizedPnL ?? t.netPnL ?? 0, t.netPnL ?? 0,
      t.openedAt, t.closedAt, t.exitReason || 'MARKET'
    ].map(v => JSON.stringify(v ?? '')).join(','));
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `delta-replay-trades-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toastView.showToast(`Exported ${trades.length} trades to CSV`, 'success');
  });
}
setupSettings();

function renderAnalyticsCharts() {
  const drawBarChart = (canvasId, labels, values, color = '#3B82F6') => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.parentElement?.clientWidth || 360;
    canvas.height = 180;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = (max - min) || 1;
    const barWidth = Math.max(12, (canvas.width - 60) / labels.length - 8);
    labels.forEach((label, i) => {
      const x = 30 + i * (barWidth + 8);
      const val = values[i] || 0;
      const barHeight = (Math.abs(val) / range) * (canvas.height - 50);
      const y = canvas.height - 30 - barHeight;
      ctx.fillStyle = val >= 0 ? color : '#EF4444';
      ctx.fillRect(x, y, barWidth, barHeight);
      ctx.fillStyle = '#8a93a6';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, x + barWidth / 2, canvas.height - 12);
    });
  };

  drawBarChart('day-performance-chart', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], [120, -40, 85, 210, -30, 95, 150]);
  drawBarChart('hour-performance-chart', ['00h', '04h', '08h', '12h', '16h', '20h'], [40, 110, -20, 160, 90, 75]);
  drawBarChart('winloss-chart', ['Wins', 'Losses', 'Breakeven'], [14, 8, 2], '#10B981');
  drawBarChart('drawdown-chart', ['T1', 'T2', 'T3', 'T4', 'T5'], [-1.2, -3.4, -0.8, -2.1, -0.5], '#EF4444');
}

// Router init
router.init();

