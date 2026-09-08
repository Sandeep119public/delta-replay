class Events {
  constructor() { this.m = new Map(); }
  on(event, handler) {
    const set = this.m.get(event) || new Set();
    set.add(handler);
    this.m.set(event, set);
    return () => set.delete(handler);
  }
  emit(event, payload) {
    for (const handler of this.m.get(event) || []) {
      try { handler(payload); } catch (error) { console.warn('[RemoteReplayEngine] event handler failed', error); }
    }
  }
}

export class RemoteReplayEngine {
  constructor(api, tradingEngine = null) {
    if (!api || typeof api.request !== 'function') throw new TypeError('RemoteReplayEngine requires API client');
    this.api = api;
    this.tradingEngine = tradingEngine;
    this.events = new Events();
    this.state = {
      status: 'idle',
      currentIndex: -1,
      startIndex: -1,
      total: 0,
      speed: 1,
      candle: null,
      visibleCandles: [],
    };
  }

  async _call(path, options) {
    const data = await this.api.request(path, options);
    this._sync(data);
    if (this.tradingEngine && data?.candle && path === '/step') {
      await this.tradingEngine.onMarketCandle(data.candle);
    }
    return this.getState();
  }

  _sync(snapshot = {}) {
    this.state = {
      status: snapshot.status ?? this.state.status,
      currentIndex: Number.isInteger(snapshot.index) ? snapshot.index : this.state.currentIndex,
      startIndex: Number.isInteger(snapshot.startIndex) ? snapshot.startIndex : this.state.startIndex,
      total: Number.isFinite(snapshot.total) ? snapshot.total : this.state.total,
      speed: Number.isFinite(snapshot.speed) ? snapshot.speed : this.state.speed,
      candle: snapshot.candle ?? null,
      visibleCandles: Array.isArray(snapshot.visibleCandles) ? snapshot.visibleCandles : [],
    };
    this.events.emit('stateChanged', this.getState());
  }

  on(event, handler) { return this.events.on(event, handler); }

  getState() { return { ...this.state, visibleCandles: [...this.state.visibleCandles] }; }

  getTotalCandles() { return this.state.total; }

  getVisibleCandles() { return [...this.state.visibleCandles]; }

  async load(candles) {
    return this._call('/load', {
      method: 'POST',
      body: JSON.stringify({ candles: Array.isArray(candles) ? candles : [] }),
    });
  }

  async start(index = 0) {
    const result = await this._call(`/start/${index}`, { method: 'POST' });
    this.events.emit('started', { index: this.state.currentIndex, state: result });
    return result;
  }

  async stepForward() {
    const previousIndex = this.state.currentIndex;
    const result = await this._call('/step', { method: 'POST' });
    this.events.emit('stepped', { index: this.state.currentIndex, previousIndex, state: result, candle: this.state.candle });
    return result;
  }

  async seek(index) {
    const result = await this._call(`/seek/${index}`, { method: 'POST' });
    this.events.emit('seeked', { index: this.state.currentIndex, state: result });
    return result;
  }

  async reset() {
    const result = await this._call('/reset', { method: 'POST' });
    this.events.emit('reset', { index: this.state.currentIndex, state: result });
    return result;
  }

  async play() {
    this.state = { ...this.state, status: 'playing' };
    this.events.emit('stateChanged', this.getState());
    return this.getState();
  }

  async pause() {
    this.state = { ...this.state, status: 'paused' };
    this.events.emit('stateChanged', this.getState());
    return this.getState();
  }

  setSpeed(speed) {
    const next = Number(speed);
    if (!Number.isFinite(next) || next <= 0) throw new TypeError('Replay speed must be a positive number');
    this.state = { ...this.state, speed: next };
    this.events.emit('speedChanged', next);
    this.events.emit('stateChanged', this.getState());
    return next;
  }

  registerActionGuard() { return () => {}; }
}
