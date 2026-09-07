import { ChartManager } from '../chart/ChartManager.js';
import { ChartAdapter } from '../chart/ChartAdapter.js';
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

export function createPaperUI({ engine, candleStore, appState, coordinatorRef, tradingPort = null, tradingEvents = null, tradingState = null }) {
  const mount = document.getElementById('app');
  if (!mount) throw new Error('Paper UI mount #app is missing');
  renderPaperLayout(mount);
  const el = (id) => document.getElementById(id);
  const ports = createPaperPorts(el);
  const chartManager = new ChartManager(el('chart-container'));
  const themeManager = new ThemeManager({ onThemeChange: (theme) => chartManager.applyTheme(theme) });
  const symbolSelector = new SymbolSelector(el('symbol-select'), appState);
  const timeframeSelector = new TimeframeSelector(el('timeframe-select'), appState);
  try { chartManager.init(themeManager.getTheme()); } catch (error) { console.error('Chart init failed:', error); }

  const adapter = new ChartAdapter(engine, chartManager);
  adapter.attach();
  const timeline = new Timeline({
    sliderEl: el('timeline-slider'), startLabelEl: el('timeline-start-label'), currentLabelEl: el('timeline-current-label'),
    endLabelEl: el('timeline-end-label'), indexLabelEl: el('timeline-index-label'), timeLabelEl: el('timeline-time-label'),
    startIndexLabelEl: el('start-index-label'), startTimeLabelEl: el('start-time-label'),
  });
  const controls = new ReplayControls({
    playBtn: el('btn-play'), pauseBtn: el('btn-pause'), stepBtn: el('btn-step'), resetBtn: el('btn-reset'),
    startReplayBtn: el('start-replay-btn'), speedSelect: el('speed-select'), statusEl: el('replay-status'), engine,
    followBtn: el('btn-follow'),
    onFollowClick: () => {
      const coordinator = coordinatorRef.current;
      chartManager.setAutoFollow(true);
      const idx = engine.getState().currentIndex;
      if (idx >= 0) {
        const candle = candleStore.get(idx);
        if (candle) {
          chartManager.setRevealedMax(candle.time);
          coordinator?.applyWindowedChart(idx);
          chartManager.followCurrent();
        }
      }
    },
  });
  const errorPanel = new ErrorPanel({ onRetry: () => coordinatorRef.current?.loadAndPrepareReplay({ autoStart: false }) });
  const modeBanner = new ModeBanner();
  const tradingErrorView = new TradingErrorView({ element: el('trading-error') });

  return {
    el, chartManager, adapter, symbolSelector, timeframeSelector, timeline, controls, errorPanel,
    themeManager, modeBanner, tradingErrorView, getCoordinatorPorts: ports.coordinator, getOrderFormPorts: ports.orderForm,
    createTerminalViews(ctx) { return createPaperTerminalViews({ ...ctx, tradingPort, tradingEvents, tradingState, el }); },
    createChartTradingController(ctx) { return new ChartTradingController(ctx); },
  };
}

function createPaperTerminalViews(ctx) {
  const { el, appState, candleStore, engine, tradingPort, tradingEvents, tradingState, commandController, coordinator, timeframeSelect, orderTypeSelect, limitPriceInput, stopPriceInput, slInput, tpInput } = ctx;
  const sparkline = new TimelineSparkline({ canvasEl: el('timeline-sparkline'), candleStore, engine, tradingEngine: tradingPort, tradingEvents, onSeek: (idx) => commandController.trySeek(idx) });
  const toastView = new ToastNotificationView();
  const floatingPosView = new FloatingPositionView({ tradingEngine: tradingPort });
  const dateSelector = new ReplayDateSelector({ appState, coordinator, candleStore, engine, commandController, timeframeSelect, onJump: (idx) => commandController.trySeek(idx) });
  const tradingPanel = new TradingPanel({
    tradingEngine: tradingPort, tradingEvents,
    balanceEl: el('acct-balance'), equityEl: el('acct-equity'), realizedEl: el('acct-realized'), unrealizedEl: el('acct-unrealized'), feesEl: el('acct-fees'),
    posSymbolEl: el('pos-symbol'), posSideEl: el('pos-side'), posQtyEl: el('pos-qty'), posEntryEl: el('pos-entry'), posCurrentEl: el('pos-current'), posPnlEl: el('pos-pnl'),
    qtyInput: el('trade-qty'), buyBtn: el('btn-buy'), sellBtn: el('btn-sell'), closeBtn: el('btn-close'), resetBtn: el('btn-reset-acct'),
    tradesListEl: el('trades-list'), errorEl: el('trading-error'), orderTypeSelect, limitPriceInput, stopPriceInput,
    pendingListEl: el('pending-orders-list'), posSlEl: el('pos-sl'), posTpEl: el('pos-tp'), slInput, tpInput,
    setRiskBtn: el('btn-set-risk'), clearRiskBtn: el('btn-clear-risk'),
  });
  return { sparkline, toastView, floatingPosView, dateSelector, tradingPanel, tradingState };
}
