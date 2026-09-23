import { createDatasetChangeService } from './DatasetChangeService.js';

export const VISIBLE_WINDOW = 1000;
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

    this.candleStore = candleStore;
    this.chartManager = chartManager;
    this.chartAdapter = chartAdapter;
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
  updatePreviewWindow(idx) {
    if (!this.candleStore.getCount()) return;
    this.chartAdapter.showPreview(this.candleStore, idx, VISIBLE_WINDOW);
    this.chartManager.setAutoFollow(true);
  }

  applyWindowedChart(idx) {
    const total = this.candleStore.getCount();
    if (!total) return;
    const start = Math.max(0, idx - VISIBLE_WINDOW + 1);
    this.chartManager.setData(this.candleStore.sliceWindow(start, idx), { fit: false });
  }
  handleSymbolTimeframeChange(kind, newValue, selectElement) { return this.datasetChangeService.handleSymbolTimeframeChange(kind, newValue, selectElement); }
  showTradingError(msg) { this.tradingErrorView?.show(msg); }
  destroy() { this.loadService.destroy(); }
  async loadAndPrepareReplay(options = {}) { return this.loadService.loadAndPrepareReplay(options); }
}
