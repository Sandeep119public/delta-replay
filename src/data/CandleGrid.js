/**
 * CandleGrid — Discrete lattice and candle-grid utilities.
 *
 * Ensures all historical data ranges, chunk boundaries, and cache coverage
 * operate in discrete candle-grid space (origin + k * tfSec), not arbitrary Unix seconds.
 */

export const TIMEFRAME_SECONDS = Object.freeze({
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '6h': 21600,
  '1d': 86400,
  '1w': 604800,
});

/**
 * Align arbitrary timestamp to timeframe grid.
 * @param {number} timestamp - Unix seconds
 * @param {number} tfSec - Timeframe in seconds
 * @param {'floor'|'ceil'|'round'} [mode='floor']
 * @param {number} [origin=0] - Grid origin / anchor
 * @returns {number}
 */
export function alignToGrid(timestamp, tfSec, mode = 'floor', origin = 0) {
  if (!Number.isFinite(timestamp) || !Number.isFinite(tfSec) || tfSec <= 0) return timestamp;
  const rel = timestamp - origin;
  if (mode === 'ceil') return origin + Math.ceil(rel / tfSec) * tfSec;
  if (mode === 'round') return origin + Math.round(rel / tfSec) * tfSec;
  return origin + Math.floor(rel / tfSec) * tfSec;
}

/**
 * Normalize requested user range into discrete candle lattice boundaries.
 * Invariant: effectiveFrom >= requestedFrom AND effectiveTo <= requestedTo.
 * If no complete candle exists in [from, to], hasCandle is false.
 *
 * @param {number} from - Requested start unix seconds
 * @param {number} to - Requested end unix seconds
 * @param {number} tfSec - Timeframe in seconds
 * @param {number} [origin=0] - Grid origin / anchor
 * @returns {{ requestedFrom: number, requestedTo: number, effectiveFrom: number, effectiveTo: number, hasCandle: boolean }}
 */
export function normalizeRange(from, to, tfSec, origin = 0) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(tfSec) || tfSec <= 0) {
    throw new Error('from, to, and tfSec must be valid numbers');
  }
  if (from >= to) {
    throw new Error('from must be < to');
  }

  const effectiveFrom = origin + Math.ceil((from - origin) / tfSec) * tfSec;
  const effectiveTo = origin + Math.floor((to - origin) / tfSec) * tfSec;
  const hasCandle = effectiveFrom <= effectiveTo;

  return {
    requestedFrom: from,
    requestedTo: to,
    effectiveFrom,
    effectiveTo,
    hasCandle,
  };
}

/**
 * Returns expected candle timestamps on discrete lattice.
 * @param {number} from - Aligned start unix seconds
 * @param {number} to - Aligned end unix seconds
 * @param {number} tfSec - Timeframe seconds
 * @returns {number[]}
 */
export function getExpectedGridTimestamps(from, to, tfSec) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(tfSec) || tfSec <= 0 || from > to) {
    return [];
  }
  const timestamps = [];
  for (let t = from; t <= to; t += tfSec) {
    timestamps.push(t);
  }
  return timestamps;
}

/**
 * Merge candle intervals that are contiguous or overlapping on the candle grid.
 * Two intervals [a, b] and [c, d] are contiguous on the grid if c <= b + tfSec.
 * @param {Array<{from: number, to: number}>} intervals
 * @param {number} tfSec
 * @returns {Array<{from: number, to: number}>}
 */
export function mergeGridIntervals(intervals, tfSec = 1) {
  if (!Array.isArray(intervals) || intervals.length === 0) return [];
  const step = Number.isFinite(tfSec) && tfSec > 0 ? tfSec : 1;
  const clean = intervals
    .filter(iv => iv && Number.isFinite(iv.from) && Number.isFinite(iv.to) && iv.from <= iv.to)
    .map(iv => ({ from: Math.floor(iv.from), to: Math.floor(iv.to) }))
    .sort((a, b) => a.from - b.from);

  if (clean.length === 0) return [];

  const merged = [{ ...clean[0] }];
  for (let i = 1; i < clean.length; i++) {
    const cur = clean[i];
    const last = merged[merged.length - 1];
    if (cur.from <= last.to + step) {
      last.to = Math.max(last.to, cur.to);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/**
 * Compute missing intervals on the discrete candle grid.
 * @param {number} requestedFrom - Start timestamp (candle aligned)
 * @param {number} requestedTo - End timestamp (candle aligned)
 * @param {Array<{from: number, to: number}>} cachedIntervals
 * @param {number} tfSec - Timeframe in seconds
 * @returns {Array<{from: number, to: number}>}
 */
export function computeGridMissing(requestedFrom, requestedTo, cachedIntervals = [], tfSec = 60) {
  const step = Number.isFinite(tfSec) && tfSec > 0 ? tfSec : 1;
  const start = Math.floor(requestedFrom);
  const end = Math.floor(requestedTo);
  if (start > end) return [];
  if (!cachedIntervals || cachedIntervals.length === 0) {
    return [{ from: start, to: end }];
  }

  const sorted = mergeGridIntervals(cachedIntervals, step).filter(iv => iv.to >= start && iv.from <= end);
  const missing = [];
  let cursor = start;

  for (const iv of sorted) {
    if (iv.from > cursor) {
      missing.push({ from: cursor, to: Math.min(end, iv.from - step) });
    }
    cursor = Math.max(cursor, iv.to + step);
    if (cursor > end) break;
  }

  if (cursor <= end) {
    missing.push({ from: cursor, to: end });
  }

  return missing.filter(iv => iv.from <= iv.to);
}

/**
 * Derive contiguous coverage intervals directly from actual candle timestamps.
 * Invariant: Every interval represents a verified run where count === ((to - from) / tfSec) + 1.
 * @param {Array<{time: number}>} candles
 * @param {number} tfSec
 * @returns {Array<{from: number, to: number, count: number}>}
 */
export function intervalsFromCandles(candles, tfSec) {
  if (!Array.isArray(candles) || !candles.length || !Number.isFinite(tfSec) || tfSec <= 0) return [];
  const sorted = candles
    .filter(c => c && Number.isFinite(c.time))
    .slice()
    .sort((a, b) => a.time - b.time);
  if (!sorted.length) return [];

  const intervals = [];
  let start = sorted[0].time;
  let previous = sorted[0].time;
  let count = 1;

  const pushInterval = (s, p, cnt) => {
    const item = { from: s, to: p };
    Object.defineProperty(item, 'count', {
      value: cnt,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    intervals.push(item);
  };

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i].time;
    if (current === previous) {
      continue;
    }
    if (current !== previous + tfSec) {
      pushInterval(start, previous, count);
      start = current;
      count = 1;
    } else {
      count++;
    }
    previous = current;
  }
  pushInterval(start, previous, count);
  return intervals;
}
