const clone = (value) => value == null ? value : structuredClone(value);
const SPEEDS = [0.25, 0.5, 1, 2, 5, 10];
const BASE_STEP_DELAY_MS = 500;

class Events {
  constructor() { this.map = new Map(); }
  on(event, handler) {
    const listeners = this.map.get(event) || new Set();
    listeners.add(handler);
    this.map.set(event, listeners);
    return () => listeners.delete(handler);
  }
  emit(event, payload) {
    for (const handler of this.map.get(event) || []) {
      try { handler(payload); } catch (error) { console.warn(`[DeterministicReplayEngine] ${event} handler failed`, error); }
    }
  }
}

function normalizeCandles(candles) {
  if (!Array.isArray(candles)) throw new TypeError('Replay dataset must be an array');
  const next = candles.map((c, index) => {
    if (!c || !Number.isFinite(Number(c.time))) throw new TypeError(`Replay candle ${index} has an invalid time`);
    const open = Number(c.open), high = Number(c.high), low = Number(c.low), close = Number(c.close), volume = Number(c.volume ?? 0);
    if (![open, high, low, close, volume].every(Number.isFinite)) throw new TypeError(`Replay candle ${index} contains a non-finite value`);
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) throw new TypeError(`Replay candle ${index} violates OHLC invariants`);
    return { time: Number(c.time), open, high, low, close, volume };
  });
  for (let i = 1; i < next.length; i += 1) {
    if (next[i].time <= next[i - 1].time) throw new TypeError('Replay candles must be strictly ordered by time');
  }
  return next;
}

export class DeterministicReplayEngine {
  constructor({ onCandle = null, symbolProvider = () => 'BTCUSDT' } = {}) {
    if (onCandle != null && typeof onCandle !== 'function') throw new TypeError('onCandle must be a function');
    if (typeof symbolProvider !== 'function') throw new TypeError('symbolProvider must be a function');
    this.onCandle = onCandle;
    this.symbolProvider = symbolProvider;
    this.events = new Events();
    this.candles = [];
    this.state = {
      status: 'idle',
      currentIndex: -1,
      startIndex: -1,
      totalCandles: 0,
      speed: 1,
      candle: null,
      visibleCandles: [],
    };
    this._timer = null;
    this._intent = 0;
    this._destroyed = false;
  }

  on(event, handler) { return this._destroyed ? () => {} : this.events.on(event, handler); }

  _visible() {
    const end = this.state.currentIndex;
    if (end < 0) return [];
    const start = Math.max(0, end - 999);
    return this.candles.slice(start, end + 1).map(clone);
  }

  _publish(status = this.state.status) {
    this.state = {
      ...this.state,
      status,
      totalCandles: this.candles.length,
      candle: this.state.currentIndex >= 0 ? clone(this.candles[this.state.currentIndex]) : null,
      visibleCandles: this._visible(),
    };
    this.events.emit('stateChanged', this.getState());
    return this.getState();
  }

  _emitCandleLifecycle(event, previousIndex = null) {
    const index = this.state.currentIndex;
    const candle = index >= 0 ? clone(this.candles[index]) : null;
    const payload = { index, previousIndex, candle, state: this.getState() };
    this.events.emit(event, payload);
    if (index >= 0 && typeof this.onCandle === 'function') {
      Promise.resolve(this.onCandle({ candle, index, symbol: this.currentSymbol(), state: this.getState(), event }))
        .catch((error) => this.events.emit('playbackError', error));
    }
  }

  currentSymbol() {
    const symbol = String(this.symbolProvider() || '').trim().toUpperCase();
    if (!symbol) throw new TypeError('Replay symbol must be provided');
    return symbol;
  }

  getState() {
    return {
      ...this.state,
      total: this.state.totalCandles,
      totalCandles: this.state.totalCandles,
      candle: clone(this.state.candle),
      visibleCandles: clone(this.state.visibleCandles),
    };
  }

  getTotalCandles() { return this.candles.length; }
  getVisibleCandles() { return this._visible(); }

  async loadDataset(candles, { startIndex = 0 } = {}) {
    if (this._destroyed) return this.getState();
    this.pause();
    const validated = normalizeCandles(candles);
    this.candles = validated;
    const total = validated.length;
    const target = total ? Math.min(Math.max(0, Math.trunc(Number(startIndex) || 0)), total - 1) : -1;
    this.state = {
      status: total ? 'ready' : 'idle',
      currentIndex: -1,
      startIndex: total ? target : -1,
      totalCandles: total,
      speed: this.state.speed,
      candle: null,
      visibleCandles: [],
    };
    this._publish(this.state.status);
    return this.getState();
  }

