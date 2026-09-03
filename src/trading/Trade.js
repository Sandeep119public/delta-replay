export class Trade {
  constructor({ id, symbol, side, quantity, entryPrice, exitPrice, openedAt, closedAt, realizedPnL, grossPnL, entryFee, exitFee, totalFee, netPnL, exitReason, ambiguityResolution = 'NONE' }) {
    this.id = id;
    this.symbol = symbol;
    this.side = side;
    this.quantity = quantity;
    this.entryPrice = entryPrice;
    this.exitPrice = exitPrice;
    this.openedAt = openedAt;
    this.closedAt = closedAt;
    // realizedPnL kept as net for backward compat
    this.realizedPnL = realizedPnL ?? netPnL ?? 0;
    this.grossPnL = grossPnL ?? realizedPnL ?? 0;
    this.entryFee = entryFee ?? 0;
    this.exitFee = exitFee ?? 0;
    this.totalFee = totalFee ?? (this.entryFee + this.exitFee);
    this.netPnL = netPnL ?? this.realizedPnL;
    this.exitReason = exitReason ?? null; // MARKET, LIMIT, STOP, STOP_LOSS, TAKE_PROFIT, LIQUIDATION
    this.ambiguityResolution = ambiguityResolution;
  }

  clone() {
    return new Trade({ ...this });
  }

  toJSON() {
    return { ...this };
  }
}
