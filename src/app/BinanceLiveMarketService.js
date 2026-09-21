import { BinanceClient } from '../data/BinanceClient.js';

const DEFAULT_WS_BASE = 'wss://fstream.binance.com/market/ws';
const LIVE_CANDLE_LIMIT = 300;
const RECONNECT_DELAY_MS = 2000;

export class BinanceLiveMarketService {
  constructor({ client = null, chartManager, wsFactory = null, onStatus = null } = {}) {
    if (!chartManager) throw new TypeError('BinanceLiveMarketService requires chartManager');
    this.client = client || new BinanceClient();
    this.chartManager = chartManager;
    this.wsFactory = wsFactory || ((url) => {
      const WebSocketImpl = globalThis.WebSocket;
      if (!WebSocketImpl) throw new Error('WebSocket is not available in this browser');
      return new WebSocketImpl(url);
    });
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.websocket = null;
    this.reconnectTimer = null;
    this.abortController = null;
    this.generation = 0;
    this.symbol = null;
    this.timeframe = null;
    this.destroyed = false;
  }

  _setStatus(status, detail = '') {
    this.onStatus({ status, detail, symbol: this.symbol, timeframe: this.timeframe });
  }

  async start({ symbol, timeframe } = {}) {
    const nextSymbol = String(symbol || '').trim().toUpperCase();
    const nextTimeframe = String(timeframe || '').trim();
    if (!nextSymbol || !nextTimeframe) throw new Error('Live market symbol and timeframe are required');

    this.stop();
    const generation = ++this.generation;
    this.symbol = nextSymbol;
    this.timeframe = nextTimeframe;
    this._setStatus('connecting');

    const controller = new AbortController();
    this.abortController = controller;
    const tfSeconds = this._timeframeSeconds(nextTimeframe);
    const end = Math.floor(Date.now() / 1000);
    const from = end - tfSeconds * LIVE_CANDLE_LIMIT;

    try {
      const candles = await this.client.fetchCandles({
        symbol: nextSymbol,
        resolution: nextTimeframe,
        start: from,
        end,
        signal: controller.signal,
      });
      if (this.destroyed || generation !== this.generation) return;
      this.chartManager.setRevealedMax(null);
      this.chartManager.setData(candles.slice(-LIVE_CANDLE_LIMIT), { fit: true });
    } catch (error) {
      if (this.destroyed || generation !== this.generation) return;
      if (error?.name === 'AbortError') return;
      this._setStatus('error', error?.message || 'Unable to load live market data');
      return;
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }

    if (this.destroyed || generation !== this.generation) return;
    this._connectWebSocket(generation, nextSymbol, nextTimeframe);
  }

  _timeframeSeconds(timeframe) {
    const map = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800, '12h': 43200, '1d': 86400, '3d': 259200, '1w': 604800 };
    const value = map[timeframe];
    if (!value) throw new Error('Unsupported live timeframe: ' + timeframe);
    return value;
  }

  _connectWebSocket(generation, symbol, timeframe) {
    if (this.destroyed || generation !== this.generation) return;
    this._clearReconnect();
    const url = DEFAULT_WS_BASE + '/' + encodeURIComponent(symbol.toLowerCase()) + '@kline_' + encodeURIComponent(timeframe);
    try {
      const socket = this.wsFactory(url);
      this.websocket = socket;
      socket.onopen = () => {
        if (generation !== this.generation || this.destroyed) return;
        this._setStatus('live');
      };
      socket.onmessage = (event) => {
        if (generation !== this.generation || this.destroyed) return;
        try {
          const outer = typeof event?.data === 'string' ? JSON.parse(event.data) : event?.data;
          const payload = outer?.data || outer;
          const k = payload?.k;
          if (!k) return;
          const candle = {
            time: Math.floor(Number(k.t) / 1000),
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
            volume: Number(k.v),
          };
          if (!Object.values(candle).every(Number.isFinite)) return;
          this.chartManager.update(candle);
        } catch (error) {
          this._setStatus('error', error?.message || 'Invalid live candle update');
        }
      };
      socket.onerror = () => {
        if (generation === this.generation && !this.destroyed) this._setStatus('error', 'Binance live stream error');
      };
      socket.onclose = () => {
        if (generation !== this.generation || this.destroyed) return;
        this.websocket = null;
        this._setStatus('reconnecting', 'Binance live stream disconnected');
        this.reconnectTimer = setTimeout(() => this._connectWebSocket(generation, symbol, timeframe), RECONNECT_DELAY_MS);
      };
    } catch (error) {
      this._setStatus('error', error?.message || 'Unable to connect to Binance live stream');
      this.reconnectTimer = setTimeout(() => this._connectWebSocket(generation, symbol, timeframe), RECONNECT_DELAY_MS);
    }
  }

  _clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  stop() {
    this.generation += 1;
    this._clearReconnect();
    if (this.abortController) {
      try { this.abortController.abort(); } catch {}
      this.abortController = null;
    }
    if (this.websocket) {
      try { this.websocket.close(); } catch {}
      this.websocket = null;
    }
    this._setStatus('stopped');
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    this.onStatus = () => {};
  }
}
