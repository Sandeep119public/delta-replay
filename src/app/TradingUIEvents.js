import { TRADING_PRESENTATION_EVENTS } from '../ports/TradingPresentationPort.js';

const PRESENTATION_EVENT_NAMES = new Set(Object.values(TRADING_PRESENTATION_EVENTS));

function assertEvent(event) {
  if (!PRESENTATION_EVENT_NAMES.has(event)) {
    throw new TypeError(`Unsupported trading presentation event: ${String(event)}`);
  }
  return event;
}

/**
 * Application adapter that converts the trading domain event source into the
 * neutral presentation port consumed by UI components. Only events explicitly
 * published by the presentation contract may cross the boundary.
 */
export function createTradingUIEvents(tradingEngine) {
  if (!tradingEngine || typeof tradingEngine !== 'object') {
    throw new TypeError('createTradingUIEvents requires a trading engine');
  }

  return Object.freeze({
    events: TRADING_PRESENTATION_EVENTS,
    on(event, handler) {
      if (typeof handler !== 'function') throw new TypeError('trading event handler must be a function');
      return tradingEngine.on?.(assertEvent(event), handler);
    },
    onAll(handler) {
      if (typeof handler !== 'function') throw new TypeError('trading event handler must be a function');
      const unsubs = [...PRESENTATION_EVENT_NAMES]
        .map((event) => tradingEngine.on?.(event, handler))
        .filter((unsubscribe) => typeof unsubscribe === 'function');
      return () => unsubs.forEach((unsubscribe) => { try { unsubscribe(); } catch {} });
    },
  });
}
