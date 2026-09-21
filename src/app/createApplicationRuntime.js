import { bindApplicationLifecycle } from './bindApplicationLifecycle.js';
import { bindDatasetSelectors } from './bindDatasetSelectors.js';
import { bindMobileNavigation } from './bindMobileNavigation.js';
import { createPaperUI } from '../ui/PaperUI.js';
import { ChartManager } from '../chart/ChartManager.js';
import { ChartAdapter } from '../chart/ChartAdapter.js';
import { BinanceLiveMarketClient } from '../data/BinanceLiveMarketClient.js';
import { LiveMarketSession } from './LiveMarketSession.js';
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

export function createApplicationRuntime({ services, mount, router, onDestroy = null, requireElement }) {
  const {
    appState,
    candleStore,
    engine,
    candleCache,
    tradingEngine,
    mutationPipeline,
  } = services;

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
  let liveMarket = null;
  let replayMode = false;

  const chartContainer = requireElement('chart-container', mount.ownerDocument || document);
  const replayPage = requireElement('page-replay', mount.ownerDocument || document);
  chartManager = new ChartManager(chartContainer);
  const chartAdapter = new ChartAdapter(replayPort, chartManager);
  const mobileNavBinding = bindMobileNavigation();

  function markLiveMode() {
    replayMode = false;
    replayPage.dataset.mode = 'live';
    chartManager.clear();
    chartManager.setRevealedMax(null);
  }

  async function enterLiveMode() {
    if (!liveMarket) return false;
    markLiveMode();
    return liveMarket.start();
  }

  async function enterReplayMode() {
    replayMode = true;
    replayPage.dataset.mode = 'replay';
    liveMarket?.stop();
    chartManager.clear();
    chartManager.setRevealedMax(null);
  }

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
    onLoadReplay: async ({ targetSec } = {}) => {
      await enterReplayMode();
      return replayCapabilities.load({ targetSec, autoStart: false });
    },
    onPreviewWindow: (idx) => replayCapabilities.preview(idx),
    onSeek: (idx) => commandController?.trySeek(idx),
    onTimeframeChange: (timeframe) => { appState.timeframe = timeframe; },
  };

  const ui = createPaperUI({
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

  liveMarket = new LiveMarketSession({
    client: new BinanceLiveMarketClient(),
    chartManager,
    appState,
    statusEl: ui.getReplayPorts().dataStatusEl,
  });

  const replay = createReplayRuntime({
    services,
    ui,
    replayPort,
    replayRuntime,
    statusView,
    onBeforeReplayLoad: enterReplayMode,
    liveMarket,
    isReplayMode: () => replayMode,
    onEnterLive: enterLiveMode,
  });
  coordinator = replay.coordinator;
  commandController = replay.commandController;
  commandBridge.bind(commandController);

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
  const timelineBindings = bindTimelineInteractions({
    timeline: ui.timeline,
    candles,
    trading,
    tradingEvents,
    actions: replay.actions,
  });
  const tradingRuntime = createTradingRuntime({
    trading,
    tradingEvents,
    actions: replay.actions,
    ui,
    views,
    form,
    coordinator,
  });

  const unbindAutoFollow = ui.chartManager.onAutoFollowChange((isFollow) => ui.controls.setAutoFollow(isFollow));
  const ports = ui.getReplayPorts();
  const loadBtn = ports.loadBtn;
  const liveMarketBtn = ports.liveMarketBtn;

  const onLoadClick = () => replay.actions.loadReplay({ autoStart: false });
  const onLiveClick = () => { void replay.actions.live(); };
  loadBtn?.addEventListener('click', onLoadClick);
  liveMarketBtn?.addEventListener('click', onLiveClick);

  const loadBinding = {
    destroy() {
      loadBtn?.removeEventListener?.('click', onLoadClick);
      liveMarketBtn?.removeEventListener?.('click', onLiveClick);
    },
  };

  const mobileDrawer = bindMobileDrawer();
  const commandSurface = createCommandSurface({ focusTradePanel: mobileDrawer?.focusTradingPanel });

  const destroy = bindApplicationLifecycle({
    unbindKeyboardShortcuts: replay.unbindKeyboardShortcuts,
    onDestroy: () => {
      liveMarket?.destroy();
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
      liveMarket,
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
      views.dateSelector,
      views.sparkline,
      views.floatingPosView,
      views.toastView,
    ],
    extraCleanup: [unbindAutoFollow, commandBridge],
  });

  const lifecycle = createLifecycleGuard({
    start() {
      markLiveMode();
      Promise.resolve(enterLiveMode()).catch((error) => {
        if (!lifecycle.destroyed) {
          ui.getReplayPorts().dataStatusEl.textContent = `LIVE · ERROR · ${error?.message || 'Unable to connect to Binance'}`;
        }
      });
    },
    destroy,
  });

  return {
    start: lifecycle.start,
    destroy: lifecycle.destroy,
    ui,
    coordinator,
    liveMarket,
    mobileDrawer,
    commandSurface,
  };
}
