import { ReplayCoordinator } from './ReplayCoordinator.js';
import { ReplayCommandController } from './ReplayCommandController.js';
import { bindReplayLifecycle } from './bindReplayLifecycle.js';
import { createApplicationActions } from './ApplicationActions.js';

export function createReplayRuntime({ services, ui, replayPort, replayRuntime, statusView, liveDatasetChange = null }) {
  const { appState, candleStore, engine, datasetRepository, localDatasetRepository, tradingEngine } = services;
  const replayTradingCapabilities = Object.freeze({
    hasOpenPosition: () => tradingEngine.hasOpenPosition(),
    hasPendingOrders: () => tradingEngine.getPendingOrders().length > 0,
    hasTradingActivity: () => tradingEngine.hasTradingActivity(),
    clearPendingOrders: (reason) => tradingEngine.clearPendingOrders(reason),
  });

  const coordinator = new ReplayCoordinator({
    datasetRepository,
    localDatasetRepository,
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

  const commandController = new ReplayCommandController({
    engine,
    appState,
    candleStore,
    headerBtn: ui.getReplayPorts().headerStartReplayBtn,
    tradingCapabilities: replayTradingCapabilities,
    onLoad: ({ autoStart }) => replayRuntime.capabilities.load({ autoStart }),
    onPreview: (index) => replayRuntime.capabilities.preview(index),
    onError: (msg) => coordinator.showTradingError(msg),
  });

  const replayLifecycle = bindReplayLifecycle({
    engine,
    appState,
    candleStore,
    statusView,
    timeline: ui.timeline,
    modeBanner: ui.modeBanner,
    preview: replayRuntime.capabilities.preview,
    chartManager: ui.chartManager,
  });

  return {
    replayTradingCapabilities,
    coordinator,
    commandController,
    actions: createApplicationActions({
      replay: replayRuntime.capabilities,
      commandController,
      replayPort,
      appState,
      statusView,
      modeBanner: ui.modeBanner,
      timeline: ui.timeline,
      controls: ui.controls,
      errorPanel: ui.errorPanel,
      liveDatasetChange,
    }),
    replayLifecycle,
    unbindKeyboardShortcuts: commandController.bindKeyboardShortcuts(),
  };
}
