import { createDatasetChangeService } from './DatasetChangeService.js';
import { createReplayLoadService } from './ReplayLoadService.js';
import { ReplayCommandController } from './ReplayCommandController.js';
import { createApplicationActions } from './ApplicationActions.js';

const VISIBLE_WINDOW = 1000;

export function createReplayRuntime({ services, ui, replayPort, statusView, liveDatasetChange = null }) {
  const { appState, candleStore, engine, datasetRepository, localDatasetRepository, tradingEngine } = services;
  const replayPorts = ui.getReplayPorts();
  const reportTradingError = (message) => ui.tradingErrorView?.show(message);

  const replayTradingCapabilities = Object.freeze({
    hasOpenPosition: () => tradingEngine.hasOpenPosition(),
    hasPendingOrders: () => tradingEngine.getPendingOrders().length > 0,
    hasTradingActivity: () => tradingEngine.hasTradingActivity(),
    clearPendingOrders: (reason) => tradingEngine.clearPendingOrders(reason),
  });

  const preview = (index) => {
    if (!candleStore.getCount()) return;
    ui.adapter.showPreview(candleStore, index, VISIBLE_WINDOW);
    ui.chartManager.setAutoFollow(true);
  };

  const loadService = createReplayLoadService({
    datasetRepository,
    localDatasetRepository,
    candleStore,
    appState,
    replayEngine: engine,
    hasOpenPosition: replayTradingCapabilities.hasOpenPosition,
    hasPendingOrders: replayTradingCapabilities.hasPendingOrders,
    hasTradingActivity: replayTradingCapabilities.hasTradingActivity,
    statusView,
    timeline: ui.timeline,
    controls: ui.controls,
    modeBanner: ui.modeBanner,
    errorPanel: ui.errorPanel,
    tradingErrorView: ui.tradingErrorView,
    dataStatusEl: replayPorts.dataStatusEl,
    cacheBadgeEl: replayPorts.cacheBadgeEl,
    preview,
  });

  const changeDataset = createDatasetChangeService({
    hasOpenPosition: replayTradingCapabilities.hasOpenPosition,
    hasTradingActivity: replayTradingCapabilities.hasTradingActivity,
    clearPendingOrders: replayTradingCapabilities.clearPendingOrders,
    appState,
    candleStore,
    replayEngine: engine,
    chartManager: ui.chartManager,
    timeline: ui.timeline,
    controls: ui.controls,
    reportError: reportTradingError,
    invalidateLoad: () => loadService.invalidateCurrentLoad(),
    reload: () => loadService.loadAndPrepareReplay({ autoStart: false }),
  });

  const replayCapabilities = Object.freeze({
    load: (options = {}) => loadService.loadAndPrepareReplay(options),
    preview,
    changeDataset: (kind, value, sourceEl) => changeDataset.handleSymbolTimeframeChange(kind, value, sourceEl),
  });

  const commandController = new ReplayCommandController({
    engine,
    appState,
    candleStore,
    headerBtn: replayPorts.headerStartReplayBtn,
    tradingCapabilities: replayTradingCapabilities,
    onLoad: ({ autoStart }) => replayCapabilities.load({ autoStart }),
    onPreview: preview,
    onError: reportTradingError,
  });

  const subscriptions = [
    engine.on('stateChanged', (state) => {
      appState.setReplayState(state);
      if (state.currentIndex >= 0) ui.timeline.setPosition(state.currentIndex);
      ui.modeBanner.update(statusView.snapshot());
    }),
    engine.on('reset', (payload) => {
      const state = payload?.state ?? payload;
      if (state?.status === 'ready') {
        const startIndex = Number.isInteger(state.startIndex) ? state.startIndex : appState.pendingStartIndex;
        preview(startIndex);
        const candle = candleStore.get(startIndex);
        if (candle) ui.chartManager.setRevealedMax(candle.time);
        return;
      }
      const index = payload?.index ?? state?.index;
      if (Number.isInteger(index) && index >= 0) {
        const candle = candleStore.get(index);
        if (candle) ui.chartManager.setRevealedMax(candle.time);
      }
    }),
  ];

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
    liveDatasetChange,
  });

  return {
    replayTradingCapabilities,
    replayCapabilities,
    commandController,
    actions,
    showTradingError: reportTradingError,
    unbindKeyboardShortcuts: commandController.bindKeyboardShortcuts(),
    destroy() {
      loadService.destroy();
      subscriptions.splice(0).forEach((unsubscribe) => {
        try { unsubscribe?.(); } catch {}
      });
    },
  };
}
