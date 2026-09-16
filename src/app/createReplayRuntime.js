import { ReplayCoordinator } from './ReplayCoordinator.js';
import { ReplayCommandController } from './ReplayCommandController.js';
import { bindReplayLifecycle } from './bindReplayLifecycle.js';
import { createApplicationActions } from './ApplicationActions.js';
import { createReplayCapabilities } from './ReplayCapabilities.js';

export function createReplayRuntime({ services, ui, replayPort }) {
  const { appState, candleStore, engine, dataManager, tradingEngine } = services;
  const replayTradingCapabilities = Object.freeze({
    hasOpenPosition: () => tradingEngine.hasOpenPosition(),
    hasPendingOrders: () => tradingEngine.getPendingOrders().length > 0,
    hasTradingActivity: () => tradingEngine.hasTradingActivity(),
    clearPendingOrders: (reason) => tradingEngine.clearPendingOrders(reason),
  });

  const replayRuntime = createReplayCapabilities();
  const replayCapabilities = replayRuntime.capabilities;
  let coordinator = null;
  let commandController = null;

  const callbacks = {
    onRetry: () => replayCapabilities.load({ autoStart: false }),
    onFollow: () => {
      const idx = replayPort.getState().currentIndex;
      ui.chartManager.setAutoFollow(true);
      if (idx < 0) return;

      const candle = candleStore.get(idx);
      if (!candle) return;

      ui.chartManager.setRevealedMax(candle.time);
      coordinator.applyWindowedChart(idx);
      ui.chartManager.followCurrent();
    },
    onLoadReplay: ({ targetSec } = {}) => replayCapabilities.load({ targetSec, autoStart: false }),
    onPreviewWindow: (idx) => replayCapabilities.preview(idx),
    onSeek: (idx) => commandController.trySeek(idx),
    onTimeframeChange: (timeframe) => { appState.timeframe = timeframe; },
  };

  coordinator = new ReplayCoordinator({
    dataManager,
    candleStore,
    appState,
    replayEngine: engine,
    tradingCapabilities: replayTradingCapabilities,
    statusView: ui.statusView,
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

  commandController = new ReplayCommandController({
    engine,
    appState,
    candleStore,
    headerBtn: ui.getReplayPorts().headerStartReplayBtn,
    tradingCapabilities: replayTradingCapabilities,
    onLoad: ({ autoStart }) => replayCapabilities.load({ autoStart }),
    onPreview: (index) => replayCapabilities.preview(index),
    onError: (msg) => coordinator.showTradingError(msg),
  });

  return {
    replayCapabilities,
    replayTradingCapabilities,
    coordinator,
    commandController,
    actions: createApplicationActions({
      replay: replayCapabilities,
      commandController,
      replayPort,
      appState,
      statusView: ui.statusView,
      modeBanner: ui.modeBanner,
      timeline: ui.timeline,
      controls: ui.controls,
      errorPanel: ui.errorPanel,
    }),
    replayLifecycle: bindReplayLifecycle({
      engine,
      appState,
      candleStore,
      statusView: ui.statusView,
      timeline: ui.timeline,
      modeBanner: ui.modeBanner,
      preview: replayCapabilities.preview,
      chartManager: ui.chartManager,
    }),
    unbindKeyboardShortcuts: commandController.bindKeyboardShortcuts(),
    callbacks,
  };
}
