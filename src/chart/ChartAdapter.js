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
    const windowed = (arr) => arr.length > WINDOW ? arr.slice(arr.length - WINDOW) : arr;

    this._unsubs.push(this.engine.on(ReplayEvents.STARTED, ({ index }) => {
      const visible = this.engine.getVisibleCandles();
      const candle = visible[visible.length - 1];
      if (candle) this.chart.setRevealedMax?.(candle.time);
      this.chart.setData(windowed(visible));
      this._lastRenderedIndex = index;
    }));

    this._unsubs.push(this.engine.on(ReplayEvents.SEEKED, ({ index, visibleCandles }) => {
      const visible = visibleCandles || [];
      const candle = visible[visible.length - 1];
      if (candle) this.chart.setRevealedMax?.(candle.time);
      this.chart.setData(windowed(visible));
      this._lastRenderedIndex = index;
    }));

    this._unsubs.push(this.engine.on(ReplayEvents.RESET, (payload) => {
      const visible = payload?.visibleCandles ?? this.engine.getVisibleCandles();
      const index = payload?.index ?? (visible.length ? visible.length - 1 : -1);
      const candle = visible[visible.length - 1];
      if (candle) this.chart.setRevealedMax?.(candle.time);
      if (visible.length === 0) this.chart.clear();
      else this.chart.setData(windowed(visible));
      this._lastRenderedIndex = index;
    }));

    // ReplayEngine emits STEPPED before main.js receives its own stepped
    // listener. ChartManager rejects updates newer than its current
    // revealedMax, so advance that boundary before every chart update.
    // Without this ordering the replay index advances while the chart stays
    // frozen at the starting candle.
    this._unsubs.push(this.engine.on(ReplayEvents.STEPPED, ({ candle, index }) => {
      if (index <= this._lastRenderedIndex) return;
      this.chart.setRevealedMax?.(candle.time);
      this.chart.update(candle);
      this._lastRenderedIndex = index;
      this.chart.followCurrent();
    }));

    this._unsubs.push(this.engine.on(ReplayEvents.MARKET_CANDLE, ({ candle, index }) => {
      if (index <= this._lastRenderedIndex) return;
      this.chart.setRevealedMax?.(candle.time);
      this.chart.update(candle);
      this._lastRenderedIndex = index;
      this.chart.followCurrent();
    }));
  }

  detach() {
    this._unsubs.forEach(unsub => {
      try { unsub(); } catch {}
    });
    this._unsubs = [];
  }

  showPreview(candles) {
    const WINDOW = 1000;
    const win = candles.length > WINDOW ? candles.slice(candles.length - WINDOW) : candles;
    const candle = win[win.length - 1];
    if (candle) this.chart.setRevealedMax?.(candle.time);
    this.chart.setData(win);
    this._lastRenderedIndex = -1;
  }

  showPreviewWindow(candles, centerIdx, windowSize = 1000) {
    const start = Math.max(0, centerIdx - windowSize + 1);
    const win = candles.slice(start, centerIdx + 1);
    const candle = win[win.length - 1];
    if (candle) this.chart.setRevealedMax?.(candle.time);
    this.chart.setData(win);
    this._lastRenderedIndex = centerIdx;
  }
}
