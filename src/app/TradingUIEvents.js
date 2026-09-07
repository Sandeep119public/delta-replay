import { TradingEvents } from '../trading/TradingEvents.js';

/**
 * Presentation-facing event port for trading state changes.
 * The UI receives this adapter instead of the trading domain engine.
 */
export function createTradingUIEvents(tradingEngine) {
  return Object.freeze({
    on: (event, handler) => tradingEngine?.on?.(event, handler),
    events: TradingEvents,
  });
}
