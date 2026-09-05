/**
 * FundingManager handles funding rate schedules, payment computations,
 * and funding transaction history for perpetual contract simulations.
 */
export class FundingManager {
  constructor({ schedule = null } = {}) {
    this._schedule = schedule;
    this._history = [];
    this._lastFundingTimestamp = null;
  }

  setSchedule(schedule) {
    this._schedule = schedule;
  }

  getSchedule() {
    return this._schedule;
  }

  getHistory() {
    return [...this._history];
  }

  reset() {
    this._history = [];
    this._lastFundingTimestamp = null;
  }

  /**
   * Apply funding payment across open positions.
   *
   * @param {object} params
   * @param {Map<string, object>} params.positions
   * @param {object} params.account
   * @param {string|null} [params.symbol]
   * @param {number} [params.fundingRate]
   * @param {number} [params.timestamp]
   * @param {number|null} [params.markPrice]
   * @returns {Array<object>} array of payment records
   */
  applyFundingRate({ positions, account, symbol = null, fundingRate = 0.0001, timestamp = null, markPrice = null } = {}) {
    const rate = Number(fundingRate);
    if (!Number.isFinite(rate) || !positions || !account) return [];

    const ts = timestamp ?? Date.now();
    const payments = [];

    for (const [sym, pos] of positions.entries()) {
      if (symbol && sym !== symbol) continue;

      const explicitMark = markPrice == null ? NaN : Number(markPrice);
      const resolvedMarkPrice = Number.isFinite(explicitMark)
        ? explicitMark
        : (Number.isFinite(pos.currentPrice) ? pos.currentPrice : pos.entryPrice);

      const notional = resolvedMarkPrice * pos.quantity;
      const payment = (pos.side === 'LONG' ? -1 : 1) * notional * rate;

      account.walletBalance += payment;
      if (payment < 0) account.totalFundingPaid += -payment;
      else if (payment > 0) account.totalFundingReceived += payment;
      account.netFunding = account.totalFundingReceived - account.totalFundingPaid;

      const record = {
        id: this._history.length + 1,
        timestamp: ts,
        symbol: sym,
        side: pos.side,
        quantity: pos.quantity,
        markPrice: resolvedMarkPrice,
        fundingRate: rate,
        payment,
      };

      this._history.push(record);
      payments.push(record);
    }

    return payments;
  }
}
