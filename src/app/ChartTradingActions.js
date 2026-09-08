function resolveClickIntent(price, activePosition) {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!activePosition) return { action: 'OPEN', price };

  const entry = Number(activePosition.entryPrice ?? activePosition.entry_price);
  const side = String(activePosition.side || '').toUpperCase();
  if (!Number.isFinite(entry)) return { action: 'CLOSE', price };
  if (side === 'LONG' || side === 'BUY') return price < entry ? { action: 'SET_SL', price } : { action: 'SET_TP', price };
  return price > entry ? { action: 'SET_SL', price } : { action: 'SET_TP', price };
}

export function createChartTradingActions({ trading, executeTrade, reportError }) {
  if (!trading || typeof trading !== 'object') throw new TypeError('createChartTradingActions requires trading presentation');
  if (typeof executeTrade !== 'function') throw new TypeError('createChartTradingActions requires executeTrade');
  if (typeof reportError !== 'function') throw new TypeError('createChartTradingActions requires reportError');

  return Object.freeze({
    resolveClick(price) {
      const snapshot = trading.snapshot?.() || {};
      return resolveClickIntent(price, snapshot.positions?.[0] || null);
    },
    execute(intent) {
      if (!intent) return Promise.resolve({ success: false, message: 'No chart action' });
      return executeTrade(intent);
    },
    reportError,
  });
}
