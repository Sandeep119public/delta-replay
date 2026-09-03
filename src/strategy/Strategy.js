import { EventEmitter } from '../core/EventEmitter.js';
import { OrderIntent } from './OrderIntent.js';
import { ORDER_TYPES } from '../trading/Order.js';

export class Strategy extends EventEmitter {
  constructor(name = 'Strategy') {
    super();
    this.name = name;
    this.indicators = new Map();
    this._currentBar = null;
  }

  addIndicator(name, indicator) {
    this.indicators.set(name, indicator);
    return indicator;
  }

  getIndicator(name) {
    return this.indicators.get(name);
  }

  /**
   * Called strictly on finalized bar close: { index, timestamp, candle, phase: 'BAR_CLOSE' }
   * Returns array of OrderIntent objects
   */
  onBar(barEvent) {
    this._currentBar = barEvent;
    // Update all registered indicators lookahead-free
    for (const ind of this.indicators.values()) {
      ind.update(barEvent.candle);
    }
    return this.evaluate(barEvent);
  }

  /**
   * Override in concrete strategies
   */
  evaluate(barEvent) {
    return [];
  }

  createIntent({ symbol, side, type = ORDER_TYPES.MARKET, quantity, limitPrice = null, stopPrice = null, metadata = {} }) {
    if (!this._currentBar) {
      throw new Error('Cannot create intent without current bar context');
    }
    return new OrderIntent({
      symbol,
      side,
      type,
      quantity,
      limitPrice,
      stopPrice,
      generatedIndex: this._currentBar.index,
      generatedTimestamp: this._currentBar.timestamp,
      metadata,
    });
  }

  reset() {
    this._currentBar = null;
    for (const ind of this.indicators.values()) {
      ind.reset();
    }
  }
}
