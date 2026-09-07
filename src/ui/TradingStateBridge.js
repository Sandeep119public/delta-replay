import { assertTradingPresentation } from '../ports/TradingPresentationPort.js';

/**
 * Bridges the narrow trading presentation contract into UI state updates.
 * The UI never needs the trading domain engine itself.
 */
export function bindTradingState({ tradingEvents, trading, onChange }) {
  if (!tradingEvents?.onAll) throw new TypeError('tradingEvents.onAll is required');
  const tradingView = assertTradingPresentation(trading);
  const unsubscribe = tradingEvents.onAll(() => onChange(tradingView.snapshot()));
  onChange(tradingView.snapshot());
  return {
    destroy() {
      try { unsubscribe?.(); } catch {}
    },
  };
}
