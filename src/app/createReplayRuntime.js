import { createReplayLoadService } from './ReplayLoadService.js';
import { ReplayCommandController } from './ReplayCommandController.js';

const VISIBLE_WINDOW = 1000;

export function createReplayRuntime({ services, ui, replayPort, statusView, liveDatasetChange = null }) {
  const { appState, engine, datasetRepository, localDatasetRepository, tradingEngine } = services;
  const replayPorts = ui.getReplayPorts();
  const reportTradingError = (message) => ui.tradingErrorView?.show(message);

  const replayTradingCapabilities = Object.freeze({
    hasOpenPosition: () => tradingEngine.hasOpenPosition(),
    hasPendingOrders: () => tradingEngine.getPendingOrders().length > 0,
    hasTradingActivity: () => tradingEngine.hasTradingActivity(),
  });

  const preview = (index) => {
    if (!replayPort.getTotalCandles()) return;
    ui.adapter.showPreview(index, VISIBLE_WINDOW);
    ui.chartManager.setAutoFollow(true);
  };

  const loadService = createReplayLoadService({
    datasetRepository,
    localDatasetRepository,
    appState,
    replayEngine: engine,
    hasOpenPosition: replayTradingCapabilities.hasOpenPosition,
    hasPendingOrders: replayTradingCapabilities.hasPendingOrders,
    hasTradingActivity: replayTradingCapabilities.hasTradingActivity,
  });

  let commandController = null;
  let keyboardCleanup = null;
  const reportStatus = () => ui.modeBanner.update(statusView.snapshot());

  const loadReplay = async ({ datasetId = null, datasetSource = null, autoStart = false } = {}) => {
    ui.errorPanel?.hide();
    if (replayPorts.dataStatusEl) replayPorts.dataStatusEl.textContent = 'Loading replay dataset…';
    reportStatus();

    try {
      const result = await loadService.loadAndPrepareReplay({ datasetId, datasetSource });
      if (!result) return null;

      const { metadata, state } = result;
      const total = state.totalCandles ?? engine.getTotalCandles();
      ui.timeline.setTotal(total, replayPort.getTimelineTimes());
      ui.timeline.setEnabled(true);
      ui.controls.setStartIndex(state.startIndex);
      ui.timeline.setPosition(state.startIndex);
      appState.setPendingStartIndex(state.startIndex);
      preview(state.startIndex);
      replayPorts.cacheBadgeEl?.classList.add('hidden');

      if (replayPorts.dataStatusEl) {
        const label = metadata.local ? 'Local dataset: ' : 'Saved dataset: ';
        replayPorts.dataStatusEl.textContent = label + metadata.symbol + ' · ' + metadata.timeframe + ' · ' + total.toLocaleString() + ' candles';
      }
      reportStatus();

      if (autoStart) await engine.start(state.startIndex);
      return metadata;
    } catch (error) {
      if (error?.code === 'NO_DATASET') {
        ui.errorPanel?.show({ category: 'NO_DATA', userMessage: error.message, message: error.message });
        if (replayPorts.dataStatusEl) replayPorts.dataStatusEl.textContent = 'No saved replay dataset';
      } else {
        ui.errorPanel?.show({
          category: 'INVALID_DATA',
          userMessage: error?.message || 'Replay dataset failed to load',
          message: error?.message || String(error),
        });
        if (replayPorts.dataStatusEl) replayPorts.dataStatusEl.textContent = 'Replay dataset failed to load';
      }
      reportStatus();
      throw error;
    }
  };

  const replayCapabilities = Object.freeze({
    load: (options = {}) => loadReplay(options),
    preview,
    invalidateLoad: () => loadService.invalidateCurrentLoad(),
  });

  commandController = new ReplayCommandController({
    engine,
    appState,
    headerBtn: replayPorts.headerStartReplayBtn,
    tradingCapabilities: replayTradingCapabilities,
    onLoad: ({ autoStart }) => loadReplay({ autoStart }),
    onPreview: preview,
    onError: reportTradingError,
  });
  keyboardCleanup = commandController.bindKeyboardShortcuts();

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
        const candle = engine.getCandle(startIndex);
        if (candle) ui.chartManager.setRevealedMax(candle.time);
      }
    }),
  ];

  const actions = Object.freeze({
    changeDataset(kind, value, sourceEl) {
      if (appState.mode === 'live' && typeof liveDatasetChange === 'function') {
        return liveDatasetChange(kind, value, sourceEl);
      }
      return false;
    },

    previewTimeline(index) {
      appState.setPendingStartIndex(index);
      ui.controls.setStartIndex(index);
      reportStatus();
      const state = replayPort.getState();
      if (state.status === 'ready' || state.status === 'idle') preview(index);
    },

    async commitTimeline(index) {
      const state = replayPort.getState();
      if (['paused', 'playing', 'ended'].includes(state.status)) {
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
      preview(index);
      return true;
    },

    startAt(index) {
      const n = Number(index);
      if (!Number.isInteger(n) || n < 0) return false;
      appState.setPendingStartIndex(n);
      ui.controls.setStartIndex(n);
      return commandController.startAt(n);
    },

    pause() { return commandController.pause(); },

    handleLiquidation(payload) {
      try { void commandController.pause(); } catch (error) { console.warn('[Replay] liquidation pause failed', error); }
      ui.errorPanel.show({
        category: 'LIQUIDATION',
        userMessage: 'Position liquidated: ' + (payload?.symbol || '') + ' @ ' + (payload?.liquidationPrice ?? '—'),
        message: 'Position liquidated',
        code: 'LIQUIDATION',
        context: {},
      }, { severity: 'critical', onPause: () => commandController.pause() });
    },

    load(options = {}) { return loadReplay(options); },
  });

  const destroy = () => {
    loadService.destroy();
    keyboardCleanup?.();
    commandController?.destroy?.();
    keyboardCleanup = null;
    subscriptions.splice(0).forEach((unsubscribe) => {
      try { unsubscribe?.(); } catch {}
    });
  };

  return {
    replayTradingCapabilities,
    replayCapabilities,
    commandController,
    actions,
    showTradingError: reportTradingError,
    destroy,
  };
}
