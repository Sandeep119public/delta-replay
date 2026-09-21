import { resolveVenueSymbol, VENUES } from './InstrumentConfig.js';

export const BINANCE_LIVE_WS_BASE = 'wss://fstream.binance.com/market/ws';
export const BINANCE_LIVE_REST_BASE = 'https://fapi.binance.com';

function normalizeKline(row) {
  return {
    time: Math.floor(Number(row[0]) / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
}

function normalizeSocketCandle(payload) {
  const kline = payload?.k;
  if (!kline) return null;
  return {
    time: Math.floor(Number(kline.t) / 1000),
    open: Number(kline.o),
    high: Number(kline.h),
    low: Number(kline.l),
    close: Number(kline.c),
    volume: Number(kline.v),
  };
}

export class BinanceLiveMarketClient {
  constructor({
    restBase = BINANCE_LIVE_REST_BASE,
    wsBase = BINANCE_LIVE_WS_BASE,
    fetchFn = null,
    WebSocketCtor = null,
  } = {}) {
    this.restBase = restBase.replace(/\/$/, '');
    this.wsBase = wsBase.replace(/\/$/, '');
    this.fetchFn = fetchFn || globalThis.fetch.bind(globalThis);
    this.WebSocketCtor = WebSocketCtor || globalThis.WebSocket;
    this.socket = null;
    this.onCandle = null;
    this.onStatus = null;
    this._reconnectTimer = null;
    this._stopped = true;
  }

  async fetchRecentCandles({ symbol, timeframe, limit = 500, signal } = {}) {
    const mapped = resolveVenueSymbol(symbol, VENUES.BINANCE_FUTURES);
    const params = new URLSearchParams({
      symbol: mapped,
      interval: String(timeframe),
      limit: String(Math.min(1500, Math.max(1, Number(limit) || 500))),
    });
    const response = await this.fetchFn(
      `${this.restBase}/fapi/v1/klines?${params.toString()}`,
      { headers: { Accept: 'application/json' }, signal },
    );
    if (!response.ok) throw new Error(`Binance live data request failed: ${response.status} ${response.statusText}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('Binance live data returned invalid candles');
    return payload.map(normalizeKline).filter((candle) => Number.isFinite(candle.time));
  }

  connect({ symbol, timeframe, onCandle, onStatus } = {}) {
    this.stop();
    if (typeof this.WebSocketCtor !== 'function') {
      onStatus?.({ status: 'unavailable', message: 'WebSocket is not available in this browser' });
      return;
    }
    this.onCandle = onCandle;
    this.onStatus = onStatus;
    this.symbol = resolveVenueSymbol(symbol, VENUES.BINANCE_FUTURES);
    this.timeframe = String(timeframe);
    this._stopped = false;
    this._openSocket();
  }

  _openSocket() {
    if (this._stopped || !this.symbol || !this.timeframe) return;
    const stream = `${this.symbol.toLowerCase()}@kline_${this.timeframe}`;
    this.onStatus?.({ status: 'connecting' });
    const socket = new this.WebSocketCtor(`${this.wsBase}/${stream}`);
    this.socket = socket;
    socket.onopen = () => this.onStatus?.({ status: 'connected' });
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const candle = normalizeSocketCandle(payload);
        if (candle) this.onCandle?.(candle);
      } catch (error) {
        this.onStatus?.({ status: 'error', message: error?.message || 'Invalid live market message' });
      }
    };
    socket.onerror = () => this.onStatus?.({ status: 'error', message: 'Binance live stream error' });
    socket.onclose = () => {
      this.socket = null;
      if (this._stopped) return;
      this.onStatus?.({ status: 'reconnecting' });
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this._openSocket();
      }, 2000);
    };
  }

  stop() {
    this._stopped = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    if (this.socket) {
      try { this.socket.close(); } catch {}
      this.socket = null;
    }
  }

  destroy() {
    this.stop();
    this.onCandle = null;
    this.onStatus = null;
  }
}
