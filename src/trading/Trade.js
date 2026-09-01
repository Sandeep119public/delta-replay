export class Trade {
  constructor({ id, symbol, side, quantity, entryPrice, exitPrice, openedAt, closedAt, realizedPnL }) {
    this.id = id;
    this.symbol = symbol;
    this.side = side;
    this.quantity = quantity;
    this.entryPrice = entryPrice;
    this.exitPrice = exitPrice;
    this.openedAt = openedAt;
    this.closedAt = closedAt;
    this.realizedPnL = realizedPnL;
  }

  clone() {
    return new Trade({ ...this });
  }

  toJSON() {
    return { ...this };
  }
}
