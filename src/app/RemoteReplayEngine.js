class Events {
  constructor() { this.map = new Map(); }
  on(event, handler) { const listeners = this.map.get(event) || new Set(); listeners.add(handler); this.map.set(event, listeners); return () => listeners.delete(handler); }
  emit(event, payload) { for (const handler of this.map.get(event) || []) { try { handler(payload); } catch (error) { console.warn(`[RemoteReplayEngine] ${event} handler failed`, error); } } }
}

const BASE_STEP_DELAY_MS = 500;

export class RemoteReplayEngine {
  constructor(api, tradingEngine = null) {
    if (!api || typeof api.request !== 'function') throw new TypeError('RemoteReplayEngine requires API client');
    this.api = api;
    this.tradingEngine = tradingEngine;
    this.events = new Events();
    this._playTimer = null;
    this._stepInFlight = false;
    this._generation = 0;
    this._destroyed = false;
    this.state = { status: 'idle', currentIndex: -1, startIndex: -1, totalCandles: 0, speed: 1, candle: null, visibleCandles: [] };
  }
  on(event, handler) { return this._destroyed ? () => {} : this.events.on(event, handler); }
  _sync(snapshot = {}) {
    if (this._destroyed) return;
    this.state = { ...this.state, status: snapshot.status ?? this.state.status, currentIndex: Number.isInteger(snapshot.index) ? snapshot.index : this.state.currentIndex, startIndex: Number.isInteger(snapshot.startIndex) ? snapshot.startIndex : this.state.startIndex, totalCandles: Number.isFinite(snapshot.total) ? snapshot.total : this.state.totalCandles, speed: Number.isFinite(snapshot.speed) ? snapshot.speed : this.state.speed, candle: snapshot.candle ?? null, visibleCandles: Array.isArray(snapshot.visibleCandles) ? snapshot.visibleCandles : [] };
    if (snapshot.trading && this.tradingEngine?.syncFromReplayStep) this.tradingEngine.syncFromReplayStep(snapshot);
    this.events.emit('stateChanged', this.getState());
  }
  async _call(path, options = {}, generation = this._generation) {
    const response = await this.api.request(path, options);
    if (this._destroyed || generation !== this._generation) return this.getState();
    this._sync(response);
    return this.getState();
  }
  getState() { return { ...this.state, total: this.state.totalCandles, totalCandles: this.state.totalCandles, visibleCandles: [...this.state.visibleCandles] }; }
  getTotalCandles() { return this.state.totalCandles; }
  getVisibleCandles() { return [...this.state.visibleCandles]; }
  async load(candles) { if (this._destroyed) return this.getState(); this.pause(); const generation = ++this._generation; return this._call('/load', { method: 'POST', body: JSON.stringify({ candles: Array.isArray(candles) ? candles : [] }) }, generation); }
  async start(index = 0) { if (this._destroyed) return this.getState(); const generation = ++this._generation; const result = await this._call(`/start/${Number(index)}`, { method: 'POST' }, generation); if (!this._destroyed && generation === this._generation) this.events.emit('started', { index: this.state.currentIndex, state: result }); return result; }
  async stepForward() {
    if (this._destroyed || this._stepInFlight) return this.getState();
    if (this.state.currentIndex < 0 || this.state.currentIndex >= this.state.totalCandles - 1) { if (this.state.totalCandles > 0 && this.state.currentIndex >= this.state.totalCandles - 1) this.pause(); return this.getState(); }
    this._stepInFlight = true;
    const generation = this._generation;
    const previousIndex = this.state.currentIndex;
    try {
      const result = await this._call('/step', { method: 'POST' }, generation);
      if (this._destroyed || generation !== this._generation) return result;
      this.events.emit('stepped', { index: this.state.currentIndex, previousIndex, state: result, candle: this.state.candle });
      if (this.state.status === 'ended' || this.state.currentIndex >= this.state.totalCandles - 1) this.pause();
      return result;
    } finally { this._stepInFlight = false; }
  }
  async seek(index) { if (this._destroyed) return this.getState(); this.pause(); const generation = ++this._generation; const result = await this._call(`/seek/${Number(index)}`, { method: 'POST' }, generation); if (!this._destroyed && generation === this._generation) this.events.emit('seeked', { index: this.state.currentIndex, state: result }); return result; }
  async reset() { if (this._destroyed) return this.getState(); this.pause(); const generation = ++this._generation; const result = await this._call('/reset', { method: 'POST' }, generation); if (!this._destroyed && generation === this._generation) this.events.emit('reset', { index: this.state.currentIndex, state: result }); return result; }
  async play() { if (this._destroyed) return this.getState(); if (this.state.status === 'ready') await this.start(this.state.startIndex >= 0 ? this.state.startIndex : 0); if (this._destroyed || !['paused', 'playing'].includes(this.state.status)) return this.getState(); if (this._playTimer) return this.getState(); this.state = { ...this.state, status: 'playing' }; this.events.emit('stateChanged', this.getState()); this._scheduleStep(); return this.getState(); }
  pause() { if (this._playTimer) clearTimeout(this._playTimer); this._playTimer = null; if (!this._destroyed && this.state.status === 'playing') { this.state = { ...this.state, status: 'paused' }; this.events.emit('stateChanged', this.getState()); } return this.getState(); }
  _scheduleStep() { if (this._destroyed || this.state.status !== 'playing' || this._playTimer) return; const delay = Math.max(40, BASE_STEP_DELAY_MS / Number(this.state.speed || 1)); this._playTimer = setTimeout(async () => { this._playTimer = null; if (this._destroyed || this.state.status !== 'playing') return; try { await this.stepForward(); } catch (error) { this.pause(); if (!this._destroyed) this.events.emit('playbackError', error); return; } if (!this._destroyed && this.state.status === 'playing') this._scheduleStep(); }, delay); }
  setSpeed(speed) { if (this._destroyed) return this.state.speed; const next = Number(speed); if (!Number.isFinite(next) || next <= 0) throw new TypeError('Replay speed must be a positive number'); this.state = { ...this.state, speed: next }; this.events.emit('speedChanged', { speed: next }); this.events.emit('stateChanged', this.getState()); if (this.state.status === 'playing') { if (this._playTimer) clearTimeout(this._playTimer); this._playTimer = null; this._scheduleStep(); } return next; }
  registerActionGuard() { return () => {}; }
  destroy() { if (this._destroyed) return; this.pause(); this._destroyed = true; this._generation++; this.events = new Events(); this.tradingEngine = null; }
}
