export class LiveMarketSession {
  constructor({ client, chartManager, appState, statusEl = null } = {}) {
    if (!client || !chartManager || !appState) throw new TypeError('LiveMarketSession requires client, chartManager, and appState');
    this.client = client;
    this.chart = chartManager;
    this.appState = appState;
    this.statusEl = statusEl;
    this._destroyed = false;
    this._generation = 0;
    this._abort = null;
  }

  async start() {
    if (this._destroyed) return false;
    const generation = ++this._generation;
    this.stop({ preserveGeneration: true });
    this._abort = new AbortController();
    const symbol = this.appState.symbol;
    const timeframe = this.appState.timeframe;
    if (this.statusEl) this.statusEl.textContent = `LIVE · ${symbol} ${timeframe}`;
    try {
      const candles = await this.client.fetchRecentCandles({ symbol, timeframe, limit: 500, signal: this._abort.signal });
      if (this._destroyed || generation !== this._generation || this._abort.signal.aborted) return false;
      this.chart.setRevealedMax(null);
      this.chart.setAutoFollow(true);
      this.chart.setData(candles, { fit: true });
      this.client.connect({
        symbol,
        timeframe,
        onCandle: (candle) => {
          if (generation !== this._generation || this._destroyed) return;
          this.chart.update(candle);
        },
        onStatus: ({ status, message }) => {
          if (generation !== this._generation || this._destroyed) return;
          const label = status === 'connected' ? 'LIVE' : status === 'connecting' ? 'LIVE · CONNECTING' : status === 'reconnecting' ? 'LIVE · RECONNECTING' : 'LIVE · ERROR';
          if (this.statusEl) this.statusEl.textContent = message ? `${label} · ${message}` : `${label} · ${symbol} ${timeframe}`;
        },
      });
      return true;
    } catch (error) {
      if (this.statusEl && !this._abort.signal.aborted) this.statusEl.textContent = `LIVE · ERROR`;
      return false;
    }
  }

  async restartForSelection(kind, value) {
    if (this._destroyed) return false;
    if (kind === 'symbol') this.appState.symbol = String(value).trim();
    else if (kind === 'timeframe') this.appState.timeframe = String(value).trim();
    else throw new Error(`Unsupported live dataset change: ${kind}`);
    return this.start();
  }

  stop({ preserveGeneration = false } = {}) {
    if (!preserveGeneration) this._generation += 1;
    this._abort?.abort();
    this._abort = null;
    this.client.stop();
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.stop();
    this.client.destroy();
  }
}
