import { EventEmitter } from '../core/EventEmitter.js';
import { LoadingState } from '../data/DataError.js';

export class AppState extends EventEmitter {
  constructor() {
    super();
    this.symbol = 'BTCUSDT';
    this.timeframe = '1m';
    this._candles = []; // legacy direct storage (used when no store)
    this._store = null; // CandleStore reference if available
    this.loading = false;
    this.loadingState = LoadingState.IDLE;
    this.error = null;
    this.dataError = null;
    this.pendingStartIndex = 0;
    this.retryCount = 0;
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
    if (v) {
      this.loadingState = LoadingState.LOADING;
    } else if (this.loadingState === LoadingState.LOADING) {
      this.loadingState = LoadingState.SUCCESS;
    }
    this.emit('change', this.snapshot());
  }

  transitionLoading(state, dataError = null) {
    this.loadingState = state;
    this.dataError = dataError;
    this.loading = state === LoadingState.LOADING;
    this.error = dataError ? (dataError.userMessage || dataError.message || String(dataError)) : null;
    this.emit('loadingStateChanged', { loadingState: state, dataError });
    this.emit('change', this.snapshot());
  }

  setPendingStartIndex(idx) {
    this.pendingStartIndex = Number(idx) || 0;
    this.emit('pendingStartIndexChanged', this.pendingStartIndex);
    this.emit('change', this.snapshot());
  }

  setRetryCount(count) {
    this.retryCount = Number(count) || 0;
    this.emit('retryCountChanged', this.retryCount);
  }

  setError(msg) {
    this.error = msg;
    this.emit('error', msg);
    this.emit('change', this.snapshot());
  }

  clearError() {
    this.error = null;
    this.dataError = null;
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
      loadingState: this.loadingState,
      error: this.error,
      dataError: this.dataError,
      pendingStartIndex: this.pendingStartIndex,
      retryCount: this.retryCount,
      replayState: this.replayState
    };
  }
}

