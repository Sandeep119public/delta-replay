export const ORDER_TYPES = {
  MARKET: 'MARKET',
  LIMIT: 'LIMIT',
  STOP_MARKET: 'STOP_MARKET',
};

export const ORDER_STATUSES = {
  PENDING: 'PENDING',
  FILLED: 'FILLED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
};

/**
 * Immutable order model. Engine owns mutation via status transitions.
 */
export class Order {
  constructor({
    id,
    symbol,
    side,
    type,
    quantity,
    limitPrice = null,
    stopPrice = null,
    status = ORDER_STATUSES.PENDING,
    createdAt = null,
    createdReplayTime = null,
    createdIndex = -1,
    filledAt = null,
    filledPrice = null,
    entryFee = null,
    exitFee = null,
    rejectionReason = null,
    cancelReason = null,
  }) {
    this.id = id;
    this.symbol = symbol;
    this.side = side; // BUY/SELL
    this.type = type; // MARKET/LIMIT/STOP_MARKET
    this.quantity = quantity;
    this.limitPrice = limitPrice;
    this.stopPrice = stopPrice;
    this.status = status;
    this.createdAt = createdAt;
    this.createdReplayTime = createdReplayTime;
    this.createdIndex = createdIndex;
    this.filledAt = filledAt;
    this.filledPrice = filledPrice;
    this.entryFee = entryFee;
    this.exitFee = exitFee;
    this.rejectionReason = rejectionReason;
    this.cancelReason = cancelReason;
  }

  clone() {
    return new Order({ ...this });
  }

  toJSON() {
    return { ...this };
  }
}
