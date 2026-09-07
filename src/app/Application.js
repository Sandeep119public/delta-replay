import { ReplayCoordinator } from './ReplayCoordinator.js';
import { ReplayCommandController } from './ReplayCommandController.js';
import { createCoreServices } from './createCoreServices.js';
import { bindReplayLifecycle } from './bindReplayLifecycle.js';
import { bindApplicationLifecycle } from './bindApplicationLifecycle.js';
import { createPaperUI } from '../ui/PaperUI.js';
import { ChartManager } from '../chart/ChartManager.js';
import { ChartAdapter } from '../chart/ChartAdapter.js';
import { bindTimelineInteractions } from '../ui/bindTimelineInteractions.js';
import { bindTradingEvents } from '../ui/bindTradingEvents.js';
import { bindMobileDrawer } from '../ui/bindMobileDrawer.js';
import { createApplicationActions } from './ApplicationActions.js';
import { createChartTradingActions } from './ChartTradingActions.js';
import { createTradingUIEvents } from './TradingUIEvents.js';
import { createTradingPresentation } from './TradingPresentationAdapter.js';
import { createDatasetView, createCandleView, createReplayStatusView } from './DatasetPresentationAdapter.js';
import { createReplayUIPort } from './ReplayUIPort.js';
import { bindTradingState } from '../ui/TradingStateBridge.js';

function registerActionGuard(engine, canTrade, reportError) {
  return engine.registerActionGuard((action) => {
    if (!canTrade()) return { allowed: true };
    const msg = action === 'load'
      ? 'Cannot load new data while a position is open — close position or reset account first.'
      : `Cannot ${action} while a position is open — close position first.`;
    reportError(msg);
    return { allowed: false, reason: msg };
  });
}

function bindDatasetSelectors(ui, actions) {
  const unbinds = [
    ui.symbolSelector.onChange((symbol) => actions.changeDataset('symbol', symbol, ui.el('symbol-select'))),
    ui.timeframeSelector.onChange((timeframe) => actions.changeDataset('timeframe', timeframe, ui.el('timeframe-select'))),
  ];
  return { destroy() { unbinds.forEach((unbind) => { try { unbind?.(); } catch {} }); } };
}

