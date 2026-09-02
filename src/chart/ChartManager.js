import { createChart, ColorType } from 'lightweight-charts';

/**
 * ChartManager owns lightweight-charts instance. No replay logic inside.
 */
export class ChartManager {
  constructor(container) {
    if (!container) throw new Error('ChartManager requires container element');
    this.container = container;
    this.chart = null;
    this.series = null;
  }

  init() {
    if (this.chart) return;
    this.chart = createChart(this.container, {
      layout: { background: { type: ColorType.Solid, color: '#0d1117' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: 'rgba(42, 51, 66, 0.35)' }, horzLines: { color: 'rgba(42, 51, 66, 0.35)' } },
      crosshair: { mode: 1 },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#242b38',
        rightOffset: 12,
        barSpacing: 10,
        minBarSpacing: 4,
      },
      rightPriceScale: {
        borderColor: '#242b38',
        autoScale: true,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      width: this.container.clientWidth || 800,
      height: this.container.clientHeight || 450
    });

    this.series = this.chart.addCandlestickSeries({
      upColor: '#089981',
      downColor: '#f23645',
      borderVisible: true,
      borderUpColor: '#089981',
      borderDownColor: '#f23645',
      wickUpColor: '#089981',
      wickDownColor: '#f23645',
      wickVisible: true,
    });

    this._revealedMaxTime = null;
    this._autoFollow = true;
    this._isUserPanning = false;

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);
    window.addEventListener('resize', this._onWindowResize);

