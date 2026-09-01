/**
 * Simple USD account: cashBalance + unrealizedPnL = equity
 * Fees tracked via totalFees. Net realized already includes fees.
 */
export class TradingAccount {
  constructor({ startingBalance = 10000 } = {}) {
    this.startingBalance = startingBalance;
    this.cashBalance = startingBalance;
    this.realizedPnL = 0; // net realized
    this.unrealizedPnL = 0; // gross unrealized
    this.totalFees = 0;
  }

  get equity() {
    return this.cashBalance + this.unrealizedPnL;
  }

  reset() {
    this.cashBalance = this.startingBalance;
    this.realizedPnL = 0;
    this.unrealizedPnL = 0;
    this.totalFees = 0;
  }

  snapshot() {
    return {
      startingBalance: this.startingBalance,
      cashBalance: this.cashBalance,
      realizedPnL: this.realizedPnL,
      unrealizedPnL: this.unrealizedPnL,
      totalFees: this.totalFees,
      equity: this.equity,
    };
  }
}
