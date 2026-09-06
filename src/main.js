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

import { createCoreServices } from './app/createCoreServices.js';
import { bindApplicationLifecycle } from './app/bindApplicationLifecycle.js';
import { bindMobileDrawer } from './app/bindMobileDrawer.js';
import { bindTimelineInteractions } from './app/bindTimelineInteractions.js';
import { bindTradingEvents } from './app/bindTradingEvents.js';
import { bindReplayLifecycle } from './app/bindReplayLifecycle.js';
import { createTerminalViews } from './app/createTerminalViews.js';

const { appState, candleStore, engine, candleCache, dataManager, tradingEngine } = createCoreServices();

// ===== DOM REFERENCES =====
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

// ===== 4. UI BOOTSTRAP =====
const { sparkline, toastView, floatingPosView, dateSelector, tradingPanel } = createTerminalViews({ appState, candleStore, engine, tradingEngine, commandController, coordinator, timeline, controls, modeBanner, timeframeSelect, orderTypeSelect, limitPriceInput, stopPriceInput, slInput, tpInput });

// Dataset selectors drive reloads through the coordinator.
symbolSelector.onChange((symbol) => coordinator.handleSymbolTimeframeChange('symbol', symbol, symbolSelect));
timeframeSelector.onChange((timeframe) => coordinator.handleSymbolTimeframeChange('timeframe', timeframe, timeframeSelect));

// Timeline interaction ownership lives in src/app/bindTimelineInteractions.js.
bindTimelineInteractions({ timeline, controls, appState, engine, candleStore, tradingEngine, commandController, coordinator, modeBanner });
bindTradingEvents({ tradingEngine, commandController, errorPanel });

chartManager.onAutoFollowChange((isFollow) => controls.setAutoFollow(isFollow));

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

bindReplayLifecycle({ engine, appState, candleStore, timeline, modeBanner, coordinator, chartManager });

if (loadBtn) {
  loadBtn.addEventListener('click', () => coordinator.loadAndPrepareReplay({ autoStart: false }));
}

// ===== 6. BOOTSTRAP =====
modeBanner.update({ replayState: engine.getState(), appState, candleStore });
coordinator.loadAndPrepareReplay({ autoStart: false });

// Mobile trading drawer.
bindMobileDrawer();

// Clean up long-lived browser resources.
bindApplicationLifecycle({ unbindKeyboardShortcuts, coordinator, engine, candleCache });