    try {
      this.chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
        if (!range || this._revealedMaxTime == null || this._isUserPanning) return;
        // User scrolled back into history
        if (range.to < this._revealedMaxTime) {
          if (this._autoFollow) { this._autoFollow = false; this._emitAutoFollowChanged(); }
        } else if (range.to >= this._revealedMaxTime) {
          if (!this._autoFollow) { this._autoFollow = true; this._emitAutoFollowChanged(); }
        }
      });
    } catch {}
  }

  _onWindowResize = () => this.resize();

  resize() {
    if (!this.chart) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width <= 0 || height <= 0) return;
    this.chart.applyOptions({ width, height });
  }

  _prepareCandlesForChart(candles) {
    if (!Array.isArray(candles) || candles.length === 0) return [];
    const result = [];
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      let time = Number(c.time);
      let open = Number(c.open);
      let high = Number(c.high);
      let low = Number(c.low);
      let close = Number(c.close);
      const prev = i > 0 ? candles[i - 1] : null;

      // When Delta/providers return sparse flat ticks where open == close and high == low:
      if (high <= low || Math.abs(high - low) < 1e-4) {
        if (prev && Number.isFinite(Number(prev.close)) && Math.abs(Number(prev.close) - close) > 0.01) {
          open = Number(prev.close);
        }
        const tickSpread = Math.max(close * 0.00015, Math.abs(close) > 0 ? Math.abs(close) * 0.00001 : 0.0001);
        high = Math.max(open, close) + tickSpread * 0.5;
        low = Math.min(open, close) - tickSpread * 0.5;
      } else if (open === close && prev && Math.abs(Number(prev.close) - close) > 0.01) {
        open = Number(prev.close);
        high = Math.max(high, open);
        low = Math.min(low, open);
      }

      result.push({
        time,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
      });
    }
    return result;
  }

  _detectPrecision(candles) {
    if (!candles || !candles.length) return { type: 'price', precision: 2, minMove: 0.01 };
    const sample = candles[0];
    const price = sample?.close || sample?.open || 100;
    if (price < 0.1) return { type: 'price', precision: 6, minMove: 0.000001 };
    if (price < 1) return { type: 'price', precision: 4, minMove: 0.0001 };
    if (price < 10) return { type: 'price', precision: 4, minMove: 0.0001 };
    return { type: 'price', precision: 2, minMove: 0.01 };
  }

  setData(candles, { fit = true } = {}) {
    if (!this.series) throw new Error('Chart not initialized');
    const source = Array.isArray(candles) ? candles : [];
    const filtered = this._revealedMaxTime == null
      ? source
      : source.filter(c => Number(c.time) <= this._revealedMaxTime);
    const prepared = this._prepareCandlesForChart(filtered);
    this._isUserPanning = true;
    try {
      if (prepared.length) {
        try { this.series.applyOptions({ priceFormat: this._detectPrecision(prepared) }); } catch {}
      }
      this.series.setData(prepared);
      try { this.chart.priceScale('right').applyOptions({ autoScale: true }); } catch {}
      if (fit && prepared.length) {
        this.chart.timeScale().fitContent();
      } else if (this._autoFollow) {
        this.chart.timeScale().scrollToPosition(3, false);
      }
    } finally {
      setTimeout(() => { this._isUserPanning = false; }, 50);
    }
  }

  /**
   * Render the complete currently revealed replay window.
   * The caller supplies only candles that are already known to the replay.
   * Rebuilding a bounded window avoids incremental update state problems and
   * guarantees the chart matches the replay cursor exactly.
   */
  renderReplayWindow(candles, { fit = false } = {}) {
    if (!this.series) throw new Error('Chart not initialized');
    const source = Array.isArray(candles) ? candles : [];
    const valid = source.filter(c => c && Number.isFinite(Number(c.time)));
    if (!valid.length) {
      this.series.setData([]);
      return;
    }

    const last = valid[valid.length - 1];
    this._revealedMaxTime = Number(last.time);
    const prepared = this._prepareCandlesForChart(valid);
    this._isUserPanning = true;
    try {
      if (prepared.length) {
        try { this.series.applyOptions({ priceFormat: this._detectPrecision(prepared) }); } catch {}
      }
      this.series.setData(prepared);
      // Force the price scale to recalculate from the new dataset.
      try { this.chart.priceScale('right').applyOptions({ autoScale: true }); } catch {}
      if (fit) {
        this.chart.timeScale().fitContent();
      } else if (this._autoFollow) {
        this.chart.timeScale().scrollToPosition(3, false);
      }
    } finally {
      setTimeout(() => { this._isUserPanning = false; }, 50);
    }
  }

  updateRevealedCandle(candle) {
    if (!this.series || !candle) return false;
    const time = Number(candle.time);
    if (!Number.isFinite(time)) return false;
    if (this._revealedMaxTime != null && time < this._revealedMaxTime) return false;
    this._revealedMaxTime = time;
    try {
      this.series.update(candle);
      if (this._autoFollow) this.followCurrent();
      return true;
    } catch (error) {
      try { console.error('[ChartManager] replay candle update failed', error); } catch {}
      return false;
    }
  }

  update(candle) {
    if (!this.series) throw new Error('Chart not initialized');
    if (this._revealedMaxTime != null && candle.time > this._revealedMaxTime) return false;
    this.series.update(candle);
    return true;
  }

  clampVisibleRange(range) {
    if (!range || this._revealedMaxTime == null) return range;
    return range.to > this._revealedMaxTime
      ? { from: range.from, to: this._revealedMaxTime }
      : range;
  }

  followCurrent() {
    if (!this.chart || !this._autoFollow) return;
    try { this.chart.timeScale().scrollToPosition(3, false); } catch {}
  }

  setRevealedMax(time) {
    this._revealedMaxTime = time == null ? null : Number(time);
  }

  setAutoFollow(v) {
    this._autoFollow = !!v;
    this._emitAutoFollowChanged();
    if (this._autoFollow) this.followCurrent();
  }

  isAutoFollow() { return this._autoFollow; }

  _emitAutoFollowChanged() {
    try { if (this._onAutoFollowChange) this._onAutoFollowChange(this._autoFollow); } catch {}
  }

  onAutoFollowChange(cb) { this._onAutoFollowChange = cb; }

  scrollToTime(unixSec) {
    if (!this.chart) return;
    try { this.chart.timeScale().scrollToPosition(3, false); } catch {}
  }

  clear() {
    if (this.series) this.series.setData([]);
  }

  destroy() {
    window.removeEventListener('resize', this._onWindowResize);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this.chart) {
      this.chart.remove();
      this.chart = null;
      this.series = null;
    }
  }
}
