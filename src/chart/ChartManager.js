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
      layout: { background: { type: ColorType.Solid, color: '#0e1116' }, textColor: '#8a93a6' },
      grid: { vertLines: { color: '#1e242f' }, horzLines: { color: '#1e242f' } },
      crosshair: { mode: 1 },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a3342' },
      rightPriceScale: { borderColor: '#2a3342' },
      width: this.container.clientWidth,
      height: this.container.clientHeight || 400
    });

    this.series = this.chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444', borderVisible: false
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
        const tolerance = 60;
        if (range.to < this._revealedMaxTime - tolerance) {
          if (this._autoFollow) { this._autoFollow = false; this._emitAutoFollowChanged(); }
        } else if (Math.abs(range.to - this._revealedMaxTime) <= tolerance) {
          if (!this._autoFollow) { this._autoFollow = true; this._emitAutoFollowChanged(); }
        }
        if (range.to > this._revealedMaxTime) {
          this._isUserPanning = true;
          try { this.chart.timeScale().setVisibleRange({ from: range.from, to: this._revealedMaxTime }); } catch {}
          setTimeout(() => { this._isUserPanning = false; }, 50);
        }
      });
    } catch {}
  }

  _onWindowResize = () => this.resize();

  resize() {
    if (!this.chart) return;
    this.chart.applyOptions({ width: this.container.clientWidth, height: this.container.clientHeight });
  }

  setData(candles, { fit = true } = {}) {
    if (!this.series) throw new Error('Chart not initialized');
    const source = Array.isArray(candles) ? candles : [];
    const filtered = this._revealedMaxTime == null
      ? source
      : source.filter(c => c.time <= this._revealedMaxTime);
    this._isUserPanning = true;
    try {
      this.series.setData(filtered);
      if (fit && filtered.length) this.chart.timeScale().fitContent();
    } finally {
      setTimeout(() => { this._isUserPanning = false; }, 50);
    }
  }

  /**
   * Atomically reveal and append one replay candle. This is the only method
   * ChartAdapter should use for forward replay progression.
   */
  updateRevealedCandle(candle) {
    if (!this.series || !candle) return false;
    const time = Number(candle.time);
    if (!Number.isFinite(time)) return false;
    if (this._revealedMaxTime != null && time < this._revealedMaxTime) return false;

    // Set the boundary immediately before the chart operation. The previous
    // implementation advanced this in main.js after the event had fired,
    // creating an ordering race with the future-candle guard.
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
    try { this.chart.timeScale().scrollToRealTime(); } catch {}
  }

  setRevealedMax(time) {
    this._revealedMaxTime = time == null ? null : Number(time);
    if (this._autoFollow && this._revealedMaxTime != null) this.followCurrent();
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
    try { this.chart.timeScale().scrollToPosition(5, false); } catch {}
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
