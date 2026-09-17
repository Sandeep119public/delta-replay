import { ChartTradingController } from './ChartTradingController.js';
import { SymbolSelector } from './SymbolSelector.js';
import { TimeframeSelector } from './TimeframeSelector.js';
import { Timeline } from './Timeline.js';
import { ReplayControls } from './ReplayControls.js';
import { ErrorPanel } from './ErrorPanel.js';
import { ModeBanner } from './ModeBanner.js';
import { ThemeManager } from './ThemeManager.js';
import { TradingErrorView } from './TradingErrorView.js';
import { createPaperPorts } from './paper/PaperPorts.js';
import { createPaperTerminalViews } from './createPaperTerminalViews.js';

export function createPaperUI({
  mount,
  replayPort,
  trading = null,
  tradingEvents = null,
  dataset = null,
  candles = null,
  chart = null,
  callbacks = {},
}) {
  if (!mount) throw new TypeError('createPaperUI requires mount');
  if (!replayPort) throw new TypeError('createPaperUI requires replayPort');
  if (!dataset) throw new TypeError('createPaperUI requires dataset view');
  if (!chart?.chartManager || !chart?.adapter) throw new TypeError('createPaperUI requires chart handles { chartManager, adapter }');
  const { onRetry = null, onFollow = null } = callbacks;
  if (!mount.querySelector('#chart-container')) throw new Error('Paper UI layout is not mounted');
  const doc = mount.ownerDocument || globalThis.document;
  const el = (id) => mount.querySelector(`#${id}`) || doc?.getElementById?.(id);
  const getSymbol = () => el('symbol-select')?.value || 'BTCUSDT';
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
      return createPaperTerminalViews({ ...ctx, replayPort, trading, tradingEvents, dataset, candles, el, getSymbol });
    },
    createChartTradingController(ctx) {
      return new ChartTradingController({ ...ctx, getSymbol });
    },
  };
}
