/**
 * Position model — one per symbol.
 */
export class Position {
  /**
   * @param {object} p
   * @param {string} p.symbol
   * @param {'LONG'|'SHORT'} p.side
   * @param {number} p.quantity
   * @param {number} p.entryPrice
   * @param {number} p.currentPrice
   * @param {number} p.openedAt - unix seconds
   * @param {number} [p.entryFee] - fee at entry (notional * rate)
   */
  constructor({ symbol, side, quantity, entryPrice, currentPrice, openedAt, entryFee = 0, openedIndex = -1, stopLossPrice = null, takeProfitPrice = null, stopLossCreatedIndex = -1, takeProfitCreatedIndex = -1, initialMargin = 0, maintenanceMargin = 0, liquidationPrice = null }) {
    this.symbol = symbol;
    this.side = side;
    this.quantity = quantity;
    this.entryPrice = entryPrice;
    this.currentPrice = currentPrice;
    this.openedAt = openedAt;
    this.entryFee = entryFee;
    this.openedIndex = openedIndex;
    this.stopLossPrice = stopLossPrice;
    this.takeProfitPrice = takeProfitPrice;
    this.stopLossCreatedIndex = stopLossCreatedIndex;
    this.takeProfitCreatedIndex = takeProfitCreatedIndex;
    this.initialMargin = initialMargin;
    this.maintenanceMargin = maintenanceMargin;
    this.liquidationPrice = liquidationPrice;
  }

  get unrealizedPnL() {
    if (this.side === 'LONG') return (this.currentPrice - this.entryPrice) * this.quantity;
    return (this.entryPrice - this.currentPrice) * this.quantity;
  }

  clone() {
    return new Position({
      symbol: this.symbol,
      side: this.side,
      quantity: this.quantity,
      entryPrice: this.entryPrice,
      currentPrice: this.currentPrice,
      openedAt: this.openedAt,
      entryFee: this.entryFee,
      openedIndex: this.openedIndex,
      stopLossPrice: this.stopLossPrice,
      takeProfitPrice: this.takeProfitPrice,
      stopLossCreatedIndex: this.stopLossCreatedIndex,
      takeProfitCreatedIndex: this.takeProfitCreatedIndex,
      initialMargin: this.initialMargin,
      maintenanceMargin: this.maintenanceMargin,
      liquidationPrice: this.liquidationPrice,
    });
  }

  toJSON() {
    return {
      symbol: this.symbol,
      side: this.side,
      quantity: this.quantity,
      entryPrice: this.entryPrice,
      currentPrice: this.currentPrice,
      openedAt: this.openedAt,
      entryFee: this.entryFee,
      openedIndex: this.openedIndex,
      stopLossPrice: this.stopLossPrice,
      takeProfitPrice: this.takeProfitPrice,
      stopLossCreatedIndex: this.stopLossCreatedIndex,
      takeProfitCreatedIndex: this.takeProfitCreatedIndex,
      initialMargin: this.initialMargin,
      maintenanceMargin: this.maintenanceMargin,
      liquidationPrice: this.liquidationPrice,
      unrealizedPnL: this.unrealizedPnL,
    };
  }
}
