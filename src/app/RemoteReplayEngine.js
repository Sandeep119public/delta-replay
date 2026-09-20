class Events {
  constructor() {
    this.map = new Map();
  }

  on(event, handler) {
    const listeners = this.map.get(event) || new Set();
    listeners.add(handler);
    this.map.set(event, listeners);
    return () => listeners.delete(handler);
  }

  emit(event, payload) {
    for (const handler of this.map.get(event) || []) {
      try {
        handler(payload);
      } catch (error) {
        console.warn(`[RemoteReplayEngine] ${event} handler failed`, error);
      }
    }
  }
}

const BASE_STEP_DELAY_MS = 500;
const clone = (value) => value == null ? value : structuredClone(value);

export class RemoteReplayEngine {
  constructor(api, tradingEngine = null, symbolProvider = () => 'BTCUSDT') {
    if (!api || typeof api.request !== 'function') {
      throw new TypeError('RemoteReplayEngine requires API client');
    }
    if (typeof symbolProvider !== 'function') {
      throw new TypeError('RemoteReplayEngine symbolProvider must be a function');
    }

    this.api = api;
    this.tradingEngine = tradingEngine;
    this.symbolProvider = symbolProvider;
    this.events = new Events();
    this._playTimer = null;
    this._stepInFlight = false;
    this._generation = 0;
    this._playIntent = 0;
    this._destroyed = false;
    this.state = {
      status: 'idle',
      currentIndex: -1,
      startIndex: -1,
      totalCandles: 0,
      speed: 1,
      candle: null,
      visibleCandles: [],
    };
  }

  on(event, handler) {
    return this._destroyed ? () => {} : this.events.on(event, handler);
  }

  currentSymbol() {
    const symbol = String(this.symbolProvider() || '').trim().toUpperCase();
    if (!symbol) throw new TypeError('Replay symbol must be provided');
    return symbol;
  }

  _sync(snapshot = {}, lifecycle = null) {
    if (this._destroyed) return;

    this.state = {
      ...this.state,
      status: snapshot.status ?? this.state.status,
      currentIndex: Number.isInteger(snapshot.index) ? snapshot.index : this.state.currentIndex,
      startIndex: Number.isInteger(snapshot.startIndex) ? snapshot.startIndex : this.state.startIndex,
      totalCandles: Number.isFinite(snapshot.total) ? snapshot.total : this.state.totalCandles,
      speed: Number.isFinite(snapshot.speed) ? snapshot.speed : this.state.speed,
      candle: clone(snapshot.candle),
      visibleCandles: Array.isArray(snapshot.visibleCandles) ? clone(snapshot.visibleCandles) : [],
    };

    if (snapshot.trading && this.tradingEngine?.syncFromReplayLifecycle) {
      const tradingAction = lifecycle === 'step' ? 'candle' : 'replay-sync';
      this.tradingEngine.syncFromReplayLifecycle(clone(snapshot), tradingAction);
    }

    this.events.emit('stateChanged', this.getState());
  }

  async _call(path, options = {}, generation = this._generation, lifecycle = null) {
    const response = await this.api.request(path, options);
    if (this._destroyed || generation !== this._generation) return this.getState();
    this._sync(response, lifecycle);
    return this.getState();
  }


  getState() {
    return {
      ...this.state,
      candle: clone(this.state.candle),
      total: this.state.totalCandles,
      totalCandles: this.state.totalCandles,
      visibleCandles: clone(this.state.visibleCandles),
    };
  }

  getTotalCandles() {
    return this.state.totalCandles;
  }

  getVisibleCandles() {
    return clone(this.state.visibleCandles);
  }

  load(candles) {
    if (this._destroyed) return Promise.resolve(this.getState());
    this.pause();
    const generation = ++this._generation;
    const payload = Array.isArray(candles) ? clone(candles) : [];

    return this._call(
      '/load',
      { method: 'POST', body: JSON.stringify({ candles: payload }) },
      generation,
      'load',
    );
  }

  start(index = 0, symbol = null) {
    if (this._destroyed) return Promise.resolve(this.getState());

    const numericIndex = Number(index);
    if (!Number.isInteger(numericIndex)) {
      return Promise.reject(new TypeError('Replay start index must be an integer'));
    }

    const normalizedSymbol = String(symbol ?? this.currentSymbol()).trim().toUpperCase();
    if (!normalizedSymbol) throw new TypeError('Replay symbol must be provided');

    const generation = ++this._generation;
    return (async () => {
      const result = await this._call(
        `/start/${numericIndex}?symbol=${encodeURIComponent(normalizedSymbol)}`,
        { method: 'POST' },
        generation,
        'start',
      );

      if (!this._destroyed && generation === this._generation) {
        this.events.emit('started', { index: this.state.currentIndex, state: result });
      }
      return result;
    });
  }

