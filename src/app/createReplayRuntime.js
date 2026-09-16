import { ReplayCoordinator } from './ReplayCoordinator.js';
import { ReplayCommandController } from './ReplayCommandController.js';
import { bindReplayLifecycle } from './bindReplayLifecycle.js';
import { createApplicationActions } from './ApplicationActions.js';

export function createReplayRuntime({ services, ui, replayPort, replayCapabilities, statusView }) {
  const { appState, candleStore, engine, dataManager, tradingEngine } = services;
  const replayTradingCapabilities = Object.freeze({
    hasOpenPosition: () => tradingEngine.hasOpenPosition(),
    hasPendingOrders: () => tradingEngine.getPendingOrders().length > 0,
    hasTradingActivity: () => tradingEngine.hasTradingActivity(),
    clearPendingOrders: (reason) => tradingEngine.clearPendingOrders(reason),
  });

  const coordinator = new ReplayCoordinator({
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

  const commandController = new ReplayCommandController({
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
    replayTradingCapabilities,
    coordinator,
    commandController,
    actions: createApplicationActions({
      replay: replayCapabilities,
      commandController,
      replayPort,
      appState,
      statusView,
      modeBanner: ui.modeBanner,
      timeline: ui.timeline,
      controls: ui.controls,
      errorPanel: ui.errorPanel,
    }),
    replayLifecycle: bindReplayLifecycle({
      engine,
      appState,
      candleStore,
      statusView,
      timeline: ui.timeline,
      modeBanner: ui.modeBanner,
      preview: replayCapabilities.preview,
      chartManager: ui.chartManager,
    }),
    unbindKeyboardShortcuts: commandController.bindKeyboardShortcuts(),
  };
}
