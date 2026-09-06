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
import { TimelineSparkline } from './ui/TimelineSparkline.js';
import { ReplayControls } from './ui/ReplayControls.js';
import { ErrorPanel } from './ui/ErrorPanel.js';
import { ModeBanner } from './ui/ModeBanner.js';
import { ReplayCoordinator } from './app/ReplayCoordinator.js';
import { ReplayCommandController } from './app/ReplayCommandController.js';
import { PaperTradingEngine, EXECUTION_TIMING } from './trading/PaperTradingEngine.js';
import { TradingPanel } from './ui/TradingPanel.js';
import { ToastNotificationView } from './ui/ToastNotificationView.js';
import { FloatingPositionView } from './ui/FloatingPositionView.js';
import { ReplayDateSelector } from './ui/ReplayDateSelector.js';
import { ChartTradingController } from './ui/ChartTradingController.js';
import { ThemeManager } from './ui/ThemeManager.js';
import { TradingEvents } from './trading/TradingEvents.js';
import { ReplayEvents } from './replay/ReplayEvents.js';
import { TradingErrorView } from './ui/TradingErrorView.js';

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
const tradingErrorEl = document.getElementById('trading-error');

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
const tradingErrorView = new TradingErrorView({ element: tradingErrorEl });

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
  tradingErrorView,
  dataStatusEl: document.getElementById('data-status'),
  cacheBadgeEl: document.getElementById('cache-badge'),
  startReplayBtn,
  headerStartReplayBtn,
  loadBtn,
  fromDateEl: document.getElementById('from-date'),
  fromTimeEl: document.getElementById('from-time'),
  toDateEl: document.getElementById('to-date'),
  toTimeEl: document.getElementById('to-time'),
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

const commandController = new ReplayCommandController({
  engine,
  appState,
  candleStore,
  tradingEngine,
  coordinator,
  headerBtn: headerStartReplayBtn,
  onError: (msg) => coordinator.showTradingError(msg),
});
const unbindKeyboardShortcuts = commandController.bindKeyboardShortcuts();

// ===== 4. UI BOOTSTRAP: trading terminal, timeline, chart overlays =====
// Guard: prohibit loading or destructive changes during active position.
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

// Contextual sparkline scrubber: click a pip/setup to jump there.
const sparklineEl = document.getElementById('timeline-sparkline');
const sparkline = new TimelineSparkline({
  canvasEl: sparklineEl,
  candleStore,
  engine,
  tradingEngine,
  onSeek: (idx) => {
    const st = engine.getState();
    if (st.status === 'paused' || st.status === 'playing' || st.status === 'ended') {
      if (st.status === 'playing') commandController.pause();
      const ok = commandController.trySeek(idx);
      if (!ok) timeline.setPosition(st.currentIndex);
    } else {
      appState.setPendingStartIndex(idx);
      controls.setStartIndex(idx);
      modeBanner.update({ replayState: st, appState, candleStore });
      coordinator.updatePreviewWindow(idx);
      timeline.setPosition(idx);
    }
  },
});

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
        coordinator.showTradingError('Cannot jump while position open');
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

// Dataset selectors drive reloads through the coordinator.
symbolSelector.onChange((symbol) => coordinator.handleSymbolTimeframeChange('symbol', symbol, symbolSelect));
timeframeSelector.onChange((timeframe) => coordinator.handleSymbolTimeframeChange('timeframe', timeframe, timeframeSelect));

// Timeline scrub: preview before start, seek during replay.
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

// Chart-first entry point: scrub the timeline, then "Start here".
timeline.onStartHere((idx) => {
  const n = Number(idx);
  if (!Number.isFinite(n) || n < 0) return;
  appState.setPendingStartIndex(n);
  controls.setStartIndex(n);
  try {
    commandController.startAt?.(n) ?? engine.start(n);
  } catch (e) {
    coordinator.showTradingError(e?.message || 'Cannot start replay here');
  }
});

