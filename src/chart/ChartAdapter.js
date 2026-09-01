import { ReplayEvents } from '../replay/ReplayEvents.js';

/**
 * ChartAdapter subscribes to ReplayEngine events and drives ChartManager.
 * It is the ONLY bridge between replay and chart. ReplayEngine remains ignorant.
 */
export class ChartAdapter {
  /**
   * @param {import('../replay/ReplayEngine.js').ReplayEngine} engine
   * @param {import('./ChartManager.js').ChartManager} chartManager
   */
  constructor(engine, chartManager) {
    this.engine = engine;
    this.chart = chartManager;
    this._unsubs = [];
  }

  attach() {
    this._unsubs.push(this.engine.on(ReplayEvents.LOADED, () => {
      // No chart update on loaded alone; wait for start/seek or direct load display.
    }));

    const WINDOW = 1000;
    const windowed = (arr) => arr.length > WINDOW ? arr.slice(arr.length - WINDOW) : arr;

    this._unsubs.push(this.engine.on(ReplayEvents.STARTED, ({ index }) => {
      const visible = this.engine.getVisibleCandles();
      this.chart.setData(windowed(visible));
    }));

    // Single candle reveal: use update for performance
    const onCandle = ({ candle }) => {
      // If this is the first candle after start, setData already handled.
      // But for step/play we update. Need to distinguish: if visible length is 1, already set.
      // Simpler: for marketCandle after STARTED, the chart already has that candle.
      // For subsequent candles, we update.
      // We track whether chart has data. For STEPPED / PLAY ticks we update.
      this.chart.update(candle);
    };
    // Deduplicate: after STARTED/SEEKED/RESET we already setData including that candle,
    // so the subsequent MARKET_CANDLE for same index must not duplicate via update.
    let lastSetIndex = -1;
    this._unsubs.push(this.engine.on(ReplayEvents.STARTED, ({ index }) => { lastSetIndex = index; }));
    this._unsubs.push(this.engine.on(ReplayEvents.SEEKED, ({ index, visibleCandles }) => {
      lastSetIndex = index;
      this.chart.setData(windowed(visibleCandles));
    }));
    this._unsubs.push(this.engine.on(ReplayEvents.RESET, (payload) => {
      // payload may include visibleCandles/index after fix, fallback to getVisibleCandles
      const visible = payload?.visibleCandles ?? this.engine.getVisibleCandles();
      const idx = payload?.index ?? (visible.length ? visible.length - 1 : -1);
      lastSetIndex = idx;
      if (visible.length === 0) this.chart.clear();
      else this.chart.setData(windowed(visible));
    }));
    this._unsubs.push(this.engine.on(ReplayEvents.MARKET_CANDLE, ({ candle, index }) => {
      if (index === lastSetIndex) {
        // already in setData
        return;
      }
      this.chart.update(candle);
      // Auto-follow newest candle without resetting zoom
      this.chart.followCurrent();
    }));

    // Also handle direct display before replay (preview mode)
    // When user loads data but hasn't started replay, we want to show full dataset as preview.
    // That is handled outside adapter via AppState - but we provide helper.
  }

  detach() {
    this._unsubs.forEach(fn => fn());
    this._unsubs = [];
  }

  /**
   * Preview: show windowed candles before replay starts (TradingView-style, hide future).
   * Expects full array but will window to last 1000 if large.
   */
  showPreview(candles) {
    const WINDOW = 1000;
    const win = candles.length > WINDOW ? candles.slice(candles.length - WINDOW) : candles;
    this.chart.setData(win);
  }

  showPreviewWindow(candles, centerIdx, windowSize = 1000) {
    const start = Math.max(0, centerIdx - windowSize + 1);
    const win = candles.slice(start, centerIdx + 1);
    this.chart.setData(win);
  }
}
