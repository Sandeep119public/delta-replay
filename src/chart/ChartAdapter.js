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

    // A new replay starts with one visible candle. Render it as a complete
    // dataset so the chart has a deterministic baseline.
    this._unsubs.push(this.engine.on(ReplayEvents.STARTED, ({ index }) => {
      const visible = this.engine.getVisibleCandles();
      this.chart.setData(windowed(visible));
      this._lastRenderedIndex = index;
    }));

    // Seek/reset replace the visible dataset. Never use update() for these
    // because the new range may move backwards.
    this._unsubs.push(this.engine.on(ReplayEvents.SEEKED, ({ index, visibleCandles }) => {
      this.chart.setData(windowed(visibleCandles || []));
      this._lastRenderedIndex = index;
    }));

    this._unsubs.push(this.engine.on(ReplayEvents.RESET, (payload) => {
      const visible = payload?.visibleCandles ?? this.engine.getVisibleCandles();
      const index = payload?.index ?? (visible.length ? visible.length - 1 : -1);
      if (visible.length === 0) this.chart.clear();
      else this.chart.setData(windowed(visible));
      this._lastRenderedIndex = index;
    }));

    // IMPORTANT: drive chart progression from STEPPED, not MARKET_CANDLE.
    // MARKET_CANDLE is the trading interface and should not be required for
    // chart rendering. This makes replay rendering deterministic even when
    // trading listeners are absent or changed.
    this._unsubs.push(this.engine.on(ReplayEvents.STEPPED, ({ candle, index }) => {
      if (index <= this._lastRenderedIndex) return;
      this.chart.update(candle);
      this._lastRenderedIndex = index;
      this.chart.followCurrent();
    }));

    // Keep the chart synchronized if a caller emits a market candle directly
    // after a state transition where no STEPPED event was observed.
    this._unsubs.push(this.engine.on(ReplayEvents.MARKET_CANDLE, ({ candle, index }) => {
      if (index <= this._lastRenderedIndex) return;
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
    this.chart.setData(win);
    this._lastRenderedIndex = -1;
  }

  showPreviewWindow(candles, centerIdx, windowSize = 1000) {
    const start = Math.max(0, centerIdx - windowSize + 1);
    const win = candles.slice(start, centerIdx + 1);
    this.chart.setData(win);
    this._lastRenderedIndex = centerIdx;
  }
}