  stepForward(symbol = null) {
    if (this._destroyed || this._stepInFlight) return Promise.resolve(this.getState());
    if (this.state.currentIndex < 0 || this.state.currentIndex >= this.state.totalCandles - 1) {
      if (this.state.totalCandles > 0 && this.state.currentIndex >= this.state.totalCandles - 1) {
        this.pause();
      }
      return Promise.resolve(this.getState());
    }

    this._stepInFlight = true;
    const generation = this._generation;
    const previousIndex = this.state.currentIndex;

    return (async () => {
      try {
        const normalizedSymbol = symbol == null ? null : String(symbol).trim().toUpperCase();
        const query = normalizedSymbol ? `?symbol=${encodeURIComponent(normalizedSymbol)}` : '';
        const result = await this._call(`/step${query}`, { method: 'POST' }, generation, 'step');

        if (this._destroyed || generation !== this._generation) return result;

        this.events.emit('stepped', {
          index: this.state.currentIndex,
          previousIndex,
          state: result,
          candle: clone(this.state.candle),
        });

        if (this.state.status === 'ended' || this.state.currentIndex >= this.state.totalCandles - 1) {
          this.pause();
        }
        return result;
      } finally {
        this._stepInFlight = false;
      }
    });
  }

  seek(index) {
    if (this._destroyed) return Promise.resolve(this.getState());
    this.pause();

    const numericIndex = Number(index);
    if (!Number.isInteger(numericIndex)) {
      return Promise.reject(new TypeError('Replay seek index must be an integer'));
    }

    const generation = ++this._generation;
    return (async () => {
      const result = await this._call(
        `/seek/${numericIndex}?symbol=${encodeURIComponent(this.currentSymbol())}`,
        { method: 'POST' },
        generation,
        'seek',
      );

      if (!this._destroyed && generation === this._generation) {
        this.events.emit('seeked', { index: this.state.currentIndex, state: result });
      }
      return result;
    })();
  }

  reset() {
    if (this._destroyed) return Promise.resolve(this.getState());
    this.pause();

    const generation = ++this._generation;
    return (async () => {
      const result = await this._call('/reset', { method: 'POST' }, generation, 'reset');

      if (!this._destroyed && generation === this._generation) {
        this.events.emit('reset', { index: this.state.currentIndex, state: result });
      }
      return result;
    })();
  }

  async play() {
    if (this._destroyed) return this.getState();

    const playIntent = ++this._playIntent;
    if (this.state.status === 'ready') {
      await this.start(this.state.startIndex >= 0 ? this.state.startIndex : 0, this.currentSymbol());
    }

    if (
      this._destroyed
      || playIntent !== this._playIntent
      || !['paused', 'playing'].includes(this.state.status)
    ) {
      return this.getState();
    }

    if (this._playTimer) return this.getState();

    this.state = { ...this.state, status: 'playing' };
    this.events.emit('stateChanged', this.getState());
    this._scheduleStep();
    return this.getState();
  }

  pause() {
    this._playIntent++;
    if (this._playTimer) clearTimeout(this._playTimer);
    this._playTimer = null;

    if (!this._destroyed && this.state.status === 'playing') {
      this.state = { ...this.state, status: 'paused' };
      this.events.emit('stateChanged', this.getState());
    }
    return this.getState();
  }

  _scheduleStep() {
    if (this._destroyed || this.state.status !== 'playing' || this._playTimer) return;

    const delay = Math.max(40, BASE_STEP_DELAY_MS / Number(this.state.speed || 1));
    this._playTimer = setTimeout(async () => {
      this._playTimer = null;
      if (this._destroyed || this.state.status !== 'playing') return;

      try {
        await this.stepForward(this.currentSymbol());
      } catch (error) {
        this.pause();
        if (!this._destroyed) this.events.emit('playbackError', error);
        return;
      }

      if (!this._destroyed && this.state.status === 'playing') this._scheduleStep();
    }, delay);
  }

  setSpeed(speed) {
    if (this._destroyed) return this.state.speed;

    const next = Number(speed);
    if (!Number.isFinite(next) || next <= 0) {
      throw new TypeError('Replay speed must be a positive number');
    }

    this.state = { ...this.state, speed: next };
    this.events.emit('speedChanged', { speed: next });
    this.events.emit('stateChanged', this.getState());

    if (this.state.status === 'playing') {
      if (this._playTimer) clearTimeout(this._playTimer);
      this._playTimer = null;
      this._scheduleStep();
    }

    return next;
  }

  destroy() {
    if (this._destroyed) return;

    this.pause();
    this._destroyed = true;
    this._generation++;


    this.events = new Events();
    this.tradingEngine = null;
  }
}
