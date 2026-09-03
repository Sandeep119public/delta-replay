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

    // Trading visual overlays
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
        // User scrolled back into history
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
          this._onChartClickCallbacks.forEach(cb => {
            try { cb({ price, point: param.point, time: param.time }); } catch {}
          });
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
      const time = Number(c.time);
      const open = Number(c.open);
      let high = Number(c.high);
      let low = Number(c.low);
      const close = Number(c.close);

      // Visual safety: when high <= low, provide a minimal visual spread so the chart renderer
      // displays flat candles correctly, while strictly preserving canonical open/close prices.
      if (high <= low || Math.abs(high - low) < 1e-4) {
        const tickSpread = Math.max(close * 0.00015, Math.abs(close) > 0 ? Math.abs(close) * 0.00001 : 0.0001);
        high = Math.max(open, close) + tickSpread * 0.5;
        low = Math.min(open, close) - tickSpread * 0.5;
      }

      result.push({
        time,
        open,
        high,
        low,
        close,
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
    if (!this.chart || !Number.isFinite(unixSec)) return;
    try {
      const timeScale = this.chart.timeScale();
      const coord = timeScale.timeToCoordinate(unixSec);
      if (coord !== null && Number.isFinite(coord)) {
        const logical = timeScale.coordinateToLogical(coord);
        if (logical !== null && Number.isFinite(logical)) {
          timeScale.scrollToPosition(logical, false);
          return;
        }
      }
      timeScale.scrollToPosition(3, false);
    } catch {
      try { this.chart.timeScale().scrollToPosition(3, false); } catch {}
    }
  }

  coordinateToPrice(y) {
    if (!this.series || !Number.isFinite(y)) return null;
    try {
      return this.series.coordinateToPrice(y);
    } catch {
      return null;
    }
  }

  onChartClick(cb) {
    if (typeof cb === 'function') {
      this._onChartClickCallbacks.push(cb);
    }
  }

  updatePositionLines(position) {
    if (!this.series) return;

    if (!position || !Number.isFinite(Number(position.entryPrice))) {
      this.clearPositionLines();
      return;
    }

    const isLong = position.side === 'LONG';
    const entryPrice = Number(position.entryPrice);
    const posColor = isLong ? '#10b981' : '#f43f5e';
    const title = `${position.side} ${position.quantity} @ ${entryPrice.toFixed(2)}`;

    // 1. Position Entry Line
    if (!this._positionLine) {
      try {
        this._positionLine = this.series.createPriceLine({
          price: entryPrice,
          color: posColor,
          lineWidth: 2,
          lineStyle: 0, // Solid
          axisLabelVisible: true,
          title,
        });
      } catch {}
    } else {
      try {
        this._positionLine.applyOptions({
          price: entryPrice,
          color: posColor,
          title,
        });
      } catch {}
    }

    // 2. Stop Loss Line
    const sl = position.stopLossPrice != null ? Number(position.stopLossPrice) : null;
    if (sl != null && Number.isFinite(sl) && sl > 0) {
      const slTitle = `SL: ${sl.toFixed(2)}`;
      if (!this._stopLossLine) {
        try {
          this._stopLossLine = this.series.createPriceLine({
            price: sl,
            color: '#ef4444',
            lineWidth: 2,
            lineStyle: 2, // Dashed
            axisLabelVisible: true,
            title: slTitle,
          });
        } catch {}
      } else {
        try {
          this._stopLossLine.applyOptions({
            price: sl,
            color: '#ef4444',
            title: slTitle,
          });
        } catch {}
      }
    } else if (this._stopLossLine) {
      try { this.series.removePriceLine(this._stopLossLine); } catch {}
      this._stopLossLine = null;
    }

    // 3. Take Profit Line
    const tp = position.takeProfitPrice != null ? Number(position.takeProfitPrice) : null;
    if (tp != null && Number.isFinite(tp) && tp > 0) {
      const tpTitle = `TP: ${tp.toFixed(2)}`;
      if (!this._takeProfitLine) {
        try {
          this._takeProfitLine = this.series.createPriceLine({
            price: tp,
            color: '#10b981',
            lineWidth: 2,
            lineStyle: 2, // Dashed
            axisLabelVisible: true,
            title: tpTitle,
          });
        } catch {}
      } else {
        try {
          this._takeProfitLine.applyOptions({
            price: tp,
            color: '#10b981',
            title: tpTitle,
          });
        } catch {}
      }
    } else if (this._takeProfitLine) {
      try { this.series.removePriceLine(this._takeProfitLine); } catch {}
      this._takeProfitLine = null;
    }
  }

  clearPositionLines() {
    if (this._positionLine) {
      try { this.series?.removePriceLine(this._positionLine); } catch {}
      this._positionLine = null;
    }
    if (this._stopLossLine) {
      try { this.series?.removePriceLine(this._stopLossLine); } catch {}
      this._stopLossLine = null;
    }
    if (this._takeProfitLine) {
      try { this.series?.removePriceLine(this._takeProfitLine); } catch {}
      this._takeProfitLine = null;
    }
  }

  updateOrderLines(orders) {
    if (!this.series) return;
    const pending = Array.isArray(orders) ? orders.filter(o => o && o.status === 'PENDING') : [];
    const activeIds = new Set(pending.map(o => o.id));

    // Remove obsolete order lines
    if (this._orderLines) {
      for (const [id, line] of this._orderLines.entries()) {
        if (!activeIds.has(id)) {
          try { this.series.removePriceLine(line); } catch {}
          this._orderLines.delete(id);
        }
      }
    } else {
      this._orderLines = new Map();
    }

    // Create / update active pending order lines
    for (const o of pending) {
      const price = Number(o.stopPrice ?? o.limitPrice);
      if (!Number.isFinite(price) || price <= 0) continue;
      const isBuy = o.side === 'BUY';
      const color = o.type === 'STOP_MARKET' ? '#f59e0b' : (isBuy ? '#38bdf8' : '#fb923c');
      const typeLabel = o.type === 'STOP_MARKET' ? 'STOP' : 'LIMIT';
      const title = `${typeLabel} ${o.side} ${o.quantity} @ ${price.toFixed(2)}`;

      const existing = this._orderLines.get(o.id);
      if (existing) {
        try { existing.applyOptions({ price, color, title }); } catch {}
      } else {
        try {
          const line = this.series.createPriceLine({
            price,
            color,
            lineWidth: 1,
            lineStyle: 1, // Dotted
            axisLabelVisible: true,
            title,
          });
          if (line) this._orderLines.set(o.id, line);
        } catch {}
      }
    }
  }

  clearTradingLines() {
    this.clearPositionLines();
    if (this._orderLines) {
      for (const line of this._orderLines.values()) {
        try { this.series?.removePriceLine(line); } catch {}
      }
      this._orderLines.clear();
    }
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
      try {
        this.chart.remove();
      } catch {}
      this.chart = null;
      this.series = null;
    }
  }
}
