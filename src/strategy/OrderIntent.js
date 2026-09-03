import { ORDER_TYPES } from '../trading/Order.js';

export class OrderIntent {
  constructor({
    symbol,
    side,
    type = ORDER_TYPES.MARKET,
    quantity,
    limitPrice = null,
    stopPrice = null,
    generatedIndex = -1,
    generatedTimestamp = null,
    metadata = {},
  }) {
    this.symbol = symbol;
    this.side = side;
    this.type = type;
    this.quantity = quantity;
    this.limitPrice = limitPrice;
    this.stopPrice = stopPrice;
    this.generatedIndex = generatedIndex;
    this.generatedTimestamp = generatedTimestamp;
    this.metadata = metadata;
  }

  toJSON() {
    return { ...this };
  }
}
