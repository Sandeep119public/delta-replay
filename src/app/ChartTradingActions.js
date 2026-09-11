function resolveClickIntent(price, activePosition) {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!activePosition) return { action: 'OPEN', price };

  const entry = Number(activePosition.entryPrice ?? activePosition.entry_price);
  const side = String(activePosition.side || '').toUpperCase();
  if (!Number.isFinite(entry)) return { action: 'CLOSE', price };
  if (side === 'LONG' || side === 'BUY') return price < entry ? { action: 'SET_SL', price } : { action: 'SET_TP', price };
  return price > entry ? { action: 'SET_SL', price } : { action: 'SET_TP', price };
}

const KNOWN_ACTIONS = new Set(['OPEN', 'CLOSE', 'SET_SL', 'SET_TP']);

export function createChartTradingActions({ trading, executeTrade, reportError }) {
  if (!trading || typeof trading !== 'object') throw new TypeError('createChartTradingActions requires trading presentation');
  if (typeof executeTrade !== 'function') throw new TypeError('createChartTradingActions requires executeTrade');
  if (typeof reportError !== 'function') throw new TypeError('createChartTradingActions requires reportError');

  return Object.freeze({
    resolveClick(price) {
      const snapshot = trading.snapshot?.() || {};
      return resolveClickIntent(price, snapshot.positions?.[0] || null);
    },
    async execute(intent) {
      if (!intent) return { success: false, code: 'NO_ACTION', message: 'No chart action' };
      if (!KNOWN_ACTIONS.has(intent.action)) return { success: false, code: 'UNSUPPORTED_ACTION', message: `Unsupported chart trading action: ${intent.action}` };
      try {
        const result = await executeTrade(intent);
        if (!result || typeof result !== 'object') return { success: false, code: 'INVALID_ACTION_RESULT', message: 'Chart trading action returned an invalid result' };
        return result;
      } catch (error) {
        reportError(error?.message || String(error));
        return { success: false, code: error?.code || 'CHART_TRADING_FAILED', message: error?.message || 'Chart trading action failed', error };
      }
    },
    reportError,
  });
}
