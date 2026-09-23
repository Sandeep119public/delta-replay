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
      try { handler(payload); }
      catch (error) { console.warn('[ReplayEngine] ' + event + ' handler failed', error); }
    }
  }
}

export class DeterministicReplayEngine {
  constructor({ candleStore, onCandle = null, symbolProvider = () => 'BTCUSDT' } = {}) {
    if (!candleStore) throw new TypeError('ReplayEngine requires candleStore');
    if (onCandle != null && typeof onCandle !== 'function') throw new TypeError('onCandle must be a function');
    this.store = candleStore;
    this.onCandle = onCandle;
    this.symbolProvider = symbolProvider;
    this.events = new Events();
    this.state = {
      status: 'idle',
      currentIndex: -1,
      startIndex: -1,
      totalCandles: 0,
      speed: 1,
      candle: null,
      datasetId: null,
    };
    this.timer = null;
    this.intent = 0;
    this._candleProcessing = null;
    this.destroyed = false;
  }

  on(event, handler) { return this.destroyed ? () => {} : this.events.on(event, handler); }

  getState() {
    return {
      ...this.state,
      total: this.state.totalCandles,
      candle: this.state.candle ? { ...this.state.candle } : null,
    };
  }

  getTotalCandles() { return this.store.getCount(); }
  getCandle(index) { return this.store.get(index); }
  getTimelineTimes() { return this.store.getTimes(); }

  getCandleWindow(index, windowSize = 1000) {
    const n = Number(index);
    const size = Math.max(1, Math.trunc(Number(windowSize) || 1000));
    if (!Number.isInteger(n) || n < 0 || n >= this.getTotalCandles()) return [];
    return this.store.sliceWindow(Math.max(0, n - size + 1), n);
  }

  getVisibleCandles() {
    return this.state.currentIndex < 0 ? [] : this.getCandleWindow(this.state.currentIndex, 1000);
  }

  symbol() {
    const fromDataset = String(this.store.getSymbol?.() || '').trim().toUpperCase();
    if (fromDataset) return fromDataset;
    const fallback = String(this.symbolProvider() || '').trim().toUpperCase();
    if (!fallback) throw new TypeError('Replay symbol must be provided');
    return fallback;
  }

  publish(status = this.state.status) {
    const index = this.state.currentIndex;
    this.state = {
      ...this.state,
      status,
      totalCandles: this.store.getCount(),
      candle: index >= 0 ? this.store.get(index) : null,
    };
    this.events.emit('stateChanged', this.getState());
    return this.getState();
  }

  async _waitForCandleProcessing() {
    const pending = this._candleProcessing;
    if (!pending) return;
    try { await pending; } catch {}
  }

  async _processCandle(index, event, previousIndex) {
    const candle = index >= 0 ? this.store.get(index) : null;
    if (!candle || !this.onCandle) return { index, previousIndex, candle };

    let processing;
    try {
      processing = Promise.resolve(this.onCandle({
        candle,
        index,
        symbol: this.symbol(),
        state: this.getState(),
        event,
      }));
    } catch (error) {
      processing = Promise.reject(error);
    }
    this._candleProcessing = processing;
    try {
      const result = await processing;
      if (result?.success === false) {
        throw new Error(result.message || 'Replay market-candle processing failed');
      }
      return { index, previousIndex, candle };
    } finally {
      if (this._candleProcessing === processing) this._candleProcessing = null;
    }
  }

  _emitCandleEvent(event, { index, previousIndex, candle }) {
    this.events.emit(event, {
      index,
      previousIndex,
      candle,
      state: this.getState(),
    });
  }

  async loadDataset(candles, { startIndex = 0, metadata = {} } = {}) {
    if (this.destroyed) return this.getState();
    this.pause();
    await this._waitForCandleProcessing();

    if (!Array.isArray(candles) || !candles.length) {
      this.store.clear();
      this.state = {
        ...this.state,
        status: 'idle',
        currentIndex: -1,
        startIndex: -1,
        totalCandles: 0,
        candle: null,
        datasetId: null,
      };
      return this.publish('idle');
    }

    this.store.load(candles, metadata);
    const total = this.store.getCount();
    const start = Math.min(Math.max(0, Math.trunc(Number(startIndex) || 0)), total - 1);
    this.state = {
      ...this.state,
      status: 'ready',
      currentIndex: -1,
      startIndex: start,
      totalCandles: total,
      candle: null,
      datasetId: metadata.datasetId ?? metadata.id ?? null,
    };
    return this.publish('ready');
  }

