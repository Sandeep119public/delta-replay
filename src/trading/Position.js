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
  constructor({ symbol, side, quantity, entryPrice, currentPrice, openedAt, entryFee = 0 }) {
    this.symbol = symbol;
    this.side = side;
    this.quantity = quantity;
    this.entryPrice = entryPrice;
    this.currentPrice = currentPrice;
    this.openedAt = openedAt;
    this.entryFee = entryFee;
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
      unrealizedPnL: this.unrealizedPnL,
    };
  }
}
