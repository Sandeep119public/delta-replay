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

    this._unsubs.push(this.engine.on(ReplayEvents.STARTED, ({ index }) => {
      const visible = this.engine.getVisibleCandles();
      this.chart.setData(visible);
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
      this.chart.setData(visibleCandles);
    }));
    this._unsubs.push(this.engine.on(ReplayEvents.RESET, (payload) => {
      // payload may include visibleCandles/index after fix, fallback to getVisibleCandles
      const visible = payload?.visibleCandles ?? this.engine.getVisibleCandles();
      const idx = payload?.index ?? (visible.length ? visible.length - 1 : -1);
      lastSetIndex = idx;
      if (visible.length === 0) this.chart.clear();
      else this.chart.setData(visible);
    }));
    this._unsubs.push(this.engine.on(ReplayEvents.MARKET_CANDLE, ({ candle, index }) => {
      if (index === lastSetIndex) {
        // already in setData
        return;
      }
      this.chart.update(candle);
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
   * Preview: show all candles before replay starts (user browsing).
   */
  showPreview(candles) {
    this.chart.setData(candles);
  }
}
