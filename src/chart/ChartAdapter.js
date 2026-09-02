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

    const render = (index, { fit = false } = {}) => {
      const window = visibleWindow();
      if (!window.length) {
        this.chart.clear();
        this._lastRenderedIndex = -1;
        return;
      }

      // Full redraw from the authoritative replay snapshot. This deliberately
      // avoids lightweight-charts incremental-update state and guarantees the
      // chart contents match the replay cursor exactly.
      if (typeof this.chart.renderReplayWindow === 'function') {
        this.chart.renderReplayWindow(window, { fit });
      } else {
        this.chart.setRevealedMax?.(window[window.length - 1].time);
        this.chart.setData(window, { fit });
        if (!fit && this.chart.followCurrent) {
          this.chart.followCurrent();
        }
      }
      this._lastRenderedIndex = index;
    };

    this._unsubs.push(this.engine.on(ReplayEvents.STARTED, ({ index }) => render(index, { fit: true })));
    this._unsubs.push(this.engine.on(ReplayEvents.SEEKED, ({ index }) => render(index, { fit: true })));
    this._unsubs.push(this.engine.on(ReplayEvents.RESET, (payload) => {
      render(payload?.index ?? this.engine.getState().currentIndex, { fit: true });
    }));
    this._unsubs.push(this.engine.on(ReplayEvents.STEPPED, ({ index }) => {
      if (index > this._lastRenderedIndex) render(index, { fit: false });
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
