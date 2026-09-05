import { createChart, ColorType } from 'lightweight-charts';
import { ChartTradingOverlay } from './ChartTradingOverlay.js';

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
      layout: { background: { type: ColorType.Solid, color: '#fbf8f1' }, textColor: '#756d62' },
      grid: { vertLines: { color: 'rgba(191, 179, 162, 0.28)' }, horzLines: { color: 'rgba(191, 179, 162, 0.28)' } },
      crosshair: { mode: 1, vertLine: { color: '#9b9286', width: 1, style: 2, labelBackgroundColor: '#315f8c' }, horzLine: { color: '#9b9286', width: 1, style: 2, labelBackgroundColor: '#315f8c' } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#d7cebf', rightOffset: 12, barSpacing: 10, minBarSpacing: 4, ticksVisible: true },
      rightPriceScale: { borderColor: '#d7cebf', autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } },
      width: this.container.clientWidth || 800,
      height: this.container.clientHeight || 450,
    });

    this.series = this.chart.addCandlestickSeries({
      upColor: '#2f7d58', downColor: '#b44842', borderVisible: true,
      borderUpColor: '#2f7d58', borderDownColor: '#b44842',
      wickUpColor: '#2f7d58', wickDownColor: '#b44842', wickVisible: true,
    });

    this._revealedMaxTime = null;
    this._autoFollow = true;
    this._isUserPanning = false;
    this._positionLine = null;
    this._stopLossLine = null;
    this._takeProfitLine = null;
    this._orderLines = new Map();
    this._onChartClickCallbacks = [];

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);
    window.addEventListener('resize', this._onWindowResize);

    try {
      this.chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
        if (!range || this._revealedMaxTime == null || this._isUserPanning) return;
        if (range.to < this._revealedMaxTime) {
          if (this._autoFollow) { this._autoFollow = false; this._emitAutoFollowChanged(); }
        } else if (range.to >= this._revealedMaxTime) {
          if (!this._autoFollow) { this._autoFollow = true; this._emitAutoFollowChanged(); }
        }
      });
      this.chart.subscribeClick((param) => {
        if (!param || !param.point || !this.series) return;
        const price = this.coordinateToPrice(param.point.y);
        if (price != null && Number.isFinite(price)) {
          this._onChartClickCallbacks.forEach(cb => { try { cb({ price, point: param.point, time: param.time }); } catch {} });
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
      const time = Number(c.time), open = Number(c.open), close = Number(c.close);
      let high = Number(c.high), low = Number(c.low);
      if (high <= low || Math.abs(high - low) < 1e-4) {
        const tickSpread = Math.max(close * 0.00015, Math.abs(close) > 0 ? Math.abs(close) * 0.00001 : 0.0001);
        high = Math.max(open, close) + tickSpread * 0.5;
        low = Math.min(open, close) - tickSpread * 0.5;
      }
      result.push({ time, open, high, low, close });
    }
    return result;
  }

  _detectPrecision(candles) {
    if (!candles || !candles.length) return { type: 'price', precision: 2, minMove: 0.01 };
    const price = candles[0]?.close || candles[0]?.open || 100;
    if (price < 0.1) return { type: 'price', precision: 6, minMove: 0.000001 };
    if (price < 10) return { type: 'price', precision: 4, minMove: 0.0001 };
    return { type: 'price', precision: 2, minMove: 0.01 };
  }

  setData(candles, { fit = true } = {}) {
    if (!this.series) throw new Error('Chart not initialized');
    const source = Array.isArray(candles) ? candles : [];
    const filtered = this._revealedMaxTime == null ? source : source.filter(c => Number(c.time) <= this._revealedMaxTime);
    const prepared = this._prepareCandlesForChart(filtered);
    this._isUserPanning = true;
    try {
      if (prepared.length) { try { this.series.applyOptions({ priceFormat: this._detectPrecision(prepared) }); } catch {} }
      this.series.setData(prepared);
      try { this.chart.priceScale('right').applyOptions({ autoScale: true }); } catch {}
      if (fit && prepared.length) this.chart.timeScale().fitContent();
      else if (this._autoFollow) this.chart.timeScale().scrollToPosition(3, false);
    } finally { setTimeout(() => { this._isUserPanning = false; }, 50); }
  }

  renderReplayWindow(candles, { fit = false } = {}) {
    if (!this.series) throw new Error('Chart not initialized');
    const source = Array.isArray(candles) ? candles : [];
    const valid = source.filter(c => c && Number.isFinite(Number(c.time)));
    if (!valid.length) { this.series.setData([]); return; }
    this._revealedMaxTime = Number(valid[valid.length - 1].time);
    const prepared = this._prepareCandlesForChart(valid);
    this._isUserPanning = true;
    try {
      try { this.series.applyOptions({ priceFormat: this._detectPrecision(prepared) }); } catch {}
      this.series.setData(prepared);
      try { this.chart.priceScale('right').applyOptions({ autoScale: true }); } catch {}
      if (fit) this.chart.timeScale().fitContent(); else if (this._autoFollow) this.chart.timeScale().scrollToPosition(3, false);
    } finally { setTimeout(() => { this._isUserPanning = false; }, 50); }
  }

  updateRevealedCandle(candle) {
    if (!this.series || !candle) return false;
    const time = Number(candle.time);
    if (!Number.isFinite(time)) return false;
    if (this._revealedMaxTime != null && time < this._revealedMaxTime) return false;
    this._revealedMaxTime = time;
    try { this.series.update(candle); if (this._autoFollow) this.followCurrent(); return true; }
    catch (error) { try { console.error('[ChartManager] replay candle update failed', error); } catch {} return false; }
  }

  update(candle) { if (!this.series) throw new Error('Chart not initialized'); if (this._revealedMaxTime != null && candle.time > this._revealedMaxTime) return false; this.series.update(candle); return true; }
  clampVisibleRange(range) { if (!range || this._revealedMaxTime == null) return range; return range.to > this._revealedMaxTime ? { from: range.from, to: this._revealedMaxTime } : range; }
  followCurrent() { if (!this.chart || !this._autoFollow) return; try { this.chart.timeScale().scrollToPosition(3, false); } catch {} }
  setRevealedMax(time) { this._revealedMaxTime = time == null ? null : Number(time); }
  setAutoFollow(v) { this._autoFollow = !!v; this._emitAutoFollowChanged(); if (this._autoFollow) this.followCurrent(); }
  isAutoFollow() { return this._autoFollow; }
  _emitAutoFollowChanged() { try { if (this._onAutoFollowChange) this._onAutoFollowChange(this._autoFollow); } catch {} }
  onAutoFollowChange(cb) { this._onAutoFollowChange = cb; }
  scrollToTime(unixSec) { if (!this.chart || !Number.isFinite(unixSec)) return; try { const timeScale = this.chart.timeScale(); const coord = timeScale.timeToCoordinate(unixSec); if (coord !== null && Number.isFinite(coord)) { const logical = timeScale.coordinateToLogical(coord); if (logical !== null && Number.isFinite(logical)) { timeScale.scrollToPosition(logical, false); return; } } timeScale.scrollToPosition(3, false); } catch { try { this.chart.timeScale().scrollToPosition(3, false); } catch {} } }
  coordinateToPrice(y) { if (!this.series || !Number.isFinite(y)) return null; try { return this.series.coordinateToPrice(y); } catch { return null; } }
  onChartClick(cb) { if (typeof cb === 'function') this._onChartClickCallbacks.push(cb); }

  get tradingOverlay() {
    if (!this._tradingOverlay) {
      this._tradingOverlay = new ChartTradingOverlay(this);
    }
    return this._tradingOverlay;
  }

  updatePositionLines(position) {
    this.tradingOverlay.updatePositionLines(position);
  }

  clearPositionLines() {
    this.tradingOverlay.clearPositionLines();
  }

  updateOrderLines(orders) {
    this.tradingOverlay.updateOrderLines(orders);
  }

  clearTradingLines() {
    this.tradingOverlay.clearTradingLines();
  }

  clear() {
    this.clearTradingLines();
    if (this.series) this.series.setData([]);
  }

  destroy() {
    this.clearTradingLines();
    window.removeEventListener('resize', this._onWindowResize);
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    this._onChartClickCallbacks = [];
    this._onAutoFollowChange = null;
    if (this.chart) {
      try { this.chart.remove(); } catch {}
      this.chart = null;
      this.series = null;
    }
  }
}