export function createApplication() {
  const services = createCoreServices();
  const { appState, candleStore, engine, candleCache, dataManager, tradingEngine } = services;
  const tradingEvents = createTradingUIEvents(tradingEngine);
  const trading = createTradingPresentation(tradingEngine);
  const replayPort = createReplayUIPort(engine);
  const dataset = createDatasetView(appState);
  const candles = createCandleView(candleStore);
  const statusView = createReplayStatusView({ engine, appState, candleStore });

  const chartManager = new ChartManager(document.getElementById('chart-container'));
  const chartAdapter = new ChartAdapter(replayPort, chartManager);

  let coordinator = null;
  let commandController = null;
  const replayCapabilities = Object.freeze({
    load: (options = {}) => coordinator?.loadAndPrepareReplay(options),
    preview: (idx) => coordinator?.updatePreviewWindow?.(idx),
    changeDataset: (kind, value, sourceEl) => coordinator?.handleSymbolTimeframeChange(kind, value, sourceEl),
  });

  const callbacks = {
    onRetry: () => replayCapabilities.load({ autoStart: false }),
    onFollow: () => {
      const idx = replayPort.getState().currentIndex;
      chartManager.setAutoFollow(true);
      if (idx >= 0) {
        const candle = candleStore.get(idx);
        if (candle) {
          chartManager.setRevealedMax(candle.time);
          coordinator?.applyWindowedChart(idx);
          chartManager.followCurrent();
        }
      }
    },
    onLoadReplay: ({ targetSec } = {}) => replayCapabilities.load({ targetSec, autoStart: false }),
    onPreviewWindow: (idx) => replayCapabilities.preview(idx),
    onSeek: (idx) => commandController?.trySeek(idx),
    onTimeframeChange: (timeframe) => { appState.timeframe = timeframe; },
  };

  const ui = createPaperUI({
    replayPort,
    trading,
    tradingEvents,
    dataset,
    candles,
    chart: { chartManager, adapter: chartAdapter },
    callbacks,
  });

  coordinator = new ReplayCoordinator({
    dataManager,
    candleStore,
    appState,
    replayEngine: engine,
    tradingEngine,
    chartManager: ui.chartManager,
    chartAdapter: ui.adapter,
    timeline: ui.timeline,
    controls: ui.controls,
    errorPanel: ui.errorPanel,
    modeBanner: ui.modeBanner,
    tradingErrorView: ui.tradingErrorView,
    ...ui.getReplayPorts(),
  });

  const coordinatorPorts = ui.getReplayPorts();
  commandController = new ReplayCommandController({
    engine,
    appState,
    candleStore,
    headerBtn: coordinatorPorts.headerStartReplayBtn,
    onLoad: ({ autoStart }) => coordinator?.loadAndPrepareReplay({ autoStart }),
    onPreview: (index) => coordinator?.updatePreviewWindow(index),
    canExecute: () => trading.actions.hasOpenPosition(),
    onError: (msg) => coordinator?.showTradingError(msg),
  });
  const unbindKeyboardShortcuts = commandController.bindKeyboardShortcuts();

  const actions = createApplicationActions({
    replay: replayCapabilities,
    commandController,
    appState,
    engine,
    statusView,
    modeBanner: ui.modeBanner,
    timeline: ui.timeline,
    controls: ui.controls,
    errorPanel: ui.errorPanel,
  });

  const form = ui.getOrderFormPorts();
  const views = ui.createTerminalViews({
    timeline: ui.timeline,
    controls: ui.controls,
    modeBanner: ui.modeBanner,
    onLoadReplay: callbacks.onLoadReplay,
    onPreviewWindow: callbacks.onPreviewWindow,
    onSeek: callbacks.onSeek,
    onTimeframeChange: callbacks.onTimeframeChange,
    ...form,
  });

  const selectorBindings = bindDatasetSelectors(ui, actions);
  const timelineBindings = bindTimelineInteractions({ timeline: ui.timeline, candles, trading, tradingEvents, actions });
  const tradingBindings = bindTradingEvents({ tradingEvents, actions, errorPanel: ui.errorPanel });
  const unbindAutoFollow = ui.chartManager.onAutoFollowChange((isFollow) => ui.controls.setAutoFollow(isFollow));
  const chartTradingActions = createChartTradingActions({
    trading,
    executeTrade: (intent) => {
      if (intent.action === 'SET_TP') return trading.actions.setTakeProfit(intent.symbol, intent.price);
      if (intent.action === 'SET_SL') return trading.actions.setStopLoss(intent.symbol, intent.price);
      return { success: true };
    },
    reportError: (message) => coordinator?.showTradingError(message),
  });
  const chartTradingController = ui.createChartTradingController({
    chartManager: ui.chartManager,
    trading,
    tradingEvents,
    tradingPanel: views.tradingPanel,
    floatingPosView: views.floatingPosView,
    toastView: views.toastView,
    orderFormView: views.tradingPanel.orderFormView,
    actions: chartTradingActions,
    ...form,
  });
  const tradingStateBridge = bindTradingState({ tradingEvents, trading, onChange: () => chartTradingController.syncChartTradingLines() });
  const replayLifecycle = bindReplayLifecycle({ engine, appState, candleStore, statusView, timeline: ui.timeline, modeBanner: ui.modeBanner, coordinator, chartManager: ui.chartManager });
  const actionGuardUnsub = registerActionGuard(engine, () => trading.actions.hasOpenPosition(), (msg) => coordinator?.showTradingError(msg));
  const loadBtn = coordinatorPorts.loadBtn;
  const onLoadClick = () => actions.load();
  loadBtn?.addEventListener('click', onLoadClick);
  const loadBinding = { destroy() { loadBtn?.removeEventListener?.('click', onLoadClick); } };
  const mobileDrawer = bindMobileDrawer();

  const destroy = bindApplicationLifecycle({
    unbindKeyboardShortcuts,
    coordinator,
    engine,
    candleCache,
    resources: [
      selectorBindings,
      timelineBindings,
      tradingBindings,
      tradingStateBridge,
      replayLifecycle,
      commandController,
      mobileDrawer,
      loadBinding,
      ui.symbolSelector,
      ui.timeframeSelector,
      ui.timeline,
      ui.controls,
      ui.themeManager,
      ui.errorPanel,
      chartTradingController,
      ui.adapter,
      ui.chartManager,
      views.tradingPanel,
      views.dateSelector,
      views.sparkline,
      views.floatingPosView,
      views.toastView,
    ],
    extraCleanup: [unbindAutoFollow, actionGuardUnsub],
  });

  let started = false;
  let destroyed = false;
  const guardedDestroy = () => {
    if (destroyed) return;
    destroyed = true;
    destroy();
  };

  return {
    start() {
      if (destroyed || started) return;
      started = true;
      ui.modeBanner.update(statusView.snapshot());
      Promise.resolve(replayCapabilities.load({ autoStart: false })).catch((error) => {
        if (!destroyed) coordinator?.showTradingError?.(error?.message || 'Failed to load replay');
      });
    },
    destroy: guardedDestroy,
    services,
    ui,
    coordinator,
  };
}
