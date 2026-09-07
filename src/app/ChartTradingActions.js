import { TradingIntentResolver } from '../trading/TradingIntentResolver.js';

export function createChartTradingActions({ trading, executeTrade, reportError }) {
  if (!trading || typeof trading !== 'object') throw new TypeError('createChartTradingActions requires trading presentation');
  if (typeof executeTrade !== 'function') throw new TypeError('createChartTradingActions requires executeTrade');
  if (typeof reportError !== 'function') throw new TypeError('createChartTradingActions requires reportError');

  return Object.freeze({
    resolveClick(price) {
      if (!Number.isFinite(price) || price <= 0) return null;
      const snapshot = trading.snapshot?.() || {};
      const activePos = snapshot.positions?.[0] || null;
      return TradingIntentResolver.resolveClickIntent(price, activePos);
    },
    execute(intent) {
      if (!intent) return { success: false };
      return executeTrade(intent);
    },
    reportError,
  });
}
