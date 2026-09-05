import { TIMEFRAME_SECONDS } from '../data/CandleGrid.js';
import { toUnixSeconds } from './time.js';

export const PRESET_CONFIG = Object.freeze({
  '1d': { daysBack: 1, adjustTimeframe: (tf) => (tf === '1m' ? '5m' : tf) },
  '3d': { daysBack: 3, adjustTimeframe: (tf) => (['1m', '3m'].includes(tf) ? '15m' : tf) },
  '7d': { daysBack: 7, adjustTimeframe: (tf) => (['1m', '3m', '5m'].includes(tf) ? '1h' : tf) },
  '30d': { daysBack: 30, adjustTimeframe: (tf) => (['1m', '3m', '5m', '15m'].includes(tf) ? '1h' : tf) },
  'now': { hoursBack: 6, adjustTimeframe: (tf) => tf },
});

/**
 * Calculate automated historical load window surrounding target replay timestamp.
 * Provides historical context candles before target and future candles for replay progression.
 *
 * @param {number} targetSec - Unix seconds for replay start point
 * @param {string} [timeframe='1m']
 * @param {number} [nowSec=null] - Optional override for testing
 * @returns {{ from: number, to: number }}
 */
export function calculateAutoRange(targetSec, timeframe = '1m', nowSec = null) {
  const tfSec = TIMEFRAME_SECONDS[timeframe] || 60;
  const currentNow = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);

  const contextCandles = 350;
  const futureCandles = 1200;

  let from = Math.floor(targetSec - contextCandles * tfSec);
  let to = Math.min(currentNow, Math.floor(targetSec + futureCandles * tfSec));

  // If target is near now, adjust window backwards so there are enough candles
  if (to - from < 500 * tfSec) {
    from = Math.max(0, to - 1500 * tfSec);
  }

  return { from, to };
}

/**
 * Safely parse date and time strings to unix seconds with fallbacks.
 *
 * @param {string} [dateVal]
 * @param {string} [timeVal]
 * @param {string} [fallbackDateVal]
 * @param {string} [fallbackTimeVal]
 * @returns {number}
 */
export function resolveReplayTargetUnixSeconds(dateVal, timeVal, fallbackDateVal, fallbackTimeVal) {
  if (dateVal) {
    try {
      return toUnixSeconds(dateVal, timeVal || '00:00');
    } catch {}
  }
  if (fallbackDateVal) {
    try {
      return toUnixSeconds(fallbackDateVal, fallbackTimeVal || '00:00');
    } catch {}
  }
  return Math.floor(Date.now() / 1000) - 86400;
}

/**
 * Fast binary search / index lookup for target timestamp against store or candles array.
 *
 * @param {number} targetSec
 * @param {import('../data/CandleStore.js').CandleStore} [candleStore]
 * @param {Array} [candlesFallback=[]]
 * @returns {number}
 */
export function findClosestCandleIndex(targetSec, candleStore = null, candlesFallback = []) {
  if (candleStore && typeof candleStore.getCount === 'function' && candleStore.getCount() > 0) {
    return candleStore.findIndexByTime(targetSec);
  }

  const candles = Array.isArray(candlesFallback) ? candlesFallback : [];
  if (!candles.length) return -1;

  let lo = 0;
  let hi = candles.length - 1;
  let best = 0;
  let minDiff = Infinity;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const diff = Math.abs(candles[mid].time - targetSec);
    if (diff < minDiff) {
      minDiff = diff;
      best = mid;
    }
    if (candles[mid].time === targetSec) return mid;
    if (candles[mid].time < targetSec) lo = mid + 1;
    else hi = mid - 1;
  }

  if (best > 0 && Math.abs(candles[best - 1].time - targetSec) < minDiff) best--;
  if (best < candles.length - 1 && Math.abs(candles[best + 1].time - targetSec) < Math.abs(candles[best].time - targetSec)) best++;
  return best;
}

/**
 * Resolve target timestamp and timeframe for a preset key.
 *
 * @param {string} presetKey - '1d' | '3d' | '7d' | '30d' | 'now'
 * @param {string} currentTimeframe
 * @param {number} [nowSec=null]
 * @returns {{ targetSec: number, recommendedTimeframe: string }}
 */
export function resolvePresetTarget(presetKey, currentTimeframe, nowSec = null) {
  const currentNow = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  const cfg = PRESET_CONFIG[presetKey] || PRESET_CONFIG['1d'];

  let targetSec;
  if (cfg.daysBack != null) {
    targetSec = currentNow - cfg.daysBack * 86400;
  } else if (cfg.hoursBack != null) {
    targetSec = currentNow - cfg.hoursBack * 3600;
  } else {
    targetSec = currentNow - 86400;
  }

  const recommendedTimeframe = cfg.adjustTimeframe(currentTimeframe);
  return { targetSec, recommendedTimeframe };
}
