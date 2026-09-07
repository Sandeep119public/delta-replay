import { EventEmitter } from '../core/EventEmitter.js';
import { LoadingState } from '../data/DataError.js';
import { CandleStore } from '../data/CandleStore.js';

export class AppState extends EventEmitter {
  constructor({ candleStore = null } = {}) {
    super();
    this.symbol = 'BTCUSDT';
    this.timeframe = '1m';
    this._store = candleStore;
    this.loading = false;
    this.loadingState = LoadingState.IDLE;
    this.error = null;
    this.dataError = null;
    this.pendingStartIndex = 0;
    this.retryCount = 0;
    this.replayState = null;
  }

  _ensureStore() {
    if (!this._store) this._store = new CandleStore();
    return this._store;
  }

  get candles() {
    return this._store?.getAll?.() || [];
  }

  set candles(val) {
    this.setCandles(val);
  }

  get totalCandles() {
    return this._store?.getCount?.() || 0;
  }

  getCandle(index) {
    return this._store?.get?.(index) ?? null;
  }

  sliceWindow(start, end) {
    return this._store?.sliceWindow?.(start, end) || [];
  }

  setCandleStore(store) {
    if (!store || typeof store.getCount !== 'function' || typeof store.getAll !== 'function') {
      throw new TypeError('AppState.setCandleStore requires a CandleStore-compatible object');
    }
    this._store = store;
    this.emit('candles', this.candles);
    this.emit('change', this.snapshot());
  }

  setLoading(v) {
    this.loading = v;
    if (v) this.loadingState = LoadingState.LOADING;
    else if (this.loadingState === LoadingState.LOADING) this.loadingState = LoadingState.SUCCESS;
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
    const store = this._ensureStore();
    if (!candles?.length) store.clear();
    else store.load(candles);
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
      total: this.totalCandles,
      loading: this.loading,
      loadingState: this.loadingState,
      error: this.error,
      dataError: this.dataError,
      pendingStartIndex: this.pendingStartIndex,
      retryCount: this.retryCount,
      replayState: this.replayState,
    };
  }
}
