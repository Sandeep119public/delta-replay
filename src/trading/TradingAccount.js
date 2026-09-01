/**
 * Simple USD account: cashBalance + unrealizedPnL = equity
 * Fees = 0, no leverage/margin.
 */
export class TradingAccount {
  constructor({ startingBalance = 10000 } = {}) {
    this.startingBalance = startingBalance;
    this.cashBalance = startingBalance;
    this.realizedPnL = 0;
    this.unrealizedPnL = 0;
  }

  get equity() {
    return this.cashBalance + this.unrealizedPnL;
  }

  reset() {
    this.cashBalance = this.startingBalance;
    this.realizedPnL = 0;
    this.unrealizedPnL = 0;
  }

  snapshot() {
    return {
      startingBalance: this.startingBalance,
      cashBalance: this.cashBalance,
      realizedPnL: this.realizedPnL,
      unrealizedPnL: this.unrealizedPnL,
      equity: this.equity,
    };
  }
}
