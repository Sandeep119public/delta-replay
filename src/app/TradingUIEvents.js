import { TradingEvents } from '../trading/TradingEvents.js';

/**
 * Presentation-facing event port for trading state changes.
 * The UI receives this adapter instead of the trading domain engine.
 */
export function createTradingUIEvents(tradingEngine) {
  return Object.freeze({
    events: TradingEvents,
    on: (event, handler) => tradingEngine?.on?.(event, handler),
    onAll(handler) {
      const unsubs = Object.values(TradingEvents).map((event) => tradingEngine?.on?.(event, handler)).filter((unsubscribe) => typeof unsubscribe === 'function');
      return () => unsubs.forEach((unsubscribe) => { try { unsubscribe(); } catch {} });
    },
  });
}
