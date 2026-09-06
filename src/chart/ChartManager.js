import { createChart, ColorType } from 'lightweight-charts';
import { ChartTradingOverlay } from './ChartTradingOverlay.js';

export const CHART_THEMES = {
  dark: { layout: { background: { type: ColorType.Solid, color: '#0b0f17' }, textColor: '#94a3b8' }, grid: { vertLines: { color: 'rgba(30, 41, 59, 0.5)' }, horzLines: { color: 'rgba(30, 41, 59, 0.5)' } }, crosshair: { vertLine: { color: '#475569', labelBackgroundColor: '#0284c7' }, horzLine: { color: '#475569', labelBackgroundColor: '#0284c7' } }, timeScale: { borderColor: '#1e293b' }, rightPriceScale: { borderColor: '#1e293b' }, series: { upColor: '#10b981', downColor: '#ef4444', borderUpColor: '#10b981', borderDownColor: '#ef4444', wickUpColor: '#10b981', wickDownColor: '#ef4444' } },
  paper: { layout: { background: { type: ColorType.Solid, color: '#fbf8f1' }, textColor: '#756d62' }, grid: { vertLines: { color: 'rgba(191, 179, 162, 0.28)' }, horzLines: { color: 'rgba(191, 179, 162, 0.28)' } }, crosshair: { vertLine: { color: '#9b9286', labelBackgroundColor: '#315f8c' }, horzLine: { color: '#9b9286', labelBackgroundColor: '#315f8c' } }, timeScale: { borderColor: '#d7cebf' }, rightPriceScale: { borderColor: '#d7cebf' }, series: { upColor: '#2f7d58', downColor: '#b44842', borderUpColor: '#2f7d58', borderDownColor: '#b44842', wickUpColor: '#2f7d58', wickDownColor: '#b44842' } },
  light: { layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#475569' }, grid: { vertLines: { color: '#f1f5f9' }, horzLines: { color: '#f1f5f9' } }, crosshair: { vertLine: { color: '#94a3b8', labelBackgroundColor: '#2563eb' }, horzLine: { color: '#94a3b8', labelBackgroundColor: '#2563eb' } }, timeScale: { borderColor: '#e2e8f0' }, rightPriceScale: { borderColor: '#e2e8f0' }, series: { upColor: '#16a34a', downColor: '#dc2626', borderUpColor: '#16a34a', borderDownColor: '#dc2626', wickUpColor: '#16a34a', wickDownColor: '#dc2626' } },
  midnight: { layout: { background: { type: ColorType.Solid, color: '#030712' }, textColor: '#64748b' }, grid: { vertLines: { color: 'rgba(31, 41, 55, 0.4)' }, horzLines: { color: 'rgba(31, 41, 55, 0.4)' } }, crosshair: { vertLine: { color: '#374151', labelBackgroundColor: '#0ea5e9' }, horzLine: { color: '#374151', labelBackgroundColor: '#0ea5e9' } }, timeScale: { borderColor: '#1f2937' }, rightPriceScale: { borderColor: '#1f2937' }, series: { upColor: '#10b981', downColor: '#ef4444', borderUpColor: '#10b981', borderDownColor: '#ef4444', wickUpColor: '#10b981', wickDownColor: '#ef4444' } },
  colorblind: { layout: { background: { type: ColorType.Solid, color: '#0b0d12' }, textColor: '#94a3b8' }, grid: { vertLines: { color: 'rgba(36, 41, 51, 0.6)' }, horzLines: { color: 'rgba(36, 41, 51, 0.6)' } }, crosshair: { vertLine: { color: '#475569', labelBackgroundColor: '#3b82f6' }, horzLine: { color: '#475569', labelBackgroundColor: '#3b82f6' } }, timeScale: { borderColor: '#242933' }, rightPriceScale: { borderColor: '#242933' }, series: { upColor: '#60a5fa', downColor: '#fb923c', borderUpColor: '#60a5fa', borderDownColor: '#fb923c', wickUpColor: '#60a5fa', wickDownColor: '#fb923c' } },
};

export class ChartManager {
  constructor(container) {
    if (!container) throw new Error('ChartManager requires container element');
    this.container = container;
    this.chart = null;
    this.series = null;
    this._panResetTimer = null;
    this._onVisibleRangeChange = null;
    this._onChartLibraryClick = null;
  }

  init(initialTheme = null) {
    if (this.chart) return;
    const currentThemeName = initialTheme || (typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null) || 'dark';
    const config = CHART_THEMES[currentThemeName] || CHART_THEMES.dark;
    this.chart = createChart(this.container, {
      layout: config.layout, grid: config.grid, crosshair: { mode: 1, ...config.crosshair },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: config.timeScale.borderColor, rightOffset: 12, barSpacing: 10, minBarSpacing: 4, ticksVisible: true },
      rightPriceScale: { borderColor: config.rightPriceScale.borderColor, autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } }, width: this.container.clientWidth || 800, height: this.container.clientHeight || 450,
    });
    this.series = this.chart.addCandlestickSeries({ borderVisible: true, wickVisible: true, ...config.series });
    this._revealedMaxTime = null; this._autoFollow = true; this._isUserPanning = false;
    this._positionLine = null; this._stopLossLine = null; this._takeProfitLine = null; this._orderLines = new Map(); this._onChartClickCallbacks = [];
    this._resizeObserver = new ResizeObserver(() => this.resize()); this._resizeObserver.observe(this.container); window.addEventListener('resize', this._onWindowResize);
    try {
      this._onVisibleRangeChange = (range) => {
        if (!range || this._revealedMaxTime == null || this._isUserPanning) return;
        if (range.to < this._revealedMaxTime) { if (this._autoFollow) { this._autoFollow = false; this._emitAutoFollowChanged(); } }
        else if (range.to >= this._revealedMaxTime) { if (!this._autoFollow) { this._autoFollow = true; this._emitAutoFollowChanged(); } }
      };
      this.chart.timeScale().subscribeVisibleTimeRangeChange(this._onVisibleRangeChange);
      this._onChartLibraryClick = (param) => {
        if (!param || !param.point || !this.series) return;
        const price = this.coordinateToPrice(param.point.y);
        if (price != null && Number.isFinite(price)) this._onChartClickCallbacks.forEach(cb => { try { cb({ price, point: param.point, time: param.time }); } catch (error) { console.warn('[ChartManager] click callback failed', error); } });
      };
      this.chart.subscribeClick(this._onChartLibraryClick);
    } catch (error) { console.warn('[ChartManager] chart subscription setup failed', error); }
  }

  _onWindowResize = () => this.resize();
  _schedulePanReset() { clearTimeout(this._panResetTimer); this._panResetTimer = setTimeout(() => { this._panResetTimer = null; this._isUserPanning = false; }, 50); }
  resize() { if (!this.chart) return; const width = this.container.clientWidth, height = this.container.clientHeight; if (width <= 0 || height <= 0) return; this.chart.applyOptions({ width, height }); }

  _prepareCandlesForChart(candles) {
    if (!Array.isArray(candles) || candles.length === 0) return [];
    const result = [];
    for (let i = 0; i < candles.length; i++) { const c = candles[i]; const time = Number(c.time), open = Number(c.open), close = Number(c.close); let high = Number(c.high), low = Number(c.low); if (high <= low || Math.abs(high - low) < 1e-4) { const tickSpread = Math.max(close * 0.00015, Math.abs(close) > 0 ? Math.abs(close) * 0.00001 : 0.0001); high = Math.max(open, close) + tickSpread * 0.5; low = Math.min(open, close) - tickSpread * 0.5; } result.push({ time, open, high, low, close }); }
    return result;
  }
  _detectPrecision(candles) { if (!candles || !candles.length) return { type: 'price', precision: 2, minMove: 0.01 }; const price = candles[0]?.close || candles[0]?.open || 100; if (price < 0.1) return { type: 'price', precision: 6, minMove: 0.000001 }; if (price < 10) return { type: 'price', precision: 4, minMove: 0.0001 }; return { type: 'price', precision: 2, minMove: 0.01 }; }

  setData(candles, { fit = true } = {}) { if (!this.series) throw new Error('Chart not initialized'); const source = Array.isArray(candles) ? candles : []; const filtered = this._revealedMaxTime == null ? source : source.filter(c => Number(c.time) <= this._revealedMaxTime); const prepared = this._prepareCandlesForChart(filtered); this._isUserPanning = true; try { if (prepared.length) { try { this.series.applyOptions({ priceFormat: this._detectPrecision(prepared) }); } catch {} } this.series.setData(prepared); try { this.chart.priceScale('right').applyOptions({ autoScale: true }); } catch {} if (fit && prepared.length) this.chart.timeScale().fitContent(); else if (this._autoFollow) this.chart.timeScale().scrollToPosition(3, false); } finally { this._schedulePanReset(); } }
  renderReplayWindow(candles, { fit = false } = {}) { if (!this.series) throw new Error('Chart not initialized'); const source = Array.isArray(candles) ? candles : []; const valid = source.filter(c => c && Number.isFinite(Number(c.time))); if (!valid.length) { this.series.setData([]); return; } this._revealedMaxTime = Number(valid[valid.length - 1].time); const prepared = this._prepareCandlesForChart(valid); this._isUserPanning = true; try { try { this.series.applyOptions({ priceFormat: this._detectPrecision(prepared) }); } catch {} this.series.setData(prepared); try { this.chart.priceScale('right').applyOptions({ autoScale: true }); } catch {} if (fit) this.chart.timeScale().fitContent(); else if (this._autoFollow) this.chart.timeScale().scrollToPosition(3, false); } finally { this._schedulePanReset(); } }
  updateRevealedCandle(candle) { if (!this.series || !candle) return false; const time = Number(candle.time); if (!Number.isFinite(time)) return false; if (this._revealedMaxTime != null && time < this._revealedMaxTime) return false; this._revealedMaxTime = time; try { this.series.update(candle); if (this._autoFollow) this.followCurrent(); return true; } catch (error) { console.error('[ChartManager] replay candle update failed', error); return false; } }
  update(candle) { if (!this.series) throw new Error('Chart not initialized'); if (this._revealedMaxTime != null && candle.time > this._revealedMaxTime) return false; this.series.update(candle); return true; }
  clampVisibleRange(range) { if (!range || this._revealedMaxTime == null) return range; return range.to > this._revealedMaxTime ? { from: range.from, to: this._revealedMaxTime } : range; }
  followCurrent() { if (!this.chart || !this._autoFollow) return; try { this.chart.timeScale().scrollToPosition(3, false); } catch {} }
  setRevealedMax(time) { this._revealedMaxTime = time == null ? null : Number(time); }
  setAutoFollow(v) { this._autoFollow = !!v; this._emitAutoFollowChanged(); if (this._autoFollow) this.followCurrent(); }
  isAutoFollow() { return this._autoFollow; }
  _emitAutoFollowChanged() { try { this._onAutoFollowChange?.(this._autoFollow); } catch (error) { console.warn('[ChartManager] auto-follow callback failed', error); } }
  onAutoFollowChange(cb) { this._onAutoFollowChange = typeof cb === 'function' ? cb : null; return () => { if (this._onAutoFollowChange === cb) this._onAutoFollowChange = null; }; }
  scrollToTime(unixSec) { if (!this.chart || !Number.isFinite(unixSec)) return; try { const timeScale = this.chart.timeScale(); const coord = timeScale.timeToCoordinate(unixSec); if (coord !== null && Number.isFinite(coord)) { const logical = timeScale.coordinateToLogical(coord); if (logical !== null && Number.isFinite(logical)) { timeScale.scrollToPosition(logical, false); return; } } timeScale.scrollToPosition(3, false); } catch { try { this.chart.timeScale().scrollToPosition(3, false); } catch {} } }
  coordinateToPrice(y) { if (!this.series || !Number.isFinite(y)) return null; try { return this.series.coordinateToPrice(y); } catch { return null; } }
  onChartClick(cb) { if (typeof cb === 'function') { this._onChartClickCallbacks.push(cb); return () => { this._onChartClickCallbacks = this._onChartClickCallbacks.filter(item => item !== cb); }; } return () => {}; }
  get tradingOverlay() { if (!this._tradingOverlay) this._tradingOverlay = new ChartTradingOverlay(this); return this._tradingOverlay; }
  updatePositionLines(position) { this.tradingOverlay.updatePositionLines(position); }
  clearPositionLines() { this.tradingOverlay.clearPositionLines(); }
  updateOrderLines(orders) { this.tradingOverlay.updateOrderLines(orders); }
  clearTradingLines() { this.tradingOverlay.clearTradingLines(); }
  clear() { this.clearTradingLines(); if (this.series) this.series.setData([]); }
  applyTheme(themeName) { const config = CHART_THEMES[themeName] || CHART_THEMES.dark; if (this.chart) { try { this.chart.applyOptions({ layout: config.layout, grid: config.grid, crosshair: { mode: 1, ...config.crosshair }, timeScale: { borderColor: config.timeScale.borderColor }, rightPriceScale: { borderColor: config.rightPriceScale.borderColor } }); } catch (err) { console.warn('[ChartManager] applyTheme chart options error:', err); } } if (this.series) { try { this.series.applyOptions(config.series); } catch (err) { console.warn('[ChartManager] applyTheme series options error:', err); } } return config; }
  destroy() {
    clearTimeout(this._panResetTimer);
    this._panResetTimer = null;
    this.clearTradingLines();
    window.removeEventListener('resize', this._onWindowResize);
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this.chart) {
      try {
        if (this._onVisibleRangeChange) this.chart.timeScale().unsubscribeVisibleTimeRangeChange(this._onVisibleRangeChange);
        if (this._onChartLibraryClick) this.chart.unsubscribeClick(this._onChartLibraryClick);
      } catch (error) { console.warn('[ChartManager] chart unsubscribe failed', error); }
      try { this.chart.remove(); } catch (error) { console.warn('[ChartManager] chart destroy failed', error); }
    }
    this._onVisibleRangeChange = null;
    this._onChartLibraryClick = null;
    this._onChartClickCallbacks = [];
    this._onAutoFollowChange = null;
    this.chart = null;
    this.series = null;
  }
}
