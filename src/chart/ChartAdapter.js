import { ReplayEvents } from '../replay/ReplayEvents.js';

/**
 * ChartAdapter is the only bridge between ReplayEngine and ChartManager.
 * ReplayEngine remains completely chart-agnostic.
 */
export class ChartAdapter {
  constructor(engine, chartManager) {
    this.engine = engine;
    this.chart = chartManager;
    this._unsubs = [];
    this._lastRenderedIndex = -1;
  }

  attach() {
    this.detach();

    const WINDOW = 1000;
    const visibleWindow = () => {
      const visible = this.engine.getVisibleCandles();
      return visible.length > WINDOW ? visible.slice(-WINDOW) : visible;
    };

    const render = (index, fit = false) => {
      const window = visibleWindow();
      const last = window[window.length - 1];
      if (!last) {
        this.chart.clear();
        this._lastRenderedIndex = -1;
        return;
      }

      // The chart is rendered from the ReplayEngine snapshot itself. Do not
      // maintain a second incremental candle queue here: the engine is the
      // authoritative replay cursor and visible-candle set.
      this.chart.renderReplayWindow?.(window, { fit });
      if (!this.chart.renderReplayWindow) {
        this.chart.setRevealedMax?.(last.time);
        this.chart.setData(window, { fit });
      }
      this._lastRenderedIndex = index;
    };

    this._unsubs.push(this.engine.on(ReplayEvents.STARTED, ({ index }) => render(index, true)));
    this._unsubs.push(this.engine.on(ReplayEvents.SEEKED, ({ index }) => render(index, true)));
    this._unsubs.push(this.engine.on(ReplayEvents.RESET, (payload) => {
      const index = payload?.index ?? this.engine.getState().currentIndex;
      render(index, true);
    }));

    // Forward replay is deliberately a full bounded-window render. This is
    // O(1000) per candle and avoids all lightweight-charts incremental-update
    // state/order problems while remaining bounded for large datasets.
    this._unsubs.push(this.engine.on(ReplayEvents.STEPPED, ({ index }) => {
      if (index <= this._lastRenderedIndex) return;
      render(index, false);
    }));
  }

  detach() {
    this._unsubs.forEach(unsub => {
      try { unsub(); } catch {}
    });
    this._unsubs = [];
    this._lastRenderedIndex = -1;
  }

  showPreview(candles) {
    const WINDOW = 1000;
    const win = candles.length > WINDOW ? candles.slice(-WINDOW) : candles;
    this.chart.setRevealedMax?.(win[win.length - 1]?.time ?? null);
    this.chart.setData(win, { fit: true });
    this._lastRenderedIndex = -1;
  }

  showPreviewWindow(candles, centerIdx, windowSize = 1000) {
    const start = Math.max(0, centerIdx - windowSize + 1);
    const win = candles.slice(start, centerIdx + 1);
    this.chart.setRevealedMax?.(win[win.length - 1]?.time ?? null);
    this.chart.setData(win, { fit: true });
    this._lastRenderedIndex = centerIdx;
  }
}