// Timeline trade markers: map each closed trade to its entry candle index.
function refreshTimelineMarkers() {
  try {
    const trades = tradingEngine.getTrades?.() || [];
    if (!trades.length || !candleStore.getCount()) { timeline.setMarkers([]); return; }
    const markers = [];
    const all = candleStore.getAll?.() || [];
    for (const t of trades) {
      const ts = t.openedAt ?? t.entryTime ?? t.time;
      let index = -1;
      if (Number.isInteger(t.entryIndex)) index = t.entryIndex;
      else if (Number.isFinite(ts)) {
        let lo = 0, hi = all.length - 1;
        while (lo <= hi) {
          const mid = lo + Math.floor((hi - lo) / 2);
          if (all[mid].time <= ts) { index = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        if (index < 0) index = 0;
      }
      if (index >= 0) markers.push({ index, side: t.side });
    }
    timeline.setMarkers(markers);
  } catch (error) {
    console.warn('[Timeline] marker refresh failed', error);
  }
}
tradingEngine.on(TradingEvents.TRADE_EXECUTED, refreshTimelineMarkers);
tradingEngine.on(TradingEvents.POSITION_CLOSED, refreshTimelineMarkers);

// Critical financial errors pause the replay so the trader sees them.
tradingEngine.on(TradingEvents.POSITION_LIQUIDATED, (payload) => {
  try { commandController.pause(); } catch (error) { console.warn('[Replay] pause failed', error); }
  errorPanel.show(
    { category: 'LIQUIDATION', userMessage: `Position liquidated: ${payload?.symbol || ''} @ ${payload?.liquidationPrice ?? '—'}`, message: 'Position liquidated', code: 'LIQUIDATION', context: {} },
    { severity: 'critical', onPause: () => { try { commandController.pause(); } catch {} } },
  );
});
tradingEngine.on(TradingEvents.ORDER_REJECTED, (err) => {
  errorPanel.show(
    { category: 'ORDER', userMessage: err?.message || 'Order rejected', message: err?.message || 'Order rejected', code: err?.code || 'ORDER_REJECTED', context: {} },
    { severity: 'error', pauseReplay: false },
  );
});

chartManager.onAutoFollowChange((isFollow) => {
  controls.setAutoFollow(isFollow);
});

function updateRevealedMax(idx) {
  const c = candleStore.get(idx);
  if (c) chartManager.setRevealedMax(c.time);
}

// ===== 5. TRADING OVERLAY & ENGINE LIFECYCLE =====
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

// ===== 6. BOOTSTRAP =====
modeBanner.update({ replayState: engine.getState(), appState, candleStore });
coordinator.loadAndPrepareReplay({ autoStart: false });

// Mobile trading drawer (bottom sheet on <=768px): FAB toggle, scrim dismiss,
// and swipe-down-to-dismiss with native-app feel.
try {
  const drawerBtn = document.getElementById('btn-trading-drawer');
  const scrim = document.getElementById('drawer-scrim');
  const tradingPanelEl = document.getElementById('trading-panel');
  const setDrawer = (open) => {
    document.body.classList.toggle('drawer-open', !!open);
    if (drawerBtn) drawerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  if (drawerBtn) drawerBtn.addEventListener('click', () => setDrawer(!document.body.classList.contains('drawer-open')));
  if (scrim) scrim.addEventListener('click', () => setDrawer(false));
  if (tradingPanelEl) {
    let swipeStartY = null;
    tradingPanelEl.addEventListener('touchstart', (e) => {
      const touch = e?.touches?.[0];
      swipeStartY = touch && Number.isFinite(touch.clientY) ? touch.clientY : null;
    }, { passive: true });
    tradingPanelEl.addEventListener('touchend', (e) => {
      if (swipeStartY === null) return;
      const touch = e?.changedTouches?.[0];
      const endY = touch && Number.isFinite(touch.clientY) ? touch.clientY : null;
      const startY = swipeStartY;
      swipeStartY = null;
      if (endY === null) return;
      if (endY - startY > 80 && document.body.classList.contains('drawer-open')) setDrawer(false);
    }, { passive: true });
  }
} catch (error) {
  console.warn('[Mobile drawer] setup failed', error);
}

// Clean up long-lived browser resources when the application is unloaded.
let destroyed = false;
const destroyApplication = () => {
  if (destroyed) return;
  destroyed = true;
  try { unbindKeyboardShortcuts?.(); } catch (error) { console.warn('[App] keyboard cleanup failed', error); }
  try { coordinator.destroy(); } catch (error) { console.warn('[App] coordinator cleanup failed', error); }
  try { engine.destroy(); } catch (error) { console.warn('[App] engine cleanup failed', error); }
  try { candleCache.close(); } catch (error) { console.warn('[App] cache cleanup failed', error); }
};
window.addEventListener('pagehide', destroyApplication, { once: true });
