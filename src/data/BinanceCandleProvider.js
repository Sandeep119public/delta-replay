import { BinanceClient } from './BinanceClient.js';
import { TIMEFRAME_SECONDS } from './DeltaCandleProvider.js';
import { CandleIntegrity } from './CandleIntegrity.js';

export class BinanceCandleProvider {
  constructor({ client = null, chunkSize = 1000 } = {}) {
    this.client = client || new BinanceClient();
    this.chunkSize = chunkSize;
  }

  async getCandles({ symbol, timeframe, from, to, signal }) {
    const tfSec = TIMEFRAME_SECONDS[timeframe] || 60;
    const allRaw = [];
    let chunkStart = from;

    while (chunkStart < to) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const chunkEnd = Math.min(to, chunkStart + this.chunkSize * tfSec);
      const rawChunk = await this.client.fetchCandles({
        symbol,
        resolution: timeframe,
        start: chunkStart,
        end: chunkEnd,
        signal
      });

      if (Array.isArray(rawChunk) && rawChunk.length > 0) {
        allRaw.push(...rawChunk);
        const lastTime = rawChunk[rawChunk.length - 1].time;
        if (lastTime >= chunkEnd || lastTime <= chunkStart) {
          chunkStart = chunkEnd + tfSec;
        } else {
          chunkStart = lastTime + tfSec;
        }
      } else {
        chunkStart = chunkEnd + tfSec;
      }
    }

    return CandleIntegrity.process(allRaw, { from, to, timeframeSec: tfSec });
  }
}
