/**
 * Neutral presentation contract for the dashboard page.
 *
 * The dashboard renders from an immutable snapshot produced by the
 * application layer — never from a trading engine or domain service:
 *
 *   dashboard = {
 *     snapshot(): frozen {
 *       stats: { equity, returnPct/netReturn, totalTrades, wins/winningTrades,
 *                losses/losingTrades, winRate, netPnl, ... },
 *       recentTrades: [...],
 *       equityCurve: [...]
 *     }
 *   }
 */

export function assertDashboardView(dashboard) {
  if (!dashboard || typeof dashboard !== 'object') {
    throw new TypeError('dashboard view requires an object');
  }
  if (typeof dashboard.snapshot !== 'function') {
    throw new TypeError('dashboard view requires snapshot()');
  }
  return dashboard;
}

export function assertDashboardSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new TypeError('dashboard snapshot must be an object');
  }
  for (const key of ['stats', 'recentTrades', 'equityCurve']) {
    if (!(key in snapshot)) {
      throw new TypeError(`dashboard snapshot is missing key: ${key}`);
    }
  }
  if (!Object.isFrozen(snapshot)) {
    throw new TypeError('dashboard snapshot must be frozen (immutable view model)');
  }
  return snapshot;
}
