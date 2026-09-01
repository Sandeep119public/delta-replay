import { EventEmitter } from '../core/EventEmitter.js';

export class AppState extends EventEmitter {
  constructor() {
    super();
    this.symbol = 'BTCUSD';
    this.timeframe = '1m';
    this.candles = []; // normalized validated candles currently loaded (full dataset)
    this.loading = false;
    this.error = null;
    this.replayState = null;
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
    this.candles = candles;
    this.emit('candles', candles);
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