  async start(index = this.state.startIndex >= 0 ? this.state.startIndex : 0) {
    if (this.destroyed || !this.getTotalCandles()) return this.getState();
    await this._waitForCandleProcessing();
    const n = Number(index);
    if (!Number.isInteger(n) || n < 0 || n >= this.getTotalCandles()) {
      throw new RangeError('Replay start index is outside dataset');
    }

    this.pause();
    const previousIndex = this.state.currentIndex;
    this.state = { ...this.state, startIndex: n, currentIndex: n };
    try {
      const payload = await this._processCandle(n, 'started', previousIndex);
      const status = n === this.getTotalCandles() - 1 ? 'ended' : 'paused';
      this.publish(status);
      this._emitCandleEvent('started', payload);
      return this.getState();
    } catch (error) {
      this.state = { ...this.state, currentIndex: previousIndex, candle: previousIndex >= 0 ? this.store.get(previousIndex) : null };
      this.publish(previousIndex >= 0 ? 'paused' : 'ready');
      throw error;
    }
  }

  async seek(index) {
    if (this.destroyed) return this.getState();
    await this._waitForCandleProcessing();
    const n = Number(index);
    if (!Number.isInteger(n) || n < 0 || n >= this.getTotalCandles()) {
      throw new RangeError('Replay seek index is outside dataset');
    }

    this.pause();
    const previousIndex = this.state.currentIndex;
    this.state = { ...this.state, currentIndex: n };
    try {
      const payload = await this._processCandle(n, 'seeked', previousIndex);
      const status = n === this.getTotalCandles() - 1 ? 'ended' : 'paused';
      this.publish(status);
      this._emitCandleEvent('seeked', payload);
      return this.getState();
    } catch (error) {
      this.state = { ...this.state, currentIndex: previousIndex, candle: previousIndex >= 0 ? this.store.get(previousIndex) : null };
      this.publish(previousIndex >= 0 ? 'paused' : 'ready');
      throw error;
    }
  }

  async stepForward() {
    if (this.destroyed || this.state.currentIndex < 0) return this.getState();
    await this._waitForCandleProcessing();

    const previousIndex = this.state.currentIndex;
    const next = Math.min(previousIndex + 1, this.getTotalCandles() - 1);
    if (next === previousIndex) {
      this.pause();
      return this.publish('ended');
    }

    const wasPlaying = this.state.status === 'playing';
    this.state = { ...this.state, currentIndex: next };
    try {
      const payload = await this._processCandle(next, 'stepped', previousIndex);
      const status = next === this.getTotalCandles() - 1 ? 'ended' : (wasPlaying ? 'playing' : 'paused');
      this.publish(status);
      this._emitCandleEvent('stepped', payload);
      return this.getState();
    } catch (error) {
      this.state = { ...this.state, currentIndex: previousIndex, candle: this.store.get(previousIndex) };
      this.publish(wasPlaying ? 'playing' : 'paused');
      throw error;
    }
  }

  async reset() {
    if (this.destroyed) return this.getState();
    this.pause();
    await this._waitForCandleProcessing();
    this.state = {
      ...this.state,
      status: this.getTotalCandles() ? 'ready' : 'idle',
      currentIndex: -1,
      candle: null,
    };
    this.publish(this.state.status);
    this.events.emit('reset', { index: -1, startIndex: this.state.startIndex, state: this.getState() });
    return this.getState();
  }

  async play() {
    if (this.destroyed || this.timer) return this.getState();
    if (this.state.status === 'ready') await this.start(this.state.startIndex);
    if (this.state.status === 'ended') return this.getState();

    const intent = ++this.intent;
    this.state = { ...this.state, status: 'playing' };
    this.publish('playing');

    const schedule = () => {
      if (this.destroyed || intent !== this.intent || this.state.status !== 'playing' || this.timer) return;
      this.timer = setTimeout(async () => {
        this.timer = null;
        if (this.destroyed || intent !== this.intent || this.state.status !== 'playing') return;
        try {
          await this.stepForward();
        } catch (error) {
          this.pause();
          this.events.emit('playbackError', error);
          return;
        }
        if (!this.destroyed && intent === this.intent && this.state.status === 'playing') schedule();
      }, Math.max(16, BASE_STEP_DELAY_MS / this.state.speed));
    };

    schedule();
    return this.getState();
  }

  pause() {
    this.intent += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.destroyed && this.state.status === 'playing') this.publish('paused');
    return this.getState();
  }

  setSpeed(speed) {
    const next = Number(speed);
    if (!Number.isFinite(next) || next <= 0) throw new TypeError('Replay speed must be positive');
    this.state = { ...this.state, speed: next };
    this.events.emit('speedChanged', { speed: next });
    if (this.state.status === 'playing') {
      this.pause();
      return this.play();
    }
    this.publish(this.state.status);
    return next;
  }

  destroy() {
    if (this.destroyed) return;
    this.pause();
    this.destroyed = true;
    this.events = new Events();
    this.onCandle = null;
  }
}
