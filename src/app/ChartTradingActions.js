function resolveClickIntent(price, activePosition) {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!activePosition) return { type: 'OPEN', price };
  const entry = activePosition.entryPrice ?? activePosition.entry_price;
  const side = String(activePosition.side || '').toUpperCase();
  if (!Number.isFinite(entry)) return { type: 'CLOSE', price };
  if (side === 'LONG' || side === 'BUY') return price < entry ? { type: 'STOP_LOSS', price } : { type: 'TAKE_PROFIT', price };
  return price > entry ? { type: 'STOP_LOSS', price } : { type: 'TAKE_PROFIT', price };
}

export function createChartTradingActions({ trading, executeTrade, reportError }) {
  if (!trading || typeof trading !== 'object') throw new TypeError('createChartTradingActions requires trading presentation');
  if (typeof executeTrade !== 'function') throw new TypeError('createChartTradingActions requires executeTrade');
  if (typeof reportError !== 'function') throw new TypeError('createChartTradingActions requires reportError');

  return Object.freeze({
    resolveClick(price) {
      if (!Number.isFinite(price) || price <= 0) return null;
      const snapshot = trading.snapshot?.() || {};
      return resolveClickIntent(price, snapshot.positions?.[0] || null);
    },
    execute(intent) {
      if (!intent) return { success: false };
      return executeTrade(intent);
    },
    reportError,
  });
}
