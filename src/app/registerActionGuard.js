export function registerActionGuard(engine, canTrade, reportError) {
  if (!engine || typeof engine.registerActionGuard !== 'function') {
    throw new TypeError('registerActionGuard requires an engine with registerActionGuard()');
  }
  if (typeof canTrade !== 'function') throw new TypeError('registerActionGuard requires canTrade()');
  if (typeof reportError !== 'function') throw new TypeError('registerActionGuard requires reportError()');

  return engine.registerActionGuard((action) => {
    if (!canTrade()) return { allowed: true };
    const msg = action === 'load'
      ? 'Cannot load new data while a position is open — close position or reset account first.'
      : `Cannot ${action} while a position is open — close position first.`;
    reportError(msg);
    return { allowed: false, reason: msg };
  });
}
