import { TradingEvents } from '../trading/TradingEvents.js';

/**
 * Application adapter that converts the trading domain event source into the
 * neutral presentation port consumed by UI components.
 */
export function createTradingUIEvents(tradingEngine) {
  return Object.freeze({
    events: TradingEvents,
    on: (event, handler) => tradingEngine?.on?.(event, handler),
    onAll(handler) {
      const unsubs = Object.values(TradingEvents)
        .map((event) => tradingEngine?.on?.(event, handler))
        .filter((unsubscribe) => typeof unsubscribe === 'function');
      return () => unsubs.forEach((unsubscribe) => { try { unsubscribe(); } catch {} });
    },
  });
}
