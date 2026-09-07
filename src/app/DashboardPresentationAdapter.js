import { assertDashboardSnapshot } from '../ports/DashboardPresentationPort.js';

function freezeValue(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
  const copy = {};
  for (const [key, child] of Object.entries(value)) copy[key] = freezeValue(child);
  return Object.freeze(copy);
}

/**
 * Application-owned adapter that projects the trading engine into an
 * immutable dashboard snapshot. Pages receive this view instead of the
 * engine itself.
 */
export function createDashboardPresentation(tradingEngine) {
  if (!tradingEngine || typeof tradingEngine !== 'object') {
    throw new TypeError('createDashboardPresentation requires a trading engine');
  }
  const snapshot = () => {
    let stats = {};
    let recentTrades = [];
    let equityCurve = [];
    try {
      if (typeof tradingEngine.getStatistics === 'function') {
        stats = tradingEngine.getStatistics() ?? {};
      } else if (typeof tradingEngine.getPerformanceStats === 'function') {
        stats = tradingEngine.getPerformanceStats() ?? {};
      }
      if (typeof tradingEngine.getTradeHistory === 'function') {
        recentTrades = tradingEngine.getTradeHistory() ?? [];
      } else if (typeof tradingEngine.getTrades === 'function') {
        recentTrades = tradingEngine.getTrades() ?? [];
      }
      if (typeof tradingEngine.getEquityHistory === 'function') {
        equityCurve = tradingEngine.getEquityHistory() ?? [];
      }
    } catch {
      // Snapshot must never throw; pages render the last-known state.
    }
    return assertDashboardSnapshot(freezeValue({ stats, recentTrades, equityCurve }));
  };
  return Object.freeze({ snapshot });
}
