/**
 * CandleStore — single source of truth for historical candles.
 * Holds canonical sorted validated array, provides windowed access.
 * Does NOT allow future leak by itself; caller must request window.
 */
export class CandleStore {
  constructor() {
    this._candles = [];
    this._byTime = new Map();
    this._metadata = null;
    this._symbol = null;
    this._timeframe = null;
  }

  /**
   * Load canonical candles (already validated, sorted, deduped).
   * Stores deep clones to prevent external mutation.
   * @param {Array} candles - canonical
   * @param {object} meta - metadata from integrity + request info
   */
  load(candles, meta = {}) {
    if (!Array.isArray(candles) || candles.length === 0) throw new Error('CandleStore.load: non-empty array required');
    this._candles = candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
    this._byTime.clear();
    this._candles.forEach((c, i) => this._byTime.set(c.time, i));
    this._metadata = { ...meta, count: this._candles.length };
    this._symbol = meta.symbol ?? null;
    this._timeframe = meta.timeframe ?? null;
  }

  clear() {
    this._candles = [];
    this._byTime.clear();
    this._metadata = null;
    this._symbol = null;
    this._timeframe = null;
  }

  getCount() { return this._candles.length; }

  get(index) {
    const c = this._candles[index];
    return c ? { ...c } : null;
  }

  getAll() { return this._candles.map(c => ({ ...c })); }

  sliceWindow(startIdx, endIdx) {
    // inclusive endIdx
    const s = Math.max(0, startIdx);
    const e = Math.min(this._candles.length - 1, endIdx);
    if (s > e) return [];
    return this._candles.slice(s, e + 1).map(c => ({ ...c }));
  }

  sliceFromStart(count) {
    return this.sliceWindow(0, count - 1);
  }

  /**
   * Exact index lookup by candle timestamp.
   * Returns index in O(1) or -1 if no candle exists at exact timestamp.
   * @param {number} targetSec
   * @returns {number}
   */
  findExactIndexByTime(targetSec) {
    return this._byTime.has(targetSec) ? this._byTime.get(targetSec) : -1;
  }

  /**
   * Binary search for nearest candle timestamp.
   * Intended for UI navigation / timeline scrubbing.
   * @param {number} targetSec
   * @returns {number}
   */
  findNearestIndexByTime(targetSec) {
    if (!this._candles.length) return -1;
    let lo = 0, hi = this._candles.length - 1, best = 0, minDiff = Infinity;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const diff = Math.abs(this._candles[mid].time - targetSec);
      if (diff < minDiff) { minDiff = diff; best = mid; }
      if (this._candles[mid].time === targetSec) return mid;
      if (this._candles[mid].time < targetSec) lo = mid + 1;
      else hi = mid - 1;
    }
    if (best > 0 && Math.abs(this._candles[best - 1].time - targetSec) < minDiff) best--;
    if (best < this._candles.length - 1 && Math.abs(this._candles[best + 1].time - targetSec) < Math.abs(this._candles[best].time - targetSec)) best++;
    return best;
  }

  /**
   * Find index of first candle with time >= targetSec.
   * @param {number} targetSec
   * @returns {number} Index or -1 if no candle is at or after targetSec
   */
  findAtOrAfterIndex(targetSec) {
    if (!this._candles.length) return -1;
    let lo = 0, hi = this._candles.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this._candles[mid].time >= targetSec) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return ans;
  }

  /**
   * Find index of last candle with time <= targetSec.
   * @param {number} targetSec
   * @returns {number} Index or -1 if no candle is at or before targetSec
   */
  findAtOrBeforeIndex(targetSec) {
    if (!this._candles.length) return -1;
    let lo = 0, hi = this._candles.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this._candles[mid].time <= targetSec) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  /**
   * Backward-compatible alias for findNearestIndexByTime.
   */
  findIndexByTime(targetSec) {
    return this.findNearestIndexByTime(targetSec);
  }

  getRange(from, to) {
    const s = this.findNearestIndexByTime(from);
    const e = this.findNearestIndexByTime(to);
    if (s === -1 || e === -1) return [];
    return this.sliceWindow(Math.min(s, e), Math.max(s, e));
  }

  getMetadata() {
    return this._metadata ? { ...this._metadata } : null;
  }

  getSymbol() { return this._symbol; }
  getTimeframe() { return this._timeframe; }
}
