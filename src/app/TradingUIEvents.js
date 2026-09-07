import { TradingEvents } from '../trading/TradingEvents.js';
import { TRADING_PRESENTATION_EVENTS } from '../ports/TradingPresentationPort.js';

export function createTradingUIEvents(tradingEngine) {
  return Object.freeze({
    events: TRADING_PRESENTATION_EVENTS,
    on: (event, handler) => tradingEngine?.on?.(event, handler),
    onAll(handler) {
      const unsubs = Object.values(TradingEvents)
        .map((event) => tradingEngine?.on?.(event, handler))
        .filter((unsubscribe) => typeof unsubscribe === 'function');
      return () => unsubs.forEach((unsubscribe) => { try { unsubscribe(); } catch {} });
    },
  });
}
