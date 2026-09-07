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
import { createTradingUIState } from './TradingUIState.js';
import { createTradingUIEvents } from './TradingUIEvents.js';
import { createTradingUIPort } from './TradingUIPort.js';
import { createTradingPresentation } from './TradingPresentationAdapter.js';
import { createDatasetView, createCandleView, createReplayStatusView } from './DatasetPresentationAdapter.js';
import { createReplayUIPort } from './ReplayUIPort.js';
import { bindTradingState } from '../ui/TradingStateBridge.js';

function registerActionGuard(engine, tradingEngine, coordinator) {
  return engine.registerActionGuard((action) => {
    if (!tradingEngine.hasOpenPosition()) return { allowed: true };
    const msg = action === 'load'
      ? 'Cannot load new data while a position is open — close position or reset account first.'
      : `Cannot ${action} while a position is open — close position first.`;
    coordinator.showTradingError(msg);
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
  const tradingState = createTradingUIState(tradingEngine);
  const tradingEvents = createTradingUIEvents(tradingEngine);
  // Narrow intent-shaped trading contract for presentation. The legacy
  // engine-shaped facade is retained only for backward compatibility.
  const trading = createTradingPresentation(tradingEngine);
  const tradingPort = createTradingUIPort(tradingEngine);
  const replayPort = createReplayUIPort(engine);
  // Frozen presentation views: the UI receives these instead of stores.
  const dataset = createDatasetView(appState);
  const candles = createCandleView(candleStore);
  const statusView = createReplayStatusView({ engine, appState, candleStore });

  // Chart construction lives in the composition root; PaperUI receives
  // ready handles and never imports the chart layer.
  const chartManager = new ChartManager(document.getElementById('chart-container'));
  const chartAdapter = new ChartAdapter(replayPort, chartManager);

  // Capability callbacks: the UI invokes these instead of reaching back
  // into the coordinator or command controller.
  const coordinatorRef = { current: null };
  const commandControllerRef = { current: null };
  const callbacks = {
    onRetry: () => coordinatorRef.current?.loadAndPrepareReplay({ autoStart: false }),
    onFollow: () => {
      const idx = replayPort.getState().currentIndex;
      chartManager.setAutoFollow(true);
      if (idx >= 0) {
        const candle = candleStore.get(idx);
        if (candle) {
          chartManager.setRevealedMax(candle.time);
          coordinatorRef.current?.applyWindowedChart(idx);
          chartManager.followCurrent();
        }
      }
    },
    onLoadReplay: ({ targetSec } = {}) =>
      coordinatorRef.current?.loadAndPrepareReplay({ targetSec, autoStart: false }),
    onPreviewWindow: (idx) => coordinatorRef.current?.updatePreviewWindow?.(idx),
    onSeek: (idx) => commandControllerRef.current?.trySeek(idx),
    onTimeframeChange: (timeframe) => {
      appState.timeframe = timeframe;
    },
  };

  const ui = createPaperUI({
    replayPort,
    trading,
    tradingEvents,
    tradingState,
    dataset,
    candles,
    chart: { chartManager, adapter: chartAdapter },
    callbacks,
  });

  const coordinator = new ReplayCoordinator({
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
  coordinatorRef.current = coordinator;

  const coordinatorPorts = ui.getReplayPorts();
  const commandController = new ReplayCommandController({
    engine,
    appState,
    candleStore,
    tradingEngine,
    coordinator,
    headerBtn: coordinatorPorts.headerStartReplayBtn,
    onError: (msg) => coordinator.showTradingError(msg),
  });
  commandControllerRef.current = commandController;
  const unbindKeyboardShortcuts = commandController.bindKeyboardShortcuts();
  const actions = createApplicationActions({
    coordinator,
    commandController,
    appState,
    engine,
    candleStore,
    statusView,
    modeBanner: ui.modeBanner,
    timeline: ui.timeline,
    controls: ui.controls,
    errorPanel: ui.errorPanel,
  });

  const form = ui.getOrderFormPorts();
  const views = ui.createTerminalViews({
    commandController,
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
  const timelineBindings = bindTimelineInteractions({ timeline: ui.timeline, candles, trading, tradingEvents, tradingState, actions });
  const tradingBindings = bindTradingEvents({ tradingEvents, actions, errorPanel: ui.errorPanel });
  const unbindAutoFollow = ui.chartManager.onAutoFollowChange((isFollow) => ui.controls.setAutoFollow(isFollow));
  const chartTradingActions = createChartTradingActions({ tradingEngine, coordinator });
  const chartTradingController = ui.createChartTradingController({
    chartManager: ui.chartManager,
    tradingEvents,
    tradingState,
    tradingPanel: views.tradingPanel,
    floatingPosView: views.floatingPosView,
    toastView: views.toastView,
    orderFormView: views.tradingPanel.orderFormView,
    actions: chartTradingActions,
    ...form,
  });
  const tradingStateBridge = bindTradingState({ tradingEvents, tradingState, onChange: () => chartTradingController.syncChartTradingLines() });
  const replayLifecycle = bindReplayLifecycle({ engine, appState, candleStore, statusView, timeline: ui.timeline, modeBanner: ui.modeBanner, coordinator, chartManager: ui.chartManager });
  const actionGuardUnsub = registerActionGuard(engine, tradingEngine, coordinator);
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
      Promise.resolve(coordinator.loadAndPrepareReplay({ autoStart: false })).catch((error) => {
        if (!destroyed) coordinator.showTradingError?.(error?.message || 'Failed to load replay');
      });
    },
    destroy: guardedDestroy,
    services,
    ui,
    coordinator,
  };
}
