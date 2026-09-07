import { TRADING_PRESENTATION_EVENTS } from '../ports/TradingPresentationPort.js';

/**
 * Application adapter that converts the trading domain event source into the
 * neutral presentation port consumed by UI components.
 */
export function createTradingUIEvents(tradingEngine) {
  return Object.freeze({
    events: TRADING_PRESENTATION_EVENTS,
    on: (event, handler) => tradingEngine?.on?.(event, handler),
    onAll(handler) {
      const unsubs = Object.values(TRADING_PRESENTATION_EVENTS)
        .map((event) => tradingEngine?.on?.(event, handler))
        .filter((unsubscribe) => typeof unsubscribe === 'function');
      return () => unsubs.forEach((unsubscribe) => { try { unsubscribe(); } catch {} });
    },
  });
}
