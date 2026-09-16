import { bindApplicationLifecycle } from './bindApplicationLifecycle.js';
import { bindDatasetSelectors } from './bindDatasetSelectors.js';
import { bindMobileNavigation } from './bindMobileNavigation.js';
import { createPaperUI } from '../ui/PaperUI.js';
import { ChartManager } from '../chart/ChartManager.js';
import { ChartAdapter } from '../chart/ChartAdapter.js';
import { bindTimelineInteractions } from '../ui/bindTimelineInteractions.js';
import { bindTradingEvents } from '../ui/bindTradingEvents.js';
import { bindMobileDrawer } from '../ui/bindMobileDrawer.js';
import { createCommandSurface } from '../ui/CommandSurface.js';
import { createChartTradingActions } from './ChartTradingActions.js';
import { createTradingPresentation } from './TradingPresentationAdapter.js';
import { createDatasetView, createCandleView, createReplayStatusView } from './DatasetPresentationAdapter.js';
import { createReplayUIPort } from './ReplayUIPort.js';
import { bindTradingState } from '../ui/TradingStateBridge.js';
import { createLifecycleGuard } from './createLifecycleGuard.js';
import { createReplayCapabilities } from './ReplayCapabilities.js';
import { createReplayRuntime } from './createReplayRuntime.js';

export function createApplicationRuntime({ services, mount, router, onDestroy = null, requireElement }) {
  const { appState, candleStore, engine, candleCache, tradingEngine } = services;
  const trading = createTradingPresentation(tradingEngine);
  const tradingEvents = trading;
  const replayPort = createReplayUIPort(engine);
  const dataset = createDatasetView(appState);
  const candles = createCandleView(candleStore);
  const statusView = createReplayStatusView({ engine, appState, candleStore });
  const replayRuntime = createReplayCapabilities();
  const replayCapabilities = replayRuntime.capabilities;
  let coordinator = null;
  let commandController = null;

  const callbacks = {
    onRetry: () => replayCapabilities.load({ autoStart: false }),
    onFollow: () => {
      const idx = replayPort.getState().currentIndex;
      chartManager.setAutoFollow(true);
      if (idx < 0) return;
      const candle = candleStore.get(idx);
      if (!candle) return;
      chartManager.setRevealedMax(candle.time);
      coordinator?.applyWindowedChart(idx);
      chartManager.followCurrent();
    },
    onLoadReplay: ({ targetSec } = {}) => replayCapabilities.load({ targetSec, autoStart: false }),
    onPreviewWindow: (idx) => replayCapabilities.preview(idx),
    onSeek: (idx) => commandController?.trySeek(idx),
    onTimeframeChange: (timeframe) => { appState.timeframe = timeframe; },
  };

  const chartContainer = requireElement('chart-container', mount.ownerDocument || document);
  const chartManager = new ChartManager(chartContainer);
  const chartAdapter = new ChartAdapter(replayPort, chartManager);
  const mobileNavBinding = bindMobileNavigation();
  const ui = createPaperUI({
    replayPort,
    trading,
    tradingEvents,
    dataset,
    candles,
    chart: { chartManager, adapter: chartAdapter },
    callbacks,
  });

  const replay = createReplayRuntime({ services, ui, replayPort, replayRuntime, statusView });
  coordinator = replay.coordinator;
  commandController = replay.commandController;

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
  const selectorBindings = bindDatasetSelectors(ui, replay.actions);
  const timelineBindings = bindTimelineInteractions({ timeline: ui.timeline, candles, trading, tradingEvents, actions: replay.actions });
  const tradingBindings = bindTradingEvents({ tradingEvents, actions: replay.actions, errorPanel: ui.errorPanel });
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
  const loadBtn = ui.getReplayPorts().loadBtn;
  const onLoadClick = () => replay.actions.load();
  loadBtn?.addEventListener('click', onLoadClick);
  const loadBinding = { destroy() { loadBtn?.removeEventListener?.('click', onLoadClick); } };
  const mobileDrawer = bindMobileDrawer();
  const commandSurface = createCommandSurface({ focusTradePanel: mobileDrawer?.focusTradingPanel });
  const destroy = bindApplicationLifecycle({
    unbindKeyboardShortcuts: replay.unbindKeyboardShortcuts,
    onDestroy: () => {
      onDestroy?.();
      router.destroy();
    },
    engine,
    candleCache,
    resources: [
      replay.coordinator,
      selectorBindings,
      timelineBindings,
      tradingBindings,
      tradingStateBridge,
      replay.replayLifecycle,
      replay.commandController,
      mobileDrawer,
      commandSurface,
      loadBinding,
      mobileNavBinding,
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
    extraCleanup: [unbindAutoFollow],
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

  return { start: lifecycle.start, destroy: lifecycle.destroy, ui, coordinator, mobileDrawer, commandSurface };
}
