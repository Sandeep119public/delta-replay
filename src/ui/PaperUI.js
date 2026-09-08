import { ChartTradingController } from './ChartTradingController.js';
import { SymbolSelector } from './SymbolSelector.js';
import { TimeframeSelector } from './TimeframeSelector.js';
import { Timeline } from './Timeline.js';
import { ReplayControls } from './ReplayControls.js';
import { ErrorPanel } from './ErrorPanel.js';
import { ModeBanner } from './ModeBanner.js';
import { ThemeManager } from './ThemeManager.js';
import { TradingErrorView } from './TradingErrorView.js';
import { TimelineSparkline } from './TimelineSparkline.js';
import { ToastNotificationView } from './ToastNotificationView.js';
import { FloatingPositionView } from './FloatingPositionView.js';
import { ReplayDateSelector } from './ReplayDateSelector.js';
import { TradingPanel } from './TradingPanel.js';
import { renderPaperLayout } from './paper/PaperLayout.js';
import { createPaperPorts } from './paper/PaperPorts.js';

export function createPaperUI({
  replayPort,
  trading = null,
  tradingEvents = null,
  dataset = null,
  candles = null,
  chart = null,
  callbacks = {},
}) {
  if (!replayPort) throw new TypeError('createPaperUI requires replayPort');
  if (!dataset) throw new TypeError('createPaperUI requires dataset view');
  if (!chart?.chartManager || !chart?.adapter) {
    throw new TypeError('createPaperUI requires chart handles { chartManager, adapter }');
  }
  const { onRetry = null, onFollow = null } = callbacks;
  const mount = document.getElementById('app');
  if (!mount) throw new Error('Paper UI mount #app is missing');
  if (!mount.querySelector('#chart-container')) renderPaperLayout(mount);
  const el = (id) => document.getElementById(id);
  const ports = createPaperPorts(el);
  const chartManager = chart.chartManager;
  const adapter = chart.adapter;
  const themeManager = new ThemeManager({ onThemeChange: (theme) => chartManager.applyTheme(theme) });
  const symbolSelector = new SymbolSelector(el('symbol-select'), dataset);
  const timeframeSelector = new TimeframeSelector(el('timeframe-select'), dataset);
  try {
    chartManager.init(themeManager.getTheme());
  } catch (error) {
    console.error('Chart init failed:', error);
  }

  adapter.attach();

  const timeline = new Timeline({
    sliderEl: el('timeline-slider'),
    startLabelEl: el('timeline-start-label'),
    currentLabelEl: el('timeline-current-label'),
    endLabelEl: el('timeline-end-label'),
    indexLabelEl: el('timeline-index-label'),
    timeLabelEl: el('timeline-time-label'),
    startIndexLabelEl: el('start-index-label'),
    startTimeLabelEl: el('start-time-label'),
  });

  const controls = new ReplayControls({
    playBtn: el('btn-play'),
    pauseBtn: el('btn-pause'),
    stepBtn: el('btn-step'),
    resetBtn: el('btn-reset'),
    startReplayBtn: el('start-replay-btn'),
    speedSelect: el('speed-select'),
    statusEl: el('replay-status'),
    replayPort,
    followBtn: el('btn-follow'),
    onFollowClick: onFollow,
  });

  const errorPanel = new ErrorPanel({ onRetry });
  const modeBanner = new ModeBanner();
  const tradingErrorView = new TradingErrorView({ element: el('trading-error') });

  return {
    el,
    chartManager,
    adapter,
    symbolSelector,
    timeframeSelector,
    timeline,
    controls,
    errorPanel,
    themeManager,
    modeBanner,
    tradingErrorView,
    getReplayPorts: ports.replay,
    getOrderFormPorts: ports.orderForm,
    createTerminalViews(ctx) {
      return createPaperTerminalViews({
        ...ctx, replayPort, trading, tradingEvents, dataset, candles, el,
      });
    },
    createChartTradingController(ctx) {
      return new ChartTradingController(ctx);
    },
  };
}

function createPaperTerminalViews(ctx) {
  const {
    el,
    dataset,
    candles,
    replayPort,
    trading,
    tradingEvents,
    onLoadReplay = null,
    onPreviewWindow = null,
    onSeek = null,
    onTimeframeChange = null,
    timeframeSelect,
    orderTypeSelect,
    limitPriceInput,
    stopPriceInput,
    slInput,
    tpInput,
  } = ctx;

  const sparkline = new TimelineSparkline({
    canvasEl: el('timeline-sparkline'),
    candles,
    replay: replayPort,
    trading,
    tradingEvents,
    onSeek,
  });
  const toastView = new ToastNotificationView();
  const floatingPosView = new FloatingPositionView({ trading });
  const dateSelector = new ReplayDateSelector({
    dataset,
    candles,
    replay: replayPort,
    timeframeSelect,
    onLoadReplay,
    onPreviewWindow,
    onSeek,
    onTimeframeChange,
    onJump: onSeek,
  });
  const tradingPanel = new TradingPanel({
    trading,
    tradingEvents,
    balanceEl: el('acct-balance'),
    equityEl: el('acct-equity'),
    realizedEl: el('acct-realized'),
    unrealizedEl: el('acct-unrealized'),
    feesEl: el('acct-fees'),
    posSymbolEl: el('pos-symbol'),
    posSideEl: el('pos-side'),
    posQtyEl: el('pos-qty'),
    posEntryEl: el('pos-entry'),
    posCurrentEl: el('pos-current'),
    posPnlEl: el('pos-pnl'),
    qtyInput: el('trade-qty'),
    buyBtn: el('btn-buy'),
    sellBtn: el('btn-sell'),
    closeBtn: el('btn-close'),
    resetBtn: el('btn-reset-acct'),
    tradesListEl: el('trades-list'),
    errorEl: el('trading-error'),
    orderTypeSelect: orderTypeSelect || el('order-type'),
    limitPriceInput: limitPriceInput || el('limit-price'),
    stopPriceInput: stopPriceInput || el('stop-price'),
    limitPriceRow: el('limit-price-row'),
    stopPriceRow: el('stop-price-row'),
    advancedToggle: el('advanced-toggle'),
    pendingListEl: el('pending-orders-list'),
    posSlEl: el('pos-sl'),
    posTpEl: el('pos-tp'),
    slInput: slInput || el('sl-price'),
    tpInput: tpInput || el('tp-price'),
    setRiskBtn: el('btn-set-risk'),
    clearRiskBtn: el('btn-clear-risk'),
  });

  return { sparkline, toastView, floatingPosView, dateSelector, tradingPanel };
}
