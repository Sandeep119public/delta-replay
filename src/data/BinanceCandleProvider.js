import { CandleProvider } from './CandleProvider.js';

/**
 * BinanceCandleProvider exposes raw canonical-ish candle chunks to
 * HistoricalDataManager. Chunking, retries, integrity and caching belong to
 * the manager, so this provider deliberately has one responsibility: I/O.
 */
export class BinanceCandleProvider extends CandleProvider {
  constructor({ client = null, chunkSize = 1000 } = {}) {
    super();
    this.client = client || new (await import('./BinanceClient.js')).BinanceClient();
    this.chunkSize = chunkSize;
  }

  async fetchChunk({ symbol, timeframe, from, to, signal } = {}) {
    return this.client.fetchCandles({
      symbol,
      resolution: timeframe,
      start: from,
      end: to,
      signal,
    });
  }

  /**
   * Legacy provider interface. The return type is intentionally an array,
   * matching fetchChunk and the CandleProvider contract.
   */
  async getCandles({ symbol, timeframe, from, to, signal } = {}) {
    return this.fetchChunk({ symbol, timeframe, from, to, signal });
  }
}
