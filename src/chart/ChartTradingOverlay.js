/**
 * ChartTradingOverlay encapsulates position lines, risk lines (SL/TP),
 * and pending order lines (Limit/Stop Market) drawn on top of lightweight-charts.
 *
 * Keeps domain trading concepts cleanly separated from core chart infrastructure.
 */
export class ChartTradingOverlay {
  constructor(context = null) {
    this._ctx = context;
    if (!context) {
      this._positionLine = null;
      this._stopLossLine = null;
      this._takeProfitLine = null;
      this._orderLines = new Map();
    }
  }

  get target() {
    return this._ctx || this;
  }

  get series() {
    return this.target.series;
  }

  get _positionLine() {
    return this.target === this ? this.__positionLine : this.target._positionLine;
  }
  set _positionLine(v) {
    if (this.target === this) this.__positionLine = v;
    else this.target._positionLine = v;
  }

  get _stopLossLine() {
    return this.target === this ? this.__stopLossLine : this.target._stopLossLine;
  }
  set _stopLossLine(v) {
    if (this.target === this) this.__stopLossLine = v;
    else this.target._stopLossLine = v;
  }

  get _takeProfitLine() {
    return this.target === this ? this.__takeProfitLine : this.target._takeProfitLine;
  }
  set _takeProfitLine(v) {
    if (this.target === this) this.__takeProfitLine = v;
    else this.target._takeProfitLine = v;
  }

  get _orderLines() {
    if (this.target === this) {
      if (!this.__orderLines) this.__orderLines = new Map();
      return this.__orderLines;
    }
    if (!this.target._orderLines) this.target._orderLines = new Map();
    return this.target._orderLines;
  }
  set _orderLines(v) {
    if (this.target === this) this.__orderLines = v;
    else this.target._orderLines = v;
  }

  updatePositionLines(position) {
    const s = this.series;
    if (!s) return;

    if (!position || !Number.isFinite(Number(position.entryPrice))) {
      this.clearPositionLines();
      return;
    }

    const isLong = position.side === 'LONG';
    const entryPrice = Number(position.entryPrice);
    const posColor = isLong ? '#2f7d58' : '#b44842';
    const title = `${position.side} ${position.quantity} @ ${entryPrice.toFixed(2)}`;

    if (!this._positionLine) {
      try {
        this._positionLine = s.createPriceLine({
          price: entryPrice,
          color: posColor,
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title,
        });
      } catch {}
    } else {
      try {
        this._positionLine.applyOptions({ price: entryPrice, color: posColor, title });
      } catch {}
    }

    // Stop Loss Line
    const sl = position.stopLossPrice != null ? Number(position.stopLossPrice) : null;
    if (sl != null && Number.isFinite(sl) && sl > 0) {
      const slTitle = `SL: ${sl.toFixed(2)}`;
      if (!this._stopLossLine) {
        try {
          this._stopLossLine = s.createPriceLine({
            price: sl,
            color: '#b44842',
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: slTitle,
          });
        } catch {}
      } else {
        try {
          this._stopLossLine.applyOptions({ price: sl, color: '#b44842', title: slTitle });
        } catch {}
      }
    } else if (this._stopLossLine) {
      try {
        s.removePriceLine(this._stopLossLine);
      } catch {}
      this._stopLossLine = null;
    }

    // Take Profit Line
    const tp = position.takeProfitPrice != null ? Number(position.takeProfitPrice) : null;
    if (tp != null && Number.isFinite(tp) && tp > 0) {
      const tpTitle = `TP: ${tp.toFixed(2)}`;
      if (!this._takeProfitLine) {
        try {
          this._takeProfitLine = s.createPriceLine({
            price: tp,
            color: '#2f7d58',
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: tpTitle,
          });
        } catch {}
      } else {
        try {
          this._takeProfitLine.applyOptions({ price: tp, color: '#2f7d58', title: tpTitle });
        } catch {}
      }
    } else if (this._takeProfitLine) {
      try {
        s.removePriceLine(this._takeProfitLine);
      } catch {}
      this._takeProfitLine = null;
    }
  }

  clearPositionLines() {
    const s = this.series;
    if (this._positionLine) {
      try { s?.removePriceLine(this._positionLine); } catch {}
      this._positionLine = null;
    }
    if (this._stopLossLine) {
      try { s?.removePriceLine(this._stopLossLine); } catch {}
      this._stopLossLine = null;
    }
    if (this._takeProfitLine) {
      try { s?.removePriceLine(this._takeProfitLine); } catch {}
      this._takeProfitLine = null;
    }
  }

  updateOrderLines(orders) {
    const s = this.series;
    if (!s) return;

    const pending = Array.isArray(orders) ? orders.filter(o => o && o.status === 'PENDING') : [];
    const activeIds = new Set(pending.map(o => o.id));

    // Remove deleted orders
    for (const [id, line] of this._orderLines.entries()) {
      if (!activeIds.has(id)) {
        try { s.removePriceLine(line); } catch {}
        this._orderLines.delete(id);
      }
    }

    for (const o of pending) {
      const price = Number(o.stopPrice ?? o.limitPrice);
      if (!Number.isFinite(price) || price <= 0) continue;

      const isBuy = o.side === 'BUY';
      const color = o.type === 'STOP_MARKET' ? '#a86e24' : (isBuy ? '#315f8c' : '#9d5a36');
      const typeLabel = o.type === 'STOP_MARKET' ? 'STOP' : 'LIMIT';
      const title = `${typeLabel} ${o.side} ${o.quantity} @ ${price.toFixed(2)}`;

      const existing = this._orderLines.get(o.id);
      if (existing) {
        try {
          existing.applyOptions({ price, color, title });
        } catch {}
      } else {
        try {
          const line = s.createPriceLine({
            price,
            color,
            lineWidth: 1,
            lineStyle: 1,
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
    const s = this.series;
    for (const line of this._orderLines.values()) {
      try { s?.removePriceLine(line); } catch {}
    }
    this._orderLines.clear();
  }

  /**
   * Determine intent for a clicked chart price based on active position context.
   *
   * @param {number} price
   * @param {object|null} activePosition
   * @returns {{ action: 'SET_TP'|'SET_SL'|'PRICE_SELECT', price: number, isTP?: boolean, symbol?: string } | null}
   */
  resolveClickIntent(price, activePosition = null) {
    if (!Number.isFinite(price) || price <= 0) return null;
    if (activePosition && Number.isFinite(Number(activePosition.entryPrice))) {
      const isLong = activePosition.side === 'LONG';
      const entryPrice = Number(activePosition.entryPrice);
      const isTP = isLong ? (price > entryPrice) : (price < entryPrice);
      return {
        action: isTP ? 'SET_TP' : 'SET_SL',
        price,
        isTP,
        symbol: activePosition.symbol,
      };
    }
    return {
      action: 'PRICE_SELECT',
      price,
    };
  }
}
