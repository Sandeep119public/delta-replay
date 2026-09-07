export const VISIBLE_WINDOW = 1000;

/**
 * ReplayPreviewService owns chart preview/w windowing for a replay cursor
 * position. Extracted from ReplayCoordinator so preview rendering is a
 * capability service with explicit dependencies rather than god-object logic.
 */
export function createReplayPreviewService({ candleStore, chartManager, chartAdapter }) {
  if (!candleStore || !chartManager || !chartAdapter) {
    throw new TypeError('createReplayPreviewService requires candleStore, chartManager, and chartAdapter');
  }
  return {
    updatePreviewWindow(idx) {
      if (!candleStore.getCount()) return;
      chartAdapter.showPreview(candleStore, idx, VISIBLE_WINDOW);
      chartManager.setAutoFollow(true);
    },
    applyWindowedChart(idx) {
      const total = candleStore.getCount();
      if (total === 0) return;
      const start = Math.max(0, idx - VISIBLE_WINDOW + 1);
      const win = candleStore.sliceWindow(start, idx);
      chartManager.setData(win, { fit: false });
    },
  };
}
