/**
 * Futures margin account:
 * - walletBalance: realized funds
 * - equity = walletBalance + unrealizedPnL
 * - availableMargin = max(0, equity - usedMargin)
 * - marginRatio = maintenanceMargin / equity
 */
export class TradingAccount {
  constructor({ startingBalance = 10000 } = {}) {
    this.startingBalance = startingBalance;
    this.walletBalance = startingBalance;
    this.realizedPnL = 0; // net realized
    this.unrealizedPnL = 0; // gross unrealized
    this.totalFees = 0;
    this.usedMargin = 0;
    this.maintenanceMargin = 0;
    this.totalFundingPaid = 0;
    this.totalFundingReceived = 0;
    this.netFunding = 0;
  }

  get cashBalance() {
    return this.walletBalance;
  }

  set cashBalance(val) {
    this.walletBalance = val;
  }

  get initialMargin() {
    return this.usedMargin;
  }

  get equity() {
    return this.walletBalance + this.unrealizedPnL;
  }

  get availableMargin() {
    return Math.max(0, this.equity - this.usedMargin);
  }

  get marginRatio() {
    if (this.equity <= 0) return 1.0;
    return this.maintenanceMargin / this.equity;
  }

  reset() {
    this.walletBalance = this.startingBalance;
    this.realizedPnL = 0;
    this.unrealizedPnL = 0;
    this.totalFees = 0;
    this.usedMargin = 0;
    this.maintenanceMargin = 0;
    this.totalFundingPaid = 0;
    this.totalFundingReceived = 0;
    this.netFunding = 0;
  }

  snapshot() {
    return {
      startingBalance: this.startingBalance,
      walletBalance: this.walletBalance,
      cashBalance: this.cashBalance,
      realizedPnL: this.realizedPnL,
      unrealizedPnL: this.unrealizedPnL,
      totalFees: this.totalFees,
      totalFundingPaid: this.totalFundingPaid,
      totalFundingReceived: this.totalFundingReceived,
      netFunding: this.netFunding,
      usedMargin: this.usedMargin,
      initialMargin: this.initialMargin,
      maintenanceMargin: this.maintenanceMargin,
      availableMargin: this.availableMargin,
      marginRatio: this.marginRatio,
      equity: this.equity,
    };
  }
}
