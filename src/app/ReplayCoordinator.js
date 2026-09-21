import { createReplayPreviewService, VISIBLE_WINDOW } from './ReplayPreviewService.js';
import { createDatasetChangeService } from './DatasetChangeService.js';
import { createReplayLoadService } from './ReplayLoadService.js';

export { VISIBLE_WINDOW };

export class ReplayCoordinator {
  constructor({
    datasetRepository, localDatasetRepository = null, candleStore, appState, replayEngine, tradingCapabilities, statusView, chartManager,
    chartAdapter, timeline, controls, errorPanel, modeBanner, tradingErrorView = null,
    dataStatusEl = null, cacheBadgeEl = null, startReplayBtn = null,
    headerStartReplayBtn = null, loadBtn = null, fromDateEl = null, fromTimeEl = null,
    toDateEl = null, toTimeEl = null,
  }) {
    if (!tradingCapabilities || typeof tradingCapabilities !== 'object') {
      throw new TypeError('ReplayCoordinator requires trading capabilities');
    }
    for (const capability of ['hasOpenPosition', 'hasPendingOrders', 'hasTradingActivity']) {
      if (typeof tradingCapabilities[capability] !== 'function') {
        throw new TypeError('ReplayCoordinator requires tradingCapabilities.' + capability + '()');
      }
    }
    if (!statusView || typeof statusView.snapshot !== 'function') {
      throw new TypeError('ReplayCoordinator requires statusView.snapshot()');
    }
    this.tradingErrorView = tradingErrorView;

    const previewService = createReplayPreviewService({ candleStore, chartManager, chartAdapter });
    this.previewService = previewService;

    this.loadService = createReplayLoadService({
      datasetRepository,
      localDatasetRepository,
      candleStore,
      appState,
      replayEngine,
      hasOpenPosition: tradingCapabilities.hasOpenPosition,
      hasPendingOrders: tradingCapabilities.hasPendingOrders,
      hasTradingActivity: tradingCapabilities.hasTradingActivity,
      statusView,
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
      hasTradingActivity: tradingCapabilities.hasTradingActivity,
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

  updateLoadButton() { return this.loadService.updateLoadButton(); }
  updatePreviewWindow(idx) { return this.previewService.updatePreviewWindow(idx); }
  applyWindowedChart(idx) { return this.previewService.applyWindowedChart(idx); }
  handleSymbolTimeframeChange(kind, newValue, selectElement) { return this.datasetChangeService.handleSymbolTimeframeChange(kind, newValue, selectElement); }
  showTradingError(msg) { this.tradingErrorView?.show(msg); }
  destroy() { this.loadService.destroy(); }
  async loadAndPrepareReplay(options = {}) { return this.loadService.loadAndPrepareReplay(options); }
}
