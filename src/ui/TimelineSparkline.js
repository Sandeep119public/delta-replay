import { TradingEvents } from '../trading/TradingEvents.js';

/**
 * TimelineSparkline renders a contextual mini price scrubber above the
 * timeline slider: a close-price sparkline, a replay-cursor line, and trade
 * pips (entry triangle + exit dot) so users can scrub back to past setups.
 * Clicking the canvas seeks through the provided onSeek callback.
 */
export class TimelineSparkline {
  constructor({
    canvasEl = null,
    candleStore = null,
    engine = null,
    tradingEngine = null,
    onSeek = null,
    height = 36,
    palette = null,
  } = {}) {
    this.canvas = canvasEl;
    this.candleStore = candleStore;
    this.engine = engine;
    this.tradingEngine = tradingEngine;
    this.onSeek = onSeek;
    this.height = height;
    this.palette = {
      line: '#3b82f6',
      cursor: '#f8fafc',
      long: '#22c55e',
      short: '#ef4444',
      win: '#22c55e',
      loss: '#ef4444',
      ...(palette || {}),
    };

    this._onState = () => this.render();
    this._onResize = () => this.render();
    this._boundClick = (e) => this._handleClick(e);
    this._boundTouchStart = (e) => this._handleTouch(e, false);
    this._boundTouchMove = (e) => this._handleTouch(e, true);
    this._ro = null;
    this._attach();
  }

