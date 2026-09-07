/**
 * Bridges a read-only trading presentation event port into UI state updates.
 * The UI never needs the trading domain engine itself.
 */
export function bindTradingState({ tradingEvents, tradingState, onChange }) {
  if (!tradingEvents?.onAll) throw new TypeError('tradingEvents.onAll is required');
  const unsubscribe = tradingEvents.onAll(() => onChange(tradingState.snapshot()));
  onChange(tradingState.snapshot());
  return {
    destroy() {
      try { unsubscribe?.(); } catch {}
    },
  };
}
