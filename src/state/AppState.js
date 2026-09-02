import { EventEmitter } from '../core/EventEmitter.js';

export class AppState extends EventEmitter {
  constructor() {
    super();
    this.symbol = 'BTCUSD';
    this.timeframe = '1m';
    this._candles = []; // legacy direct storage (used when no store)
    this._store = null; // CandleStore reference if available
    this.loading = false;
    this.error = null;
    this.replayState = null;
  }

  // Single source: if store attached, candles getter proxies to store
  get candles() {
    if (this._store) return this._store.getAll();
    return this._candles;
  }
  set candles(val) { this._candles = val; }

  setCandleStore(store) {
    this._store = store;
    this.emit('candles', this.candles);
    this.emit('change', this.snapshot());
  }

  setLoading(v) {
    this.loading = v;
    this.emit('change', this.snapshot());
  }

  setError(msg) {
    this.error = msg;
    this.emit('error', msg);
    this.emit('change', this.snapshot());
  }

  clearError() {
    this.error = null;
    this.emit('change', this.snapshot());
  }

  setCandles(candles) {
    if (this._store) {
      // Single source is CandleStore; avoid duplicating full array in AppState
      // Keep _candles empty, getter will proxy to store; just emit event
      this._candles = [];
    } else {
      this._candles = candles;
    }
    this.emit('candles', this.candles);
    this.emit('change', this.snapshot());
  }

  setReplayState(rs) {
    this.replayState = rs;
    this.emit('replayState', rs);
    this.emit('change', this.snapshot());
  }

  snapshot() {
    return {
      symbol: this.symbol,
      timeframe: this.timeframe,
      total: this.candles.length,
      loading: this.loading,
      error: this.error,
      replayState: this.replayState
    };
  }
}
