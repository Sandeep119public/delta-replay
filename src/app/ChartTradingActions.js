import { TradingIntentResolver } from '../trading/TradingIntentResolver.js';

export function createChartTradingActions({ tradingEngine, coordinator }) {
  return {
    resolveClick(price) {
      if (!Number.isFinite(price) || price <= 0) return null;
      const activePos = (tradingEngine.getPositions?.() || [])[0] || null;
      return TradingIntentResolver.resolveClickIntent(price, activePos);
    },
    execute(intent) {
      if (!intent) return { success: false };
      if (intent.action === 'SET_TP') return tradingEngine.setTakeProfit(intent.symbol, intent.price);
      if (intent.action === 'SET_SL') return tradingEngine.setStopLoss(intent.symbol, intent.price);
      return { success: true };
    },
    reportError(message) { coordinator?.showTradingError?.(message); },
  };
}
