import { createReplayPreviewService, VISIBLE_WINDOW } from './ReplayPreviewService.js';
import { createDatasetChangeService } from './DatasetChangeService.js';
import { createReplayLoadService } from './ReplayLoadService.js';

export { VISIBLE_WINDOW };

/**
 * ReplayCoordinator is the stable application-level facade for replay
 * lifecycle capabilities. Async loading/session state, chart preview, and
 * dataset switching are owned by focused services and delegated here.
 * DOM elements are injected by the composition root. Trading access is
 * supplied through explicit capabilities, never a raw trading engine.
 */
export class ReplayCoordinator {
  constructor({
    dataManager, candleStore, appState, replayEngine, tradingCapabilities, chartManager,
    chartAdapter, timeline, controls, errorPanel, modeBanner, tradingErrorView = null,
    dataStatusEl = null, cacheBadgeEl = null, startReplayBtn = null,
    headerStartReplayBtn = null, loadBtn = null, fromDateEl = null, fromTimeEl = null,
    toDateEl = null, toTimeEl = null,
  }) {
    if (!tradingCapabilities || typeof tradingCapabilities !== 'object') {
      throw new TypeError('ReplayCoordinator requires trading capabilities');
    }
    if (typeof tradingCapabilities.hasOpenPosition !== 'function') {
      throw new TypeError('ReplayCoordinator requires tradingCapabilities.hasOpenPosition()');
    }
    if (typeof tradingCapabilities.notifyMarketCandle !== 'function') {
      throw new TypeError('ReplayCoordinator requires tradingCapabilities.notifyMarketCandle()');
    }
    if (typeof tradingCapabilities.clearPendingOrders !== 'function') {
      throw new TypeError('ReplayCoordinator requires tradingCapabilities.clearPendingOrders()');
    }
    this.tradingErrorView = tradingErrorView;

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
      hasOpenPosition: tradingCapabilities.hasOpenPosition,
      notifyMarketCandle: tradingCapabilities.notifyMarketCandle,
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
      hasOpenPosition: tradingCapabilities.hasOpenPosition,
      clearPendingOrders: tradingCapabilities.clearPendingOrders,
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
