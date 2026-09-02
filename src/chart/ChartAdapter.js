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

    // Forward replay is driven ONLY by STEPPED. MARKET_CANDLE is reserved for
    // the trading boundary. Keeping chart rendering on one event removes the
    // race/deduplication ambiguity between chart and paper-trading listeners.
    this._unsubs.push(this.engine.on(ReplayEvents.STEPPED, ({ candle, index }) => {
      if (index <= this._lastRenderedIndex) return;
      const updated = this.chart.updateRevealedCandle
        ? this.chart.updateRevealedCandle(candle)
        : (this.chart.setRevealedMax?.(candle.time), this.chart.update(candle));
      if (!updated) {
        // Do not advance the rendered index if the chart rejected the candle.
        // A subsequent state update can then attempt to recover deterministically.
        return;
      }
      this._lastRenderedIndex = index;
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
