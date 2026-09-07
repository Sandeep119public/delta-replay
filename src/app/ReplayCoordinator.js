import { createReplayPreviewService, VISIBLE_WINDOW } from './ReplayPreviewService.js';
import { createDatasetChangeService } from './DatasetChangeService.js';
import { createReplayLoadService } from './ReplayLoadService.js';

export { VISIBLE_WINDOW };

/**
 * ReplayCoordinator is the stable application-level facade for replay
 * lifecycle capabilities. Async loading/session state, chart preview, and
 * dataset switching are owned by focused services and delegated here.
 * DOM elements are injected by the composition root. Trading access is
 * expressed to child services through narrow capabilities.
 */
export class ReplayCoordinator {
  constructor({
    dataManager, candleStore, appState, replayEngine, tradingEngine, chartManager,
    chartAdapter, timeline, controls, errorPanel, modeBanner, tradingErrorView = null,
    dataStatusEl = null, cacheBadgeEl = null, startReplayBtn = null,
    headerStartReplayBtn = null, loadBtn = null, fromDateEl = null, fromTimeEl = null,
    toDateEl = null, toTimeEl = null,
  }) {
    this.tradingErrorView = tradingErrorView;

    const hasOpenPosition = () => tradingEngine?.hasOpenPosition?.() === true;
    const notifyMarketCandle = (payload) => tradingEngine?.onMarketCandle?.(payload);
    const clearPendingOrders = (reason) => tradingEngine?.clearPendingOrders?.(reason);

    const previewService = createReplayPreviewService({
      candleStore,
      chartManager,
      chartAdapter,
    });
    this.previewService = previewService;

    this.loadService = createReplayLoadService({
      dataManager,
      candleStore,
      appState,
      replayEngine,
      hasOpenPosition,
      notifyMarketCandle,
      timeline,
      controls,
      modeBanner,
      errorPanel,
      tradingErrorView,
      dataStatusEl,
      cacheBadgeEl,
      startReplayBtn,
      headerStartReplayBtn,
      loadBtn,
      fromDateEl,
      fromTimeEl,
      toDateEl,
      toTimeEl,
      updatePreviewWindow: previewService.updatePreviewWindow,
    });

    this.datasetChangeService = createDatasetChangeService({
      hasOpenPosition,
      clearPendingOrders,
      appState,
      candleStore,
      replayEngine,
      chartManager,
      timeline,
      controls,
      startReplayBtn,
      headerStartReplayBtn,
      reportError: (msg) => this.showTradingError(msg),
      invalidateLoad: () => this.loadService.invalidateCurrentLoad(),
      reload: () => this.loadAndPrepareReplay({ autoStart: false }),
    });
  }

  updateLoadButton() {
    return this.loadService.updateLoadButton();
  }

  updatePreviewWindow(idx) {
    this.previewService.updatePreviewWindow(idx);
  }

  applyWindowedChart(idx) {
    this.previewService.applyWindowedChart(idx);
  }

  handleSymbolTimeframeChange(kind, newValue, selectElement) {
    return this.datasetChangeService.handleSymbolTimeframeChange(kind, newValue, selectElement);
  }

  showTradingError(msg) {
    this.tradingErrorView?.show(msg);
  }

  destroy() {
    this.loadService.destroy();
  }

  async loadAndPrepareReplay(options = {}) {
    return this.loadService.loadAndPrepareReplay(options);
  }
}
