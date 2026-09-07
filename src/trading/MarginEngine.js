/**
 * MarginEngine encapsulates futures initial margin requirements,
 * maintenance margins, liquidation price formulas, and portfolio liquidation checks.
 */
export class MarginEngine {
  constructor({ marginRate = 1.0, maintMarginRate = null } = {}) {
    const im = MarginEngine._validateRate(marginRate, 'marginRate');
    const mm = maintMarginRate == null ? im * 0.5 : MarginEngine._validateRate(maintMarginRate, 'maintMarginRate');
    if (mm > im) throw new Error('maintMarginRate must be <= marginRate');
    this.marginRate = im;
    this.maintMarginRate = mm;
  }

  static _validateRate(value, name) {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new Error(`${name} must be a finite number in [0, 1]`);
    }
    return rate;
  }

  setRates({ marginRate = this.marginRate, maintMarginRate = this.maintMarginRate } = {}) {
    const im = MarginEngine._validateRate(marginRate, 'marginRate');
    const mm = MarginEngine._validateRate(maintMarginRate, 'maintMarginRate');
    if (mm > im) throw new Error('maintMarginRate must be <= marginRate');
    this.marginRate = im;
    this.maintMarginRate = mm;
    return { marginRate: im, maintMarginRate: mm };
  }

  getEffectiveIMRate() { return this.marginRate; }
  getEffectiveMMRate() { return this.maintMarginRate; }

  calcRequiredEntryCash(price, quantity, fee) {
    return price * quantity * this.marginRate + fee;
  }

  checkMarginAvailable({ price, quantity, fee, availableMargin, walletBalance }) {
    const requiredInitialMargin = price * quantity * this.marginRate;
    const requiredMargin = requiredInitialMargin + fee;
    const hasMargin = availableMargin >= requiredMargin && walletBalance >= fee;
    return { valid: hasMargin, requiredMargin, availableMargin, fee, initialMargin: requiredInitialMargin };
  }

  calcPositionMargins(price, quantity, side, liquidationPrice = null) {
    const notional = price * quantity;
    return { initialMargin: notional * this.marginRate, maintenanceMargin: notional * this.maintMarginRate, liquidationPrice };
  }

  calcLiquidationPrice(pos, positionsMap, walletBalance) {
    if (!pos) return null;
    let otherUnrealized = 0;
    let otherMM = 0;
    for (const [sym, other] of positionsMap.entries()) {
      if (sym === pos.symbol) continue;
      otherUnrealized += Number(other.unrealizedPnL) || 0;
      const mark = Number.isFinite(other.currentPrice) ? other.currentPrice : other.entryPrice;
      otherMM += other.quantity * mark * this.maintMarginRate;
    }
    const W = walletBalance + otherUnrealized;
    const Q = pos.quantity;
    const P_entry = pos.entryPrice;
    if (pos.side === 'LONG') {
      const denom = Q * (1 - this.maintMarginRate);
      if (denom <= 0) return null;
      const liqPrice = (P_entry * Q + otherMM - W) / denom;
      return liqPrice > 0 ? liqPrice : null;
    }
    const denom = Q * (1 + this.maintMarginRate);
    if (denom <= 0) return null;
    const liqPrice = (W + P_entry * Q - otherMM) / denom;
    return liqPrice > 0 ? liqPrice : null;
  }

  calcPortfolioMarginState(symbol, markPrice, positionsMap, walletBalance) {
    let equity = walletBalance;
    let maintenanceMargin = 0;
    for (const [sym, pos] of positionsMap.entries()) {
      const mark = sym === symbol ? markPrice : (Number.isFinite(pos.currentPrice) ? pos.currentPrice : pos.entryPrice);
      equity += pos.side === 'LONG' ? (mark - pos.entryPrice) * pos.quantity : (pos.entryPrice - mark) * pos.quantity;
      maintenanceMargin += Math.abs(mark * pos.quantity) * this.maintMarginRate;
    }
    return { equity, maintenanceMargin };
  }

  isPortfolioLiquidatable(symbol, markPrice, positionsMap, walletBalance) {
    const state = this.calcPortfolioMarginState(symbol, markPrice, positionsMap, walletBalance);
    return state.equity <= state.maintenanceMargin + 1e-9;
  }
}
