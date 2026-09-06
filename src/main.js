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
} catch {}

// Clean up long-lived browser resources when the application is unloaded.
const destroyApplication = () => {
  try { unbindKeyboardShortcuts?.(); } catch {}
  try { coordinator.destroy(); } catch {}
  try { engine.destroy(); } catch {}
  try { candleCache.close(); } catch {}
};
window.addEventListener('pagehide', destroyApplication, { once: true });
window.addEventListener('beforeunload', destroyApplication, { once: true });
