import { ReplayCoordinator } from './ReplayCoordinator.js';
import { ReplayCommandController } from './ReplayCommandController.js';
import { createCoreServices } from './createCoreServices.js';
import { bindReplayLifecycle } from './bindReplayLifecycle.js';
import { bindApplicationLifecycle } from './bindApplicationLifecycle.js';
import { createPaperUI } from '../ui/PaperUI.js';
import { renderPaperLayout } from '../ui/paper/PaperLayout.js';
import { ChartManager } from '../chart/ChartManager.js';
import { ChartAdapter } from '../chart/ChartAdapter.js';
import { bindTimelineInteractions } from '../ui/bindTimelineInteractions.js';
import { bindTradingEvents } from '../ui/bindTradingEvents.js';
import { bindMobileDrawer } from '../ui/bindMobileDrawer.js';
import { createApplicationActions } from './ApplicationActions.js';
import { createChartTradingActions } from './ChartTradingActions.js';
import { createTradingPresentation } from './TradingPresentationAdapter.js';
import { createDatasetView, createCandleView, createReplayStatusView } from './DatasetPresentationAdapter.js';
import { createReplayUIPort } from './ReplayUIPort.js';
import { bindTradingState } from '../ui/TradingStateBridge.js';
import { createLifecycleGuard } from './createLifecycleGuard.js';

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

export { createReplayCapabilities, requireElement };

function createReplayCapabilities() {
  let coordinator = null;
  return Object.freeze({
    capabilities: Object.freeze({
      load: (options = {}) => coordinator?.loadAndPrepareReplay(options),
      preview: (index) => coordinator?.updatePreviewWindow?.(index),
      changeDataset: (kind, value, sourceEl) => coordinator?.handleSymbolTimeframeChange(kind, value, sourceEl),
    }),
    attach(nextCoordinator) { coordinator = nextCoordinator; },
  });
}

function requireElement(id, root = document) {
  const element = root.getElementById?.(id) || root.querySelector?.('#' + id);
  if (!element) throw new Error(`Required element #${id} is missing`);
  return element;
}

export function createApplication() {
  const services = createCoreServices();
  const { appState, candleStore, engine, candleCache, dataManager, tradingEngine } = services;
  const trading = createTradingPresentation(tradingEngine);
  const tradingEvents = trading;
  const replayPort = createReplayUIPort(engine);
  const dataset = createDatasetView(appState);
  const candles = createCandleView(candleStore);
  const statusView = createReplayStatusView({ engine, appState, candleStore });
  const replayTradingCapabilities = Object.freeze({
    hasOpenPosition: () => tradingEngine.hasOpenPosition(),
    notifyMarketCandle: (payload) => tradingEngine.onMarketCandle(payload),
    clearPendingOrders: (reason) => tradingEngine.clearPendingOrders(reason),
  });

  // Render the shell once before constructing chart handles.
  const mount = requireElement('app');
  renderPaperLayout(mount);
  const chartContainer = requireElement('chart-container');
  const chartManager = new ChartManager(chartContainer);
  const chartAdapter = new ChartAdapter(replayPort, chartManager);

  let coordinator = null;
  let commandController = null;
  const replayRuntime = createReplayCapabilities();
  const replayCapabilities = replayRuntime.capabilities;

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

  // PaperUI preserves the pre-rendered shell and owns the remaining UI bindings.
  coordinator = new ReplayCoordinator({
    dataManager,
    candleStore,
    appState,
    replayEngine: engine,
    tradingCapabilities: replayTradingCapabilities,
    statusView,
    chartManager: ui.chartManager,
    chartAdapter: ui.adapter,
    timeline: ui.timeline,
    controls: ui.controls,
    errorPanel: ui.errorPanel,
    modeBanner: ui.modeBanner,
    tradingErrorView: ui.tradingErrorView,
    ...ui.getReplayPorts(),
  });

  replayRuntime.attach(coordinator);

  const coordinatorPorts = ui.getReplayPorts();
  commandController = new ReplayCommandController({
    engine,
    appState,
    candleStore,
    headerBtn: coordinatorPorts.headerStartReplayBtn,
    onLoad: ({ autoStart }) => replayCapabilities.load({ autoStart }),
    onPreview: (index) => replayCapabilities.preview(index),
    canExecute: (action) => {
      if (!trading.actions.hasOpenPosition()) return { allowed: true };
      const reason = action === 'start'
        ? 'Cannot start replay while a position is open — close position first.'
        : action === 'seek'
          ? 'Cannot seek while a position is open — close position first.'
          : `Cannot ${action} while a position is open — close position first.`;
      return { allowed: false, reason };
    },
    onError: (msg) => coordinator?.showTradingError(msg),
  });
  const unbindKeyboardShortcuts = commandController.bindKeyboardShortcuts();

  const actions = createApplicationActions({
    replay: replayCapabilities,
    commandController,
    replayPort,
    appState,
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
  const replayLifecycle = bindReplayLifecycle({
    engine,
    appState,
    candleStore,
    statusView,
    timeline: ui.timeline,
    modeBanner: ui.modeBanner,
    preview: replayCapabilities.preview,
    chartManager: ui.chartManager,
  });
  const actionGuardUnsub = registerActionGuard(engine, () => trading.actions.hasOpenPosition(), (msg) => coordinator?.showTradingError(msg));
  const loadBtn = coordinatorPorts.loadBtn;
  const onLoadClick = () => actions.load();
  loadBtn?.addEventListener('click', onLoadClick);
  const loadBinding = { destroy() { loadBtn?.removeEventListener?.('click', onLoadClick); } };
  const mobileDrawer = bindMobileDrawer();

  const destroy = bindApplicationLifecycle({
    unbindKeyboardShortcuts,
    onDestroy: () => coordinator?.destroy?.(),
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

  const lifecycle = createLifecycleGuard({
    start() {
      ui.modeBanner.update(statusView.snapshot());
      Promise.resolve(replayCapabilities.load({ autoStart: false })).catch((error) => {
        if (!lifecycle.destroyed) coordinator?.showTradingError?.(error?.message || 'Failed to load replay');
      });
    },
    destroy,
  });

  return {
    start: lifecycle.start,
    destroy: lifecycle.destroy,
    services,
    ui,
    coordinator,
  };
}
