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

export const EXECUTION_TIMING = Object.freeze({
  NEXT_BAR_OPEN: 'NEXT_BAR_OPEN',
  IMMEDIATE_CLOSE: 'IMMEDIATE_CLOSE',
});

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
    timing = EXECUTION_TIMING.IMMEDIATE_CLOSE,
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
    this.id = String(id);
    this.symbol = symbol;
    this.side = side; // BUY/SELL
    this.type = type; // MARKET/LIMIT/STOP_MARKET
    this.quantity = quantity;
    this.limitPrice = limitPrice;
    this.stopPrice = stopPrice;
    this.timing = timing;
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

  fill({ filledPrice, filledAt, entryFee = null, exitFee = null } = {}) {
    if (this.status !== ORDER_STATUSES.PENDING) {
      throw new Error(`Cannot fill order ${this.id}: status is ${this.status}, expected PENDING`);
    }
    this.status = ORDER_STATUSES.FILLED;
    this.filledPrice = Number(filledPrice);
    this.filledAt = filledAt;
    if (entryFee != null) this.entryFee = entryFee;
    if (exitFee != null) this.exitFee = exitFee;
    return this;
  }

  reject(reason) {
    if (this.status !== ORDER_STATUSES.PENDING) {
      throw new Error(`Cannot reject order ${this.id}: status is ${this.status}, expected PENDING`);
    }
    this.status = ORDER_STATUSES.REJECTED;
    this.rejectionReason = reason;
    return this;
  }

  cancel(reason) {
    if (this.status !== ORDER_STATUSES.PENDING) {
      throw new Error(`Cannot cancel order ${this.id}: status is ${this.status}, expected PENDING`);
    }
    this.status = ORDER_STATUSES.CANCELLED;
    this.cancelReason = reason;
    return this;
  }

  clone() {
    return new Order({ ...this });
  }

  toJSON() {
    return { ...this };
  }
}
