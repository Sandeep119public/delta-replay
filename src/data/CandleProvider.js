/**
 * Abstract provider. ReplayEngine never knows source.
 */
export class CandleProvider {
  /**
   * @param {object} params
   * @param {string} params.symbol
   * @param {string} params.timeframe - e.g. '1m', '5m', '1h'
   * @param {number} [params.from] - unix seconds inclusive
   * @param {number} [params.to] - unix seconds inclusive
   * @param {number} [params.limit]
   * @param {AbortSignal} [params.signal]
   * @returns {Promise<Array<{time:number,open:number,high:number,low:number,close:number,volume:number}>>}
   */
  async getCandles({ symbol, timeframe, from, to, limit, signal } = {}) {
    throw new Error('CandleProvider.getCandles() not implemented');
  }
}
