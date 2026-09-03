import { CandleProvider } from './CandleProvider.js';
import { BinanceClient } from './BinanceClient.js';

/**
 * BinanceCandleProvider exposes raw candle chunks to HistoricalDataManager.
 * Chunking, retries, integrity and caching belong to the manager.
 */
export class BinanceCandleProvider extends CandleProvider {
  constructor({ client = null, chunkSize = 1000 } = {}) {
    super();
    this.client = client || new BinanceClient();
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
   * Legacy provider interface. Return type intentionally matches fetchChunk.
   */
  async getCandles({ symbol, timeframe, from, to, signal } = {}) {
    return this.fetchChunk({ symbol, timeframe, from, to, signal });
  }
}
