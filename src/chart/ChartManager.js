import { createChart, ColorType } from 'lightweight-charts';

/**
 * ChartManager owns lightweight-charts instance. No replay logic inside.
 */
export class ChartManager {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    if (!container) throw new Error('ChartManager requires container element');
    this.container = container;
    this.chart = null;
    this.series = null;
  }

  init() {
    if (this.chart) return;
    this.chart = createChart(this.container, {
      layout: {
        background: { type: ColorType.Solid, color: '#0e1116' },
        textColor: '#8a93a6'
      },
      grid: {
        vertLines: { color: '#1e242f' },
        horzLines: { color: '#1e242f' }
      },
      crosshair: { mode: 1 },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#2a3342'
      },
      rightPriceScale: { borderColor: '#2a3342' },
      width: this.container.clientWidth,
      height: this.container.clientHeight || 400
    });

    this.series = this.chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      borderVisible: false
    });

    // Revealed max and auto-follow
    this._revealedMaxTime = null;
    this._autoFollow = true;
    this._isUserPanning = false;

    // Resize observer
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);
    window.addEventListener('resize', this._onWindowResize);

    // Detect manual pan: if visible range moves away from revealed max, disable auto-follow
    try {
      this.chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
        if (!range || this._revealedMaxTime == null) return;
        if (this._isUserPanning) return; // avoid feedback loop
        // If user pans left away from max (visible to < revealed - tolerance), disable autoFollow
        const tolerance = 60; // 1m
        if (range.to < this._revealedMaxTime - tolerance) {
          if (this._autoFollow) {
            this._autoFollow = false;
            this._emitAutoFollowChanged();
          }
        } else if (Math.abs(range.to - this._revealedMaxTime) <= tolerance) {
          if (!this._autoFollow) {
            this._autoFollow = true;
            this._emitAutoFollowChanged();
          }
        }
        // Clamp future pan: never allow visible to exceed revealed
        if (range.to > this._revealedMaxTime) {
          this._isUserPanning = true;
          try {
            const from = range.from;
            const clamped = { from, to: this._revealedMaxTime };
            // Preserve from, clamp to
            this.chart.timeScale().setVisibleRange(clamped);
          } catch {}
          setTimeout(() => { this._isUserPanning = false; }, 50);
        }
      });
    } catch {}
  }

  _onWindowResize = () => this.resize();

  resize() {
    if (!this.chart) return;
    this.chart.applyOptions({
      width: this.container.clientWidth,
      height: this.container.clientHeight
    });
  }

  /**
   * Load full visible dataset initially (or on seek/reset).
   * @param {Array} candles - canonical candles visible
   * @param {object} [opts]
   * @param {boolean} [opts.fit=true] - whether to fit content (preview/seek). False preserves zoom.
   */
  setData(candles, { fit = true } = {}) {
    if (!this.series) throw new Error('Chart not initialized');
    // Future protection: never display candles beyond revealedMax (programmatic + user path)
    let filtered = candles;
    if (this._revealedMaxTime != null && candles.length) {
      filtered = candles.filter(c => c.time <= this._revealedMaxTime);
      if (filtered.length !== candles.length) {
        try { console.warn('[ChartManager] filtered future candles beyond revealedMax'); } catch {}
      }
    }
    this._isUserPanning = true;
    try {
      this.series.setData(filtered);
      if (fit && filtered.length) this.chart.timeScale().fitContent();
    } finally {
      setTimeout(() => { this._isUserPanning = false; }, 50);
    }
  }

  /**
   * Append single new candle during replay.
   * Must use update, not setData, for performance.
   */
  update(candle) {
    if (!this.series) throw new Error('Chart not initialized');
    if (this._revealedMaxTime != null && candle.time > this._revealedMaxTime) {
      // Programmatic future update rejected
      return;
    }
    this.series.update(candle);
  }

  /**
   * Programmatic range enforcement: clamp future pan attempts.
   * Used for testing and for external callers that set visible range directly.
   */
  clampVisibleRange(range) {
    if (!range || this._revealedMaxTime == null) return range;
    if (range.to > this._revealedMaxTime) {
      return { from: range.from, to: this._revealedMaxTime };
    }
    return range;
  }

  /**
   * Keep newest candle visible without destroying zoom.
   * Uses scrollToRealTime which preserves logical range width.
   */
  followCurrent() {
    if (!this.chart || !this._autoFollow) return;
    try {
      this.chart.timeScale().scrollToRealTime();
    } catch {}
  }

  setRevealedMax(time) {
    this._revealedMaxTime = time == null ? null : Number(time);
    // If auto-follow is on, ensure we follow
    if (this._autoFollow && this._revealedMaxTime != null) this.followCurrent();
  }

  setAutoFollow(v) {
    this._autoFollow = !!v;
    this._emitAutoFollowChanged();
    if (this._autoFollow) this.followCurrent();
  }

  isAutoFollow() { return this._autoFollow; }

  _emitAutoFollowChanged() {
    try {
      if (this._onAutoFollowChange) this._onAutoFollowChange(this._autoFollow);
    } catch {}
  }

  onAutoFollowChange(cb) { this._onAutoFollowChange = cb; }

  /**
   * Scroll to specific index's time.
   */
  scrollToTime(unixSec) {
    if (!this.chart) return;
    try {
      this.chart.timeScale().scrollToPosition(5, false);
    } catch {}
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
