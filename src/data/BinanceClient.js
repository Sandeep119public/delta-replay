export const BINANCE_DEFAULT_BASE = 'https://api.binance.com';

export class BinanceClient {
  constructor({ baseUrl = BINANCE_DEFAULT_BASE, timeoutMs = 15000, fetchFn } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    if (fetchFn) {
      this.fetchFn = fetchFn;
    } else {
      const _fetch = globalThis.fetch;
      const _g = globalThis;
      this.fetchFn = (url, init) => _fetch.call(_g, url, init);
    }
  }

  async fetchCandles({ symbol, resolution, start, end, signal }) {
    if (!symbol) throw new Error('symbol required');
    if (!resolution) throw new Error('resolution required');

    let mappedSymbol = symbol.replace(/[^A-Z0-9]/g, '').toUpperCase();
    if (mappedSymbol === 'BTCUSD') mappedSymbol = 'BTCUSDT';
    if (mappedSymbol === 'ETHUSD') mappedSymbol = 'ETHUSDT';
    if (mappedSymbol === 'SOLUSD') mappedSymbol = 'SOLUSDT';
    if (mappedSymbol === 'XRPUSD') mappedSymbol = 'XRPUSDT';
    if (mappedSymbol === 'DOGEUSD') mappedSymbol = 'DOGEUSDT';

    const startMs = Math.floor(start) * 1000;
    const endMs = Math.floor(end) * 1000;
    const url = `${this.baseUrl}/api/v3/klines?symbol=${encodeURIComponent(mappedSymbol)}&interval=${encodeURIComponent(resolution)}&startTime=${startMs}&endTime=${endMs}&limit=1000`;

    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) {
        throw new Error(`Binance API error: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      if (!Array.isArray(data)) return [];

      return data.map(item => {
        if (Array.isArray(item)) {
          return {
            time: Math.floor(Number(item[0]) / 1000),
            open: parseFloat(item[1]),
            high: parseFloat(item[2]),
            low: parseFloat(item[3]),
            close: parseFloat(item[4]),
            volume: parseFloat(item[5])
          };
        }
        return item;
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
