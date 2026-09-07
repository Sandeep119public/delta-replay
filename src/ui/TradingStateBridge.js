import { TradingEvents } from '../trading/TradingEvents.js';

/** Subscribes UI renderers to a read-only trading state adapter. */
export function bindTradingState({ tradingEngine, tradingState, onChange }) {
  const events = Object.values(TradingEvents);
  const unsubs = events.map((event) => tradingEngine.on?.(event, () => onChange(tradingState.snapshot())));
  onChange(tradingState.snapshot());
  return { destroy() { unsubs.forEach((unsubscribe) => { try { unsubscribe?.(); } catch {} }); } };
}
