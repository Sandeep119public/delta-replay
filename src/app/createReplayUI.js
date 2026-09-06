import { ChartManager } from '../chart/ChartManager.js';
import { ChartAdapter } from '../chart/ChartAdapter.js';
import { SymbolSelector } from '../ui/SymbolSelector.js';
import { TimeframeSelector } from '../ui/TimeframeSelector.js';
import { Timeline } from '../ui/Timeline.js';
import { ReplayControls } from '../ui/ReplayControls.js';
import { ErrorPanel } from '../ui/ErrorPanel.js';
import { ModeBanner } from '../ui/ModeBanner.js';
import { ThemeManager } from '../ui/ThemeManager.js';
import { TradingErrorView } from '../ui/TradingErrorView.js';

export function createReplayUI({ engine, candleStore, appState, coordinatorRef }) {
  const el = (id) => document.getElementById(id);
  const chartManager = new ChartManager(el('chart-container'));
  const themeManager = new ThemeManager({ selectEl: el('theme-select'), defaultTheme: 'dark', onThemeChange: (theme) => chartManager.applyTheme(theme) });
  const symbolSelector = new SymbolSelector(el('symbol-select'), appState);
  const timeframeSelector = new TimeframeSelector(el('timeframe-select'), appState);
  try { chartManager.init(themeManager.getTheme()); } catch (error) { console.error('Chart init failed:', error); }
  const adapter = new ChartAdapter(engine, chartManager); adapter.attach();
  const timeline = new Timeline({ sliderEl: el('timeline-slider'), startLabelEl: el('timeline-start-label'), currentLabelEl: el('timeline-current-label'), endLabelEl: el('timeline-end-label'), indexLabelEl: el('timeline-index-label'), timeLabelEl: el('timeline-time-label'), startIndexLabelEl: el('start-index-label'), startTimeLabelEl: el('start-time-label') });
  const controls = new ReplayControls({ playBtn: el('btn-play'), pauseBtn: el('btn-pause'), stepBtn: el('btn-step'), resetBtn: el('btn-reset'), startReplayBtn: el('start-replay-btn'), speedSelect: el('speed-select'), statusEl: el('replay-status'), engine, followBtn: el('btn-follow'), onFollowClick: () => { const coordinator = coordinatorRef.current; chartManager.setAutoFollow(true); const idx = engine.getState().currentIndex; if (idx >= 0) { const candle = candleStore.get(idx); if (candle) chartManager.setRevealedMax(candle.time); coordinator?.applyWindowedChart(idx); chartManager.followCurrent(); } } });
  const errorPanel = new ErrorPanel({ onRetry: () => coordinatorRef.current?.loadAndPrepareReplay({ autoStart: false }) });
  return { el, chartManager, adapter, symbolSelector, timeframeSelector, timeline, controls, errorPanel, modeBanner: new ModeBanner(), tradingErrorView: new TradingErrorView({ element: el('trading-error') }) };
}
