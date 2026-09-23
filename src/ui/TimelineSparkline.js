import { TRADING_PRESENTATION_EVENTS, assertTradingPresentation } from '../ports/TradingPresentationPort.js';

/**
 * Lightweight timeline overview. Candle data is read only when the dataset
 * cache is invalid; replay ticks redraw the cached overview and cursor.
 */
export class TimelineSparkline {
  constructor({ canvasEl = null, candles = null, replay = null, replayPort = null, trading = null, tradingEvents = null, onSeek = null, height = 36, palette = null } = {}) {
    this.canvas = canvasEl;
    this.candles = candles;
    this.replayPort = replay ?? replayPort;
    this.trading = trading ? assertTradingPresentation(trading) : null;
    this.tradingEvents = tradingEvents;
    this.onSeek = onSeek;
    this.height = height;
    this.palette = { line:'#3b82f6', cursor:'#f8fafc', long:'#22c55e', short:'#ef4444', win:'#22c55e', loss:'#ef4444', ...(palette || {}) };
    this._cache = null;
    this._subscriptions = [];
    this._attached = false;
    this._onState = () => this.render();
    this._onResize = () => { this._cache = null; this.render(); };
    this._boundClick = (e) => this._handleClick(e);
    this._boundTouchStart = (e) => this._handleTouch(e, false);
    this._boundTouchMove = (e) => this._handleTouch(e, true);
    this._attach();
  }

