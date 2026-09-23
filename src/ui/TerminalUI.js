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

export function createTerminalUI({ mount, replayPort, replayCommands, trading = null, tradingEvents = null, dataset = null, candles = null, chart = null, callbacks = {} }) {
  if (!mount || !replayPort || !replayCommands || !dataset || !chart?.chartManager || !chart?.adapter) throw new TypeError('createTerminalUI requires mount, replay state, commands, dataset and chart handles');
  const { onRetry = null, onFollow = null } = callbacks;
  if (!mount.querySelector('#chart-container')) throw new Error('Terminal UI layout is not mounted');
  const el = (id) => mount.querySelector('#' + id);
  const ports = createPaperPorts(el);
  const chartManager = chart.chartManager;
  const adapter = chart.adapter;
  const themeManager = new ThemeManager({ onThemeChange: (theme) => chartManager.applyTheme(theme) });
  const symbolSelector = new SymbolSelector(el('symbol-select'), dataset);
  const timeframeSelector = new TimeframeSelector(el('timeframe-select'), dataset);
  try { chartManager.init(themeManager.getTheme()); } catch (error) { console.error('Chart init failed:', error); }
  adapter.attach();
  const timeline = new Timeline({ sliderEl: el('timeline-slider'), startLabelEl: el('timeline-start-label'), currentLabelEl: el('timeline-current-label'), endLabelEl: el('timeline-end-label'), indexLabelEl: el('timeline-index-label'), timeLabelEl: el('timeline-time-label'), startIndexLabelEl: el('start-index-label'), startTimeLabelEl: el('start-time-label') });
  const controls = new ReplayControls({ playBtn: el('btn-play'), pauseBtn: el('btn-pause'), stepBtn: el('btn-step'), resetBtn: el('btn-reset'), startReplayBtn: null, speedSelect: el('speed-select'), statusEl: el('replay-status'), replayPort, commands: replayCommands, followBtn: el('btn-follow'), onFollowClick: onFollow });
  const errorPanel = new ErrorPanel({ onRetry });
  const modeBanner = new ModeBanner();
  const tradingErrorView = new TradingErrorView({ element: el('trading-error') });
  return {
    el, chartManager, adapter, symbolSelector, timeframeSelector, timeline, controls, errorPanel, themeManager, modeBanner, tradingErrorView,
    getReplayPorts: ports.replay, getOrderFormPorts: ports.orderForm,
    createTerminalViews(ctx) { return createPaperTerminalViews({ ...ctx, replayPort, trading, tradingEvents, dataset, candles, el, getSymbol: () => el('symbol-select')?.value || 'BTCUSDT' }); },
    createChartTradingController(ctx) { return new ChartTradingController({ ...ctx, getSymbol: () => el('symbol-select')?.value || 'BTCUSDT' }); },
  };
}