  _attach() {
    try {
      this.engine?.on?.('stateChanged', this._onState);
      this.tradingEngine?.on?.(TradingEvents.TRADE_EXECUTED, this._onState);
      this.tradingEngine?.on?.(TradingEvents.POSITION_CLOSED, this._onState);
      this.tradingEngine?.on?.(TradingEvents.POSITION_OPENED, this._onState);
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('resize', this._onResize);
      }
      if (typeof ResizeObserver !== 'undefined' && this.canvas?.parentElement) {
        this._ro = new ResizeObserver(this._onResize);
        this._ro.observe(this.canvas.parentElement);
      }
      this.canvas?.addEventListener?.('click', this._boundClick);
      // Thumb scrubbing: tap to jump, drag to sweep. touchmove is
      // non-passive so the page doesn't scroll mid-scrub.
      this.canvas?.addEventListener?.('touchstart', this._boundTouchStart, { passive: true });
      this.canvas?.addEventListener?.('touchmove', this._boundTouchMove, { passive: false });
    } catch {}
  }

  destroy() {
    try {
      this.engine?.off?.('stateChanged', this._onState);
      this.tradingEngine?.off?.(TradingEvents.TRADE_EXECUTED, this._onState);
      this.tradingEngine?.off?.(TradingEvents.POSITION_CLOSED, this._onState);
      this.tradingEngine?.off?.(TradingEvents.POSITION_OPENED, this._onState);
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', this._onResize);
      }
      this._ro?.disconnect?.();
      this.canvas?.removeEventListener?.('click', this._boundClick);
      this.canvas?.removeEventListener?.('touchstart', this._boundTouchStart);
      this.canvas?.removeEventListener?.('touchmove', this._boundTouchMove);
    } catch {}
  }

  _candles() {
    try {
      return this.candleStore?.getAll?.() || [];
    } catch {
      return [];
    }
  }

  _trades() {
    try {
      return this.tradingEngine?.getTrades?.() || [];
    } catch {
      return [];
    }
  }

  _cursor() {
    try {
      return this.engine?.getState?.().currentIndex ?? -1;
    } catch {
      return -1;
    }
  }

  /** Nearest candle index at-or-before timestamp t (times ascending). */
  _indexForTime(t, times) {
    if (!times.length || !Number.isFinite(t)) return -1;
    let lo = 0;
    let hi = times.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  render() {
    const canvas = this.canvas;
    if (!canvas) return false;
    let ctx = null;
    try {
      ctx = canvas.getContext?.('2d');
    } catch {
      return false;
    }
    if (!ctx) return false;

    const candles = this._candles();
    const dpr = (typeof window !== 'undefined' && Number(window.devicePixelRatio)) || 1;
    const w = Math.max(1, Math.floor(canvas.clientWidth || canvas.parentElement?.clientWidth || 300));
    const h = this.height;
    try {
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      if (typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
    } catch {
      return false;
    }
    if (!candles.length) return true;

    const closes = candles.map((c) => Number(c.close));
    let min = Math.min(...closes);
    let max = Math.max(...closes);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return true;
    if (max - min === 0) {
      min -= 1;
      max += 1;
    }
    const n = candles.length;
    const x = (i) => (n === 1 ? w / 2 : (i / (n - 1)) * w);
    const y = (p) => h - 3 - ((Number(p) - min) / (max - min)) * (h - 6);

    // Sparkline of closes
    try {
      ctx.beginPath();
      closes.forEach((p, i) => {
        if (i === 0) ctx.moveTo(x(i), y(p));
        else ctx.lineTo(x(i), y(p));
      });
      ctx.strokeStyle = this.palette.line;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } catch {}

    // Trade pips: entry triangle (side color) + exit dot (pnl color)
    try {
      const times = candles.map((c) => Number(c.time));
      for (const t of this._trades()) {
        const entryIdx = this._indexForTime(Number(t?.openedAt), times);
        const exitIdx = this._indexForTime(Number(t?.closedAt), times);
        const side = String(t?.side || '').toUpperCase();
        const entryColor = side === 'SHORT' || side === 'SELL' ? this.palette.short : this.palette.long;
        if (entryIdx >= 0 && Number.isFinite(t?.entryPrice)) {
          const ex = x(entryIdx);
          const ey = Math.min(Math.max(y(t.entryPrice), 4), h - 4);
          ctx.beginPath();
          ctx.moveTo(ex, ey - 4);
          ctx.lineTo(ex - 3.5, ey + 2.5);
          ctx.lineTo(ex + 3.5, ey + 2.5);
          ctx.closePath();
          ctx.fillStyle = entryColor;
          ctx.fill();
        }
        if (exitIdx >= 0 && Number.isFinite(t?.exitPrice)) {
          const ex = x(exitIdx);
          const ey = Math.min(Math.max(y(t.exitPrice), 4), h - 4);
          ctx.beginPath();
          ctx.arc(ex, ey, 3, 0, Math.PI * 2);
          ctx.fillStyle = Number(t?.netPnL ?? t?.realizedPnL ?? 0) >= 0 ? this.palette.win : this.palette.loss;
          ctx.fill();
        }
      }
    } catch {}

    // Replay cursor
    try {
      const cursor = this._cursor();
      if (cursor >= 0 && cursor < n) {
        ctx.beginPath();
        ctx.moveTo(x(cursor), 0);
        ctx.lineTo(x(cursor), h);
        ctx.strokeStyle = this.palette.cursor;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } catch {}

    return true;
  }

  _handleClick(e) {
    try {
      const candles = this._candles();
      if (!candles.length) return;
      let offsetX = e?.offsetX;
      if (!Number.isFinite(offsetX)) {
        const rect = this.canvas?.getBoundingClientRect?.();
        const clientX = e?.clientX;
        if (!rect || !Number.isFinite(clientX)) return;
        offsetX = clientX - rect.left;
      }
      this._seekAtOffset(offsetX, candles.length);
    } catch {}
  }

  /** Touch scrub: first touch's x-coordinate; move events block page scroll. */
  _handleTouch(e, isMove) {
    try {
      const candles = this._candles();
      if (!candles.length) return;
      const touch = e?.touches?.[0] || e?.changedTouches?.[0];
      if (!touch || !Number.isFinite(touch.clientX)) return;
      if (isMove && typeof e?.preventDefault === 'function') e.preventDefault();
      const rect = this.canvas?.getBoundingClientRect?.();
      if (!rect) return;
      this._seekAtOffset(touch.clientX - rect.left, candles.length);
    } catch {}
  }

  _seekAtOffset(offsetX, count) {
    const width = this.canvas?.getBoundingClientRect?.()?.width || this.canvas?.clientWidth || 1;
    const idx = Math.min(Math.max(0, Math.round((offsetX / width) * (count - 1))), count - 1);
    if (typeof this.onSeek === 'function') this.onSeek(idx);
  }
}
