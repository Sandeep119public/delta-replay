import { createDatasetChangeService } from './DatasetChangeService.js';
import { createReplayLoadService } from './ReplayLoadService.js';
import { ReplayCommandController } from './ReplayCommandController.js';

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

  const reportStatus = () => ui.modeBanner.update(statusView.snapshot());
  const actions = Object.freeze({
    changeDataset(kind, value, sourceEl) {
      if (appState.mode === 'live' && typeof liveDatasetChange === 'function') return liveDatasetChange(kind, value, sourceEl);
      return replayCapabilities.changeDataset(kind, value, sourceEl);
    },
    previewTimeline(index) {
      appState.setPendingStartIndex(index);
      ui.controls.setStartIndex(index);
      reportStatus();
      const state = replayPort.getState();
      if (state.status === 'ready' || state.status === 'idle') return preview(index);
    },
    async commitTimeline(index) {
      const state = replayPort.getState();
      if (state.status === 'paused' || state.status === 'playing' || state.status === 'ended') {
        if (state.status === 'playing' && !(await commandController.pause())) {
          ui.timeline.setPosition(state.currentIndex);
          return false;
        }
        const ok = await commandController.trySeek(index);
        if (!ok) ui.timeline.setPosition(replayPort.getState().currentIndex);
        return ok;
      }
      appState.setPendingStartIndex(index);
      ui.controls.setStartIndex(index);
      reportStatus();
      return preview(index);
    },
    startAt(index) {
      const n = Number(index);
      if (!Number.isFinite(n) || n < 0) return;
      appState.setPendingStartIndex(n);
      ui.controls.setStartIndex(n);
      return commandController.startAt(n);
    },
    pause() { return commandController.pause(); },
    handleLiquidation(payload) {
      try { commandController.pause(); } catch (error) { console.warn('[Replay] liquidation pause failed', error); }
      ui.errorPanel.show({
        category: 'LIQUIDATION',
        userMessage: 'Position liquidated: ' + (payload?.symbol || '') + ' @ ' + (payload?.liquidationPrice ?? '—'),
        message: 'Position liquidated',
        code: 'LIQUIDATION',
        context: {},
      }, { severity: 'critical', onPause: () => commandController.pause() });
    },
    load(options = {}) { return replayCapabilities.load(options); },
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
