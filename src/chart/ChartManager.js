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

    // Resize observer
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);
    window.addEventListener('resize', this._onWindowResize);
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
   */
  setData(candles) {
    if (!this.series) throw new Error('Chart not initialized');
    this.series.setData(candles);
    this.chart.timeScale().fitContent();
  }

  /**
   * Append single new candle during replay.
   * Must use update, not setData, for performance.
   */
  update(candle) {
    if (!this.series) throw new Error('Chart not initialized');
    this.series.update(candle);
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
