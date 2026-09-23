import { EventEmitter } from '../core/EventEmitter.js';
import { LoadingState } from '../data/DataError.js';

function freezeValue(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
  const copy = {};
  for (const [key, child] of Object.entries(value)) copy[key] = freezeValue(child);
  return Object.freeze(copy);
}

export class AppState extends EventEmitter {
  constructor() {
    super();
    this.symbol = 'BTCUSDT';
    this.timeframe = '1m';
    this.mode = 'live';
    this.replayDatasetId = null;
    this.replayDatasetSource = null;
    this.loading = false;
    this.loadingState = LoadingState.IDLE;
    this.error = null;
    this.dataError = null;
    this.pendingStartIndex = 0;
    this.retryCount = 0;
    this.replayState = null;
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

  setMode(mode) {
    if (mode !== 'live' && mode !== 'replay') throw new TypeError('AppState mode must be live or replay');
    this.mode = mode;
    this.emit('modeChanged', mode);
    this.emit('change', this.snapshot());
  }

  setReplayDatasetId(id, source = this.replayDatasetSource) {
    this.replayDatasetId = id ? String(id) : null;
    this.replayDatasetSource = this.replayDatasetId ? (source || 'github') : null;
    this.emit('replayDatasetChanged', this.replayDatasetId);
    this.emit('replayDatasetSourceChanged', this.replayDatasetSource);
    this.emit('change', this.snapshot());
  }

  setReplayDatasetSource(source) {
    if (source !== null && source !== 'github' && source !== 'local') {
      throw new TypeError('Replay dataset source must be github, local, or null');
    }
    this.replayDatasetSource = source;
    this.emit('replayDatasetSourceChanged', source);
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

  setReplayState(rs) {
    this.replayState = rs;
    this.emit('replayState', freezeValue(rs));
    this.emit('change', this.snapshot());
  }

  snapshot() {
    return freezeValue({
      symbol: this.symbol,
      timeframe: this.timeframe,
      mode: this.mode,
      replayDatasetId: this.replayDatasetId,
      replayDatasetSource: this.replayDatasetSource,
      total: this.replayState?.totalCandles ?? 0,
      loading: this.loading,
      loadingState: this.loadingState,
      error: this.error,
      dataError: this.dataError,
      pendingStartIndex: this.pendingStartIndex,
      retryCount: this.retryCount,
      replayState: this.replayState,
    });
  }
}
