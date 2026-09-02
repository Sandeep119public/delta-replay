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
    this._window = [];
  }

  attach() {
    this.detach();

    const WINDOW = 1000;
    const windowed = (arr) => arr.length > WINDOW ? arr.slice(arr.length - WINDOW) : arr;

    this._unsubs.push(this.engine.on(ReplayEvents.STARTED, ({ index }) => {
      const visible = this.engine.getVisibleCandles();
      this._window = windowed(visible).slice();
      const candle = this._window[this._window.length - 1];
      if (candle) this.chart.setRevealedMax?.(candle.time);
      this.chart.setData(this._window, { fit: true });
      this._lastRenderedIndex = index;
    }));

    this._unsubs.push(this.engine.on(ReplayEvents.SEEKED, ({ index, visibleCandles }) => {
      const visible = visibleCandles || [];
      this._window = windowed(visible).slice();
      const candle = this._window[this._window.length - 1];
      if (candle) this.chart.setRevealedMax?.(candle.time);
      this.chart.setData(this._window, { fit: true });
      this._lastRenderedIndex = index;
    }));

    this._unsubs.push(this.engine.on(ReplayEvents.RESET, (payload) => {
      const visible = payload?.visibleCandles ?? this.engine.getVisibleCandles();
      const index = payload?.index ?? (visible.length ? visible.length - 1 : -1);
      this._window = windowed(visible).slice();
      const candle = this._window[this._window.length - 1];
      if (candle) this.chart.setRevealedMax?.(candle.time);
      if (this._window.length === 0) this.chart.clear();
      else this.chart.setData(this._window, { fit: true });
      this._lastRenderedIndex = index;
    }));

    // Render the replay window from the replay event itself. We intentionally
    // use setData for forward progression rather than lightweight-charts'
    // incremental update(). The replay can be shown correctly even if the
    // chart has been resized, panned, or has a stale logical range. Only the
    // last 1000 revealed candles are retained here, so per-tick work remains
    // bounded by the chart window instead of the full historical dataset.
    this._unsubs.push(this.engine.on(ReplayEvents.STEPPED, ({ candle, index }) => {
      if (index <= this._lastRenderedIndex) return;
      this._window.push(candle);
      if (this._window.length > WINDOW) this._window.shift();
      this.chart.setRevealedMax?.(candle.time);
      this.chart.setData(this._window, { fit: false });
      this.chart.followCurrent();
      this._lastRenderedIndex = index;
    }));
  }

  detach() {
    this._unsubs.forEach(unsub => {
      try { unsub(); } catch {}
    });
    this._unsubs = [];
    this._window = [];
    this._lastRenderedIndex = -1;
  }

  showPreview(candles) {
    const WINDOW = 1000;
    const win = candles.length > WINDOW ? candles.slice(candles.length - WINDOW) : candles;
    this._window = win.slice();
    const candle = win[win.length - 1];
    if (candle) this.chart.setRevealedMax?.(candle.time);
    this.chart.setData(win, { fit: true });
    this._lastRenderedIndex = -1;
  }

  showPreviewWindow(candles, centerIdx, windowSize = 1000) {
    const start = Math.max(0, centerIdx - windowSize + 1);
    const win = candles.slice(start, centerIdx + 1);
    this._window = win.slice();
    const candle = win[win.length - 1];
    if (candle) this.chart.setRevealedMax?.(candle.time);
    this.chart.setData(win, { fit: true });
    this._lastRenderedIndex = centerIdx;
  }
}
