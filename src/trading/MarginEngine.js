/**
 * MarginEngine encapsulates futures initial margin requirements,
 * maintenance margins, liquidation price formulas, and portfolio liquidation checks.
 */
export class MarginEngine {
  constructor({ marginRate = 1.0, maintMarginRate = null } = {}) {
    this.marginRate = marginRate;
    this.maintMarginRate = maintMarginRate ?? (marginRate * 0.5);
  }

  getEffectiveIMRate() {
    return (typeof this.marginRate === 'number' && this.marginRate >= 0) ? this.marginRate : 1.0;
  }

  getEffectiveMMRate() {
    const imRate = this.getEffectiveIMRate();
    return (typeof this.maintMarginRate === 'number' && this.maintMarginRate >= 0) ? this.maintMarginRate : imRate * 0.5;
  }

  calcRequiredEntryCash(price, quantity, fee) {
    const notional = price * quantity;
    const imRate = this.getEffectiveIMRate();
    return notional * imRate + fee;
  }

  checkMarginAvailable({ price, quantity, fee, availableMargin, walletBalance }) {
    const notional = price * quantity;
    const imRate = this.getEffectiveIMRate();
    const requiredInitialMargin = notional * imRate;
    const requiredMargin = requiredInitialMargin + fee;
    const hasMargin = availableMargin >= requiredMargin && walletBalance >= fee;
    return {
      valid: hasMargin,
      requiredMargin,
      availableMargin,
      fee,
      initialMargin: requiredInitialMargin,
    };
  }

  calcPositionMargins(price, quantity, side, liquidationPrice = null) {
    const notional = price * quantity;
    const imRate = this.getEffectiveIMRate();
    const mmRate = this.getEffectiveMMRate();
    const initialMargin = notional * imRate;
    const maintenanceMargin = notional * mmRate;
    return { initialMargin, maintenanceMargin, liquidationPrice };
  }

  calcLiquidationPrice(pos, positionsMap, walletBalance) {
    if (!pos) return null;
    const mmRate = this.getEffectiveMMRate();
    let otherUnrealized = 0;
    let otherMM = 0;

    for (const [sym, other] of positionsMap.entries()) {
      if (sym === pos.symbol) continue;
      otherUnrealized += (other.unrealizedPnL || 0);
      const mark = Number.isFinite(other.currentPrice) ? other.currentPrice : other.entryPrice;
      otherMM += other.quantity * mark * mmRate;
    }

    const W = walletBalance + otherUnrealized;
    const Q = pos.quantity;
    const P_entry = pos.entryPrice;

    if (pos.side === 'LONG') {
      const denom = Q * (1 - mmRate);
      if (denom <= 0) return null;
      const liqPrice = (P_entry * Q + otherMM - W) / denom;
      return liqPrice > 0 ? liqPrice : null;
    }

    const denom = Q * (1 + mmRate);
    if (denom <= 0) return null;
    const liqPrice = (W + P_entry * Q - otherMM) / denom;
    return liqPrice > 0 ? liqPrice : null;
  }

  calcPortfolioMarginState(symbol, markPrice, positionsMap, walletBalance) {
    const mmRate = this.getEffectiveMMRate();
    let equity = walletBalance;
    let maintenanceMargin = 0;

    for (const [sym, pos] of positionsMap.entries()) {
      const mark = sym === symbol ? markPrice : (Number.isFinite(pos.currentPrice) ? pos.currentPrice : pos.entryPrice);
      equity += pos.side === 'LONG' ? (mark - pos.entryPrice) * pos.quantity : (pos.entryPrice - mark) * pos.quantity;
      maintenanceMargin += Math.abs(mark * pos.quantity) * mmRate;
    }

    return { equity, maintenanceMargin };
  }

  isPortfolioLiquidatable(symbol, markPrice, positionsMap, walletBalance) {
    const state = this.calcPortfolioMarginState(symbol, markPrice, positionsMap, walletBalance);
    return state.equity <= state.maintenanceMargin + 1e-9;
  }
}
