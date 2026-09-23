import { bindApplicationLifecycle } from './bindApplicationLifecycle.js';
import { bindDatasetSelectors } from './bindDatasetSelectors.js';
import { bindMobileNavigation } from './bindMobileNavigation.js';
import { createTerminalUI } from '../ui/TerminalUI.js';
import { ChartManager } from '../chart/ChartManager.js';
import { ChartAdapter } from '../chart/ChartAdapter.js';
import { bindTimelineInteractions } from '../ui/bindTimelineInteractions.js';
import { bindMobileDrawer } from '../ui/bindMobileDrawer.js';
import { createCommandSurface } from '../ui/CommandSurface.js';
import { createTradingPresentation } from './TradingPresentationAdapter.js';
import { createDatasetView, createCandleView, createReplayStatusView } from './DatasetPresentationAdapter.js';
import { createReplayUIPort } from './ReplayUIPort.js';
import { createLifecycleGuard } from './createLifecycleGuard.js';
import { createReplayRuntime } from './createReplayRuntime.js';
import { createTradingRuntime } from './createTradingRuntime.js';
import { BinanceLiveMarketService } from './BinanceLiveMarketService.js';
import { MarketModeController } from './MarketModeController.js';

export function createApplicationRuntime({ services, mount, router, onDestroy = null, requireElement }) {
  const { appState, engine, candleCache, datasetRepository, localDatasetRepository, tradingEngine, mutationPipeline } = services;
  const trading = createTradingPresentation(tradingEngine);
  const tradingEvents = trading;
  const replayPort = createReplayUIPort(engine);
  const dataset = createDatasetView(appState);
  const statusView = createReplayStatusView({ replayPort, appState });
  let replayCapabilities = null;
  let commandController = null;
  let chartManager = null;
  let modeController = null;

  const replayCommands = Object.freeze({
    togglePlayPause: (...args) => commandController?.togglePlayPause(...args) ?? false,
    pause: (...args) => commandController?.pause(...args) ?? false,
    stepForward: (...args) => commandController?.stepForward(...args) ?? false,
    reset: (...args) => commandController?.reset(...args) ?? false,
    setSpeed: (...args) => commandController?.setSpeed(...args) ?? false,
  });

  const callbacks = {
    onRetry: () => replayCapabilities?.load({ autoStart: false }),
    onFollow: () => {
      const idx = replayPort.getState().currentIndex;
      chartManager.setAutoFollow(true);
      if (idx < 0) return;
      const candle = replayPort.getCandle(idx);
      if (!candle) return;
      chartManager.setRevealedMax(candle.time);
      chartAdapter.showPreview(idx, 1000);
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
    const previousSymbol = appState.symbol;
    const previousTimeframe = appState.timeframe;
    const nextSymbol = kind === 'symbol' ? normalized.toUpperCase() : previousSymbol;
    const nextTimeframe = kind === 'timeframe' ? normalized : previousTimeframe;
    try {
      await liveMarket.start({ symbol: nextSymbol, timeframe: nextTimeframe });
      appState.symbol = nextSymbol;
      appState.timeframe = nextTimeframe;
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
    replayCommands,
    trading,
    tradingEvents,
    dataset,
    chart: { chartManager, adapter: chartAdapter },
    callbacks,
  });

  const replay = createReplayRuntime({ services, ui, replayPort, statusView, liveDatasetChange });
  replayCapabilities = replay.replayCapabilities;
  commandController = replay.commandController;

  const form = ui.getOrderFormPorts();
  const views = ui.createTerminalViews({
    timeline: ui.timeline,
    controls: ui.controls,
    modeBanner: ui.modeBanner,
    onSeek: callbacks.onSeek,
    ...form,
  });
  const selectorBindings = bindDatasetSelectors(ui, replay.actions);
  const timelineBindings = bindTimelineInteractions({ timeline: ui.timeline, replayPort, trading, tradingEvents, actions: replay.actions });
  const tradingRuntime = createTradingRuntime({
    trading,
    tradingEvents,
    actions: replay.actions,
    ui,
    views,
    form,
    reportTradingError: replay.showTradingError,
  });
  const unbindAutoFollow = ui.chartManager.onAutoFollowChange((isFollow) => ui.controls.setAutoFollow(isFollow));
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
    unbindKeyboardShortcuts: null,
    onDestroy: () => {
      onDestroy?.();
      router.destroy();
    },
    engine,
    candleCache,
    resources: [
      replay,
      tradingEngine,
      mutationPipeline,
      selectorBindings,
      timelineBindings,
      tradingRuntime.tradingBindings,
      tradingRuntime.tradingStateBridge,
      modeController,
      datasetRepository,
      localDatasetRepository,
      mobileDrawer,
      commandSurface,
      mobileNavBinding,
      ui.symbolSelector,
      ui.timeframeSelector,
      ui.timeline,
      ui.controls,
      ui.themeManager,
      ui.errorPanel,
      ui.tradingErrorView,
      tradingRuntime.chartTradingController,
      ui.adapter,
      ui.chartManager,
      views.tradingPanel,
      views.sparkline,
      views.floatingPosView,
      views.toastView,
    ],
    extraCleanup: [unbindAutoFollow],
  });
  const lifecycle = createLifecycleGuard({
    start() {
      ui.modeBanner.update(statusView.snapshot());
      Promise.resolve(modeController?.setMode('live', { force: true })).catch((error) => {
        uiStatusEl('LIVE · ' + (error?.message || 'unable to start live market'));
      });
    },
    destroy,
  });

  return { start: lifecycle.start, destroy: lifecycle.destroy, ui, mobileDrawer, commandSurface, replayCapabilities };
}