  _attach() {
    if (this._attached) return;
    this._attached = true;
    const subscribe = (owner, eventName, typedSubscribe, handler) => {
      const unsubscribe = typeof typedSubscribe === 'function' ? typedSubscribe(handler) : owner?.on?.(eventName, handler);
      if (typeof unsubscribe === 'function') this._subscriptions.push(unsubscribe);
    };
    subscribe(this.replayPort, 'stateChanged', this.replayPort?.onStateChanged, this._onState);
    const events = this.tradingEvents?.events || this.trading?.events || TRADING_PRESENTATION_EVENTS;
    for (const name of [events.TRADE_EXECUTED, events.POSITION_CLOSED, events.POSITION_OPENED]) {
      subscribe(this.tradingEvents || this.trading, name, null, () => this.render());
    }
    if (typeof window !== 'undefined') window.addEventListener?.('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined' && this.canvas?.parentElement) {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.canvas.parentElement);
    }
    this.canvas?.addEventListener?.('click', this._boundClick);
    this.canvas?.addEventListener?.('touchstart', this._boundTouchStart, { passive:true });
    this.canvas?.addEventListener?.('touchmove', this._boundTouchMove, { passive:false });
  }

  destroy() {
    if (!this._attached) return;
    this._attached = false;
    this._subscriptions.forEach((u) => { try { u?.(); } catch {} });
    this._subscriptions = [];
    if (typeof window !== 'undefined') window.removeEventListener?.('resize', this._onResize);
    this._ro?.disconnect?.();
    this.canvas?.removeEventListener?.('click', this._boundClick);
    this.canvas?.removeEventListener?.('touchstart', this._boundTouchStart);
    this.canvas?.removeEventListener?.('touchmove', this._boundTouchMove);
    this._ro = null;
    this.onSeek = null;
    this.replayPort = null;
    this._cache = null;
  }

  _candles() {
    const count = this._datasetCount();
    return count && (this.replayPort?.getCandleWindow?.(count - 1, count) || this.candles?.getAll?.() || []);
  }
  _trades() { return this.trading?.snapshot().trades || []; }
  _cursor() { return this.replayPort?.getState?.().currentIndex ?? -1; }
  _datasetCount() { return this.replayPort?.getTotalCandles?.() ?? this.candles?.getCount?.() ?? 0; }

  _datasetKey(count) {
    const state = this.replayPort?.getState?.() || {};
    if (state.datasetId) return String(state.datasetId);
    const times = this.replayPort?.getTimelineTimes?.() || [];
    return String(count) + ':' + (times[0] ?? '') + ':' + (times[times.length - 1] ?? '');
  }

  _buildCache(candles, width, key) {
    const count = candles.length;
    const bucketCount = Math.max(2, Math.min(Math.floor(width), 900));
    const points = new Array(bucketCount);
    const prefixMin = new Array(bucketCount).fill(Infinity);
    const prefixMax = new Array(bucketCount).fill(-Infinity);
    let min = Infinity;
    let max = -Infinity;

    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const start = Math.floor(bucket * count / bucketCount);
      const end = Math.max(start + 1, Math.floor((bucket + 1) * count / bucketCount));
      let sum = 0;
      let seen = 0;
      let last = null;
      for (let i = start; i < Math.min(end, count); i += 1) {
        const value = Number(candles[i]?.close);
        if (!Number.isFinite(value)) continue;
        sum += value;
        seen += 1;
        last = value;
        if (value < min) min = value;
        if (value > max) max = value;
      }
      if (seen) points[bucket] = {
        index: Math.min(count - 1, end - 1),
        value: sum / seen,
        last,
      };
      prefixMin[bucket] = bucket === 0 ? min : Math.min(prefixMin[bucket - 1], min);
      prefixMax[bucket] = bucket === 0 ? max : Math.max(prefixMax[bucket - 1], max);
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    const times = candles.map((c) => Number(c?.time));
    return { count, width, key, points, prefixMin, prefixMax, times };
  }

  _indexForTime(t, times) {
    if (!Number.isFinite(t) || !times.length) return -1;
    let lo = 0, hi = times.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  render() {
    const canvas = this.canvas;
    if (!canvas) return false;
    let ctx;
    try { ctx = canvas.getContext?.('2d'); } catch { return false; }
    if (!ctx) return false;

    const dpr = Math.max(1, Number(globalThis.window?.devicePixelRatio) || 1);
    const width = Math.max(1, Math.floor(canvas.clientWidth || canvas.parentElement?.clientWidth || 300));
    const height = this.height;
    const count = this._datasetCount();
    const cursor = this._cursor();

    try {
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
    } catch { return false; }

    if (!count) { this._cache = null; return true; }

    const key = this._datasetKey(count);
    let cache = this._cache;
    if (!cache || cache.count !== count || cache.width !== width || cache.key !== key) {
      cache = this._buildCache(this._candles(), width, key);
      this._cache = cache;
    }
    if (!cache) return true;

    const visibleBucket = (() => {
      let bucket = -1;
      for (let i = 0; i < cache.points.length; i += 1) {
        if (cache.points[i]?.index <= cursor) bucket = i;
        else break;
      }
      return bucket;
    })();
    if (cursor < 0 || visibleBucket < 0) return true;

    let min = cache.prefixMin[visibleBucket];
    let max = cache.prefixMax[visibleBucket];
    if (!Number.isFinite(min) || !Number.isFinite(max)) return true;
    if (min === max) { min -= 1; max += 1; }

    const y = (price) => height - 3 - ((price - min) / (max - min)) * (height - 6);
    const xForIndex = (index) => count === 1 ? width / 2 : (index / (count - 1)) * width;

    ctx.beginPath();
    let drawn = false;
    for (let i = 0; i <= visibleBucket; i += 1) {
      const point = cache.points[i];
      if (!point || point.index > cursor) continue;
      const x = xForIndex(point.index);
      const py = y(point.value);
      if (!drawn) { ctx.moveTo(x, py); drawn = true; }
      else ctx.lineTo(x, py);
    }
    if (drawn) {
      ctx.strokeStyle = this.palette.line;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    try {
      for (const trade of this._trades()) {
        const entryIdx = this._indexForTime(Number(trade?.openedAt), cache.times);
        const exitIdx = this._indexForTime(Number(trade?.closedAt), cache.times);
        const side = String(trade?.side || '').toUpperCase();
        const entryColor = side === 'SHORT' || side === 'SELL' ? this.palette.short : this.palette.long;
        if (entryIdx >= 0 && entryIdx <= cursor && Number.isFinite(Number(trade?.entryPrice))) {
          const ex = xForIndex(entryIdx);
          const ey = Math.min(Math.max(y(Number(trade.entryPrice)), 4), height - 4);
          ctx.beginPath(); ctx.moveTo(ex, ey - 4); ctx.lineTo(ex - 3.5, ey + 2.5); ctx.lineTo(ex + 3.5, ey + 2.5); ctx.closePath();
          ctx.fillStyle = entryColor; ctx.fill();
        }
        if (exitIdx >= 0 && exitIdx <= cursor && Number.isFinite(Number(trade?.exitPrice))) {
          const ex = xForIndex(exitIdx);
          const ey = Math.min(Math.max(y(Number(trade.exitPrice)), 4), height - 4);
          ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2);
          ctx.fillStyle = Number(trade?.netPnL ?? trade?.realizedPnL ?? 0) >= 0 ? this.palette.win : this.palette.loss;
          ctx.fill();
        }
      }
    } catch {}

    if (cursor >= 0 && cursor < count) {
      const x = xForIndex(cursor);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height);
      ctx.strokeStyle = this.palette.cursor; ctx.lineWidth = 1; ctx.stroke();
    }
    return true;
  }

  _handleClick(event) {
    const count = this._cache?.count ?? this._datasetCount();
    if (!count) return;
    const rect = this.canvas?.getBoundingClientRect?.();
    const x = Number.isFinite(event?.offsetX) ? event.offsetX : Number(event?.clientX) - (rect?.left || 0);
    this._seekAtOffset(x, count, rect?.width || this.canvas?.clientWidth || 1);
  }

  _handleTouch(event, move) {
    const count = this._cache?.count ?? this._datasetCount();
    if (!count) return;
    const touch = event?.touches?.[0] || event?.changedTouches?.[0];
    const rect = this.canvas?.getBoundingClientRect?.();
    if (!touch || !rect) return;
    if (move) event.preventDefault?.();
    this._seekAtOffset(touch.clientX - rect.left, count, rect.width || 1);
  }

  _seekAtOffset(offsetX, count, width) {
    if (!Number.isFinite(offsetX) || width <= 0) return;
    const idx = Math.min(Math.max(0, Math.round((offsetX / width) * (count - 1))), count - 1);
    this.onSeek?.(idx);
  }
}
