import { bindApplicationLifecycle } from './bindApplicationLifecycle.js';
import { bindDatasetSelectors } from './bindDatasetSelectors.js';
import { bindMobileNavigation } from './bindMobileNavigation.js';
import { createTerminalUI } from '../ui/TerminalUI.js';
import { ChartManager } from '../chart/ChartManager.js';
import { ChartAdapter } from '../chart/ChartAdapter.js';
import { bindTimelineInteractions } from '../ui/bindTimelineInteractions.js';
import { bindMobileDrawer } from '../ui/bindMobileDrawer.js';
import { createCommandSurface } from '../ui/CommandSurface.js';
import { createDeferredReplayCommandPresentationPort } from '../ports/ReplayCommandPresentationPort.js';
import { createTradingPresentation } from './TradingPresentationAdapter.js';
import { createDatasetView, createCandleView, createReplayStatusView } from './DatasetPresentationAdapter.js';
import { createReplayUIPort } from './ReplayUIPort.js';
import { createLifecycleGuard } from './createLifecycleGuard.js';
import { createReplayCapabilities } from './ReplayCapabilities.js';
import { createReplayRuntime } from './createReplayRuntime.js';
import { createTradingRuntime } from './createTradingRuntime.js';
import { BinanceLiveMarketService } from './BinanceLiveMarketService.js';
import { MarketModeController } from './MarketModeController.js';

export function createApplicationRuntime({ services, mount, router, onDestroy = null, requireElement }) {
  const { appState, candleStore, engine, candleCache, datasetRepository, localDatasetRepository, tradingEngine, mutationPipeline } = services;
  const trading = createTradingPresentation(tradingEngine);
  const tradingEvents = trading;
  const replayPort = createReplayUIPort(engine);
  const commandBridge = createDeferredReplayCommandPresentationPort();
  const commandPort = commandBridge.port;
  const dataset = createDatasetView(appState);
  const candles = createCandleView(candleStore);
  const statusView = createReplayStatusView({ engine, appState, candleStore });
  const replayRuntime = createReplayCapabilities();
  const replayCapabilities = replayRuntime.capabilities;
  let coordinator = null;
  let commandController = null;
  let chartManager = null;
  let modeController = null;

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
    onSeek: (idx) => commandController?.trySeek(idx),
  };

  const chartContainer = requireElement('chart-container', mount.ownerDocument || document);
  chartManager = new ChartManager(chartContainer);
  const liveMarket = new BinanceLiveMarketService({
    chartManager,
    onStatus: ({ status, detail, symbol, timeframe }) => {
      if (!mount.isConnected) return;
      const label = symbol && timeframe ? 'LIVE · ' + symbol + ' · ' + timeframe : 'LIVE';
      const suffix = status === 'live' ? '' : detail ? ' · ' + detail : ' · ' + status;
      uiStatusEl?.(label + suffix);
    },
  });
  const uiStatusEl = (text) => {
    const element = mount.querySelector('#data-status');
    if (element) element.textContent = text;
  };
  const liveDatasetChange = async (kind, value) => {
    if (kind !== 'symbol' && kind !== 'timeframe') return false;
    const normalized = String(value ?? '').trim();
    if (!normalized) return false;
    if (kind === 'symbol') appState.symbol = normalized.toUpperCase();
    else appState.timeframe = normalized;
    try {
      await liveMarket.start({ symbol: appState.symbol, timeframe: appState.timeframe });
      return true;
    } catch (error) {
      uiStatusEl('LIVE · ' + (error?.message || 'unable to load market data'));
      return false;
    }
  };
  const chartAdapter = new ChartAdapter(replayPort, chartManager);
  const mobileNavBinding = bindMobileNavigation();
  const ui = createTerminalUI({
    mount,
    replayPort,
    commandPort,
    trading,
    tradingEvents,
    dataset,
    candles,
    chart: { chartManager, adapter: chartAdapter },
    callbacks,
  });

  const replay = createReplayRuntime({ services, ui, replayPort, replayRuntime, statusView, liveDatasetChange });
  coordinator = replay.coordinator;
  commandController = replay.commandController;
  commandBridge.bind(commandController);

  const form = ui.getOrderFormPorts();
  const views = ui.createTerminalViews({
    timeline: ui.timeline,
    controls: ui.controls,
    modeBanner: ui.modeBanner,
    onSeek: callbacks.onSeek,
    ...form,
  });
  const selectorBindings = bindDatasetSelectors(ui, replay.actions);
  const timelineBindings = bindTimelineInteractions({ timeline: ui.timeline, candles, trading, tradingEvents, actions: replay.actions });
  const tradingRuntime = createTradingRuntime({ trading, tradingEvents, actions: replay.actions, ui, views, form, coordinator });
  const unbindAutoFollow = ui.chartManager.onAutoFollowChange((isFollow) => ui.controls.setAutoFollow(isFollow));
  const loadBtn = ui.getReplayPorts().loadBtn;
  const onLoadClick = () => replay.actions.load();
  loadBtn?.addEventListener('click', onLoadClick);
  const loadBinding = { destroy() { loadBtn?.removeEventListener?.('click', onLoadClick); } };
  const mobileDrawer = bindMobileDrawer();
  modeController = new MarketModeController({
    page: ui.el('page-replay'),
    liveButton: ui.el('live-mode-btn'),
    replayButton: ui.el('replay-mode-btn'),
    datasetSelect: ui.el('replay-dataset-select'),
    datasetRefresh: ui.el('replay-dataset-refresh'),
    symbolSelect: ui.el('symbol-select'),
    timeframeSelect: ui.el('timeframe-select'),
    controls: ui.controls,
    appState,
    liveMarket,
    datasetRepository,
    localDatasetRepository,
    replayCapabilities,
    chartManager,
    pauseReplay: () => commandController?.pause(),
    dataStatus: ui.el('data-status'),
  });
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
      mutationPipeline,
      selectorBindings,
      timelineBindings,
      tradingRuntime.tradingBindings,
      tradingRuntime.tradingStateBridge,
      replay.replayLifecycle,
      replay.commandController,
      modeController,
      datasetRepository,
      localDatasetRepository,
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
      tradingRuntime.chartTradingController,
      ui.adapter,
      ui.chartManager,
      views.tradingPanel,
      views.sparkline,
      views.floatingPosView,
      views.toastView,
    ],
    extraCleanup: [unbindAutoFollow, commandBridge],
  });
  const lifecycle = createLifecycleGuard({
    start() {
      ui.modeBanner.update(statusView.snapshot());
      Promise.resolve(modeController?.setMode('live', { force: true })).catch((error) => { uiStatusEl('LIVE · ' + (error?.message || 'unable to start live market')); });
    },
    destroy,
  });

  return { start: lifecycle.start, destroy: lifecycle.destroy, ui, coordinator, mobileDrawer, commandSurface };
}