  load(candles, options) { return this.loadDataset(candles, options); }
  loadLocalDataset(candles, options) { return this.loadDataset(candles, options); }

  async start(index = this.state.startIndex >= 0 ? this.state.startIndex : 0) {
    if (this._destroyed) return this.getState();
    if (!this.candles.length) return this.getState();
    const n = Number(index);
    if (!Number.isInteger(n) || n < 0 || n >= this.candles.length) throw new RangeError('Replay start index is outside dataset');
    this.pause();
    this.state = { ...this.state, startIndex: n, currentIndex: n };
    this._publish(n === this.candles.length - 1 ? 'ended' : 'paused');
    this._emitCandleLifecycle('started');
    return this.getState();
  }

  async seek(index) {
    if (this._destroyed) return this.getState();
    const n = Number(index);
    if (!Number.isInteger(n) || n < 0 || n >= this.candles.length) throw new RangeError('Replay seek index is outside dataset');
    this.pause();
    const previousIndex = this.state.currentIndex;
    this.state = { ...this.state, currentIndex: n };
    this._publish(n === this.candles.length - 1 ? 'ended' : 'paused');
    this._emitCandleLifecycle('seeked', previousIndex);
    return this.getState();
  }

  async stepForward() {
    if (this._destroyed) return this.getState();
    if (!this.candles.length || this.state.currentIndex < 0) return this.getState();
    const previousIndex = this.state.currentIndex;
    const nextIndex = Math.min(previousIndex + 1, this.candles.length - 1);
    if (nextIndex === previousIndex) {
      this.pause();
      this._publish('ended');
      return this.getState();
    }
    this.state = { ...this.state, currentIndex: nextIndex };
    const status = nextIndex === this.candles.length - 1 ? 'ended' : 'paused';
    this._publish(status);
    this._emitCandleLifecycle('stepped', previousIndex);
    if (status === 'ended') this.pause();
    return this.getState();
  }

  async stepBackward() {
    if (this._destroyed) return this.getState();
    if (!this.candles.length || this.state.currentIndex <= 0) return this.getState();
    return this.seek(this.state.currentIndex - 1);
  }

  async reset() {
    if (this._destroyed) return this.getState();
    this.pause();
    const index = this.state.startIndex;
    this.state = {
      ...this.state,
      currentIndex: -1,
      status: this.candles.length ? 'ready' : 'idle',
      candle: null,
      visibleCandles: [],
    };
    this._publish(this.state.status);
    this.events.emit('reset', { index: -1, state: this.getState(), startIndex: index });
    return this.getState();
  }

  async play() {
    if (this._destroyed || this._timer) return this.getState();
    if (this.state.status === 'ready') await this.start(this.state.startIndex >= 0 ? this.state.startIndex : 0);
    if (this.state.status === 'ended') return this.getState();
    const intent = ++this._intent;
    this.state = { ...this.state, status: 'playing' };
    this._publish('playing');
    const tick = async () => {
      this._timer = null;
      if (this._destroyed || intent !== this._intent || this.state.status !== 'playing') return;
      try {
        await this.stepForward();
      } catch (error) {
        this.pause();
        this.events.emit('playbackError', error);
        return;
      }
      if (!this._destroyed && intent === this._intent && this.state.status === 'playing') this._schedule(intent);
    };
    this._schedule = (token) => {
      if (this._destroyed || token !== this._intent || this.state.status !== 'playing' || this._timer) return;
      this._timer = setTimeout(() => { void tick(); }, Math.max(16, BASE_STEP_DELAY_MS / Number(this.state.speed || 1)));
    };
    this._schedule(intent);
    return this.getState();
  }

  pause() {
    this._intent += 1;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    if (!this._destroyed && this.state.status === 'playing') this._publish('paused');
    return this.getState();
  }

  setSpeed(speed) {
    const next = Number(speed);
    if (!Number.isFinite(next) || next <= 0) throw new TypeError('Replay speed must be positive');
    const value = SPEEDS.includes(next) ? next : next;
    this.state = { ...this.state, speed: value };
    this.events.emit('speedChanged', { speed: value });
    if (this.state.status === 'playing') {
      this.pause();
      return this.play();
    }
    this._publish(this.state.status);
    return value;
  }

  destroy() {
    if (this._destroyed) return;
    this.pause();
    this._destroyed = true;
    this.events = new Events();
    this.onCandle = null;
  }
}
