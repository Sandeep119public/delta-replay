/**
 * CandleCache - memory LRU + optional IndexedDB persistence.
 *
 * Coverage operates strictly in discrete candle-grid space (k * tfSec).
 * Actual candle timestamps are the authority; intervals represent discrete contiguous runs.
 */
import {
  TIMEFRAME_SECONDS,
  mergeGridIntervals,
  computeGridMissing,
  intervalsFromCandles,
} from './CandleGrid.js';

export const CACHE_VERSION = 2;

export class CandleCache {
  constructor({ maxMemory = 20, dbName = 'delta-replay-cache', enableIDB = true } = {}) {
    if (!Number.isInteger(maxMemory) || maxMemory < 1) throw new Error('maxMemory must be a positive integer');
    this.maxMemory = maxMemory;
    this._memory = new Map();
    this.dbName = dbName;
    this.enableIDB = Boolean(enableIDB && typeof indexedDB !== 'undefined');
    this._db = null;
    this._version = CACHE_VERSION;
  }

  _key(symbol, timeframe) {
    return `${symbol}|${timeframe}`;
  }

  _getTimeframeSeconds(timeframe, explicit = null, entry = null) {
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    if (Number.isFinite(entry?.timeframeSec) && entry.timeframeSec > 0) return entry.timeframeSec;
    return TIMEFRAME_SECONDS[timeframe] ?? null;
  }

  _lruTouch(key, entry) {
    this._memory.delete(key);
    this._memory.set(key, entry);
    while (this._memory.size > this.maxMemory) {
      this._memory.delete(this._memory.keys().next().value);
    }
  }

  _computeMissing(requestedFrom, requestedTo, cachedIntervals = [], timeframeSec = null) {
    const tf = Number.isFinite(timeframeSec) && timeframeSec > 0 ? timeframeSec : 1;
    return computeGridMissing(requestedFrom, requestedTo, cachedIntervals, tf);
  }

  get(symbol, timeframe, from, to, { timeframeSec = null } = {}) {
    const key = this._key(symbol, timeframe);
    const entry = this._memory.get(key);
    if (!entry || entry.version !== CACHE_VERSION) {
      if (entry) this._memory.delete(key);
      return { hit: false, candles: [], missing: [{ from, to }], intervals: [] };
    }
    if (!Array.isArray(entry.candles) || !Array.isArray(entry.intervals)) {
      this.invalidate(symbol, timeframe);
      return { hit: false, candles: [], missing: [{ from, to }], intervals: [] };
    }

    const canonical = entry.candles.filter(c => this._isCanonicalCandle(c));
    if (canonical.length !== entry.candles.length) entry.candles = canonical;

    const tf = this._getTimeframeSeconds(timeframe, timeframeSec, entry);
    entry.timeframeSec = tf;

    const missing = this._computeMissing(from, to, entry.intervals, tf);
    const candles = entry.candles.filter(c => c.time >= from && c.time <= to).map(c => ({ ...c }));
    this._lruTouch(key, entry);

    return {
      hit: missing.length === 0,
      candles,
      missing,
      intervals: entry.intervals.map(iv => ({ ...iv })),
    };
  }

  invalidate(symbol, timeframe) {
    const key = this._key(symbol, timeframe);
    this._memory.delete(key);
    if (this.enableIDB) this._deleteIDBEntry(key).catch(() => {});
  }

  replace(symbol, timeframe, candles = [], { timeframeSec = null, intervals = null } = {}) {
    const tf = this._getTimeframeSeconds(timeframe, timeframeSec);
    const canonical = (Array.isArray(candles) ? candles : [])
      .filter(c => this._isCanonicalCandle(c))
      .map(c => ({ ...c }))
      .sort((a, b) => a.time - b.time);

    const truthfulIntervals = CandleCache.intervalsFromCandles(canonical, tf);

    const entry = {
      candles: canonical,
      intervals: truthfulIntervals,
      timeframeSec: tf,
      ts: Date.now(),
      version: CACHE_VERSION,
    };
    const key = this._key(symbol, timeframe);
    this._lruTouch(key, entry);
    this._persistIDB(key, entry).catch(() => {});
    return entry;
  }

  repairIntervals(symbol, timeframe, actualIntervals, { timeframeSec = null } = {}) {
    const key = this._key(symbol, timeframe);
    const entry = this._memory.get(key);
    if (!entry) return;
    const tf = this._getTimeframeSeconds(timeframe, timeframeSec, entry);
    entry.intervals = this._mergeIntervals(actualIntervals, tf);
    entry.timeframeSec = tf;
    entry.ts = Date.now();
    entry.version = CACHE_VERSION;
    this._lruTouch(key, entry);
    this._persistIDB(key, entry).catch(() => {});
  }

  set(symbol, timeframe, from, to, candles = [], { intervals = null, timeframeSec = null, allowUnverifiedIntervals = false } = {}) {
    const key = this._key(symbol, timeframe);
    const entry = this._memory.get(key) ?? {
      candles: [],
      intervals: [],
      ts: Date.now(),
      version: CACHE_VERSION,
      timeframeSec: null,
    };

    const byTime = new Map();
    for (const c of entry.candles) if (this._isCanonicalCandle(c)) byTime.set(c.time, { ...c });
    for (const c of candles) if (this._isCanonicalCandle(c)) byTime.set(c.time, { ...c });

    entry.candles = [...byTime.values()].sort((a, b) => a.time - b.time);
    const tf = this._getTimeframeSeconds(timeframe, timeframeSec, entry);
    entry.timeframeSec = tf;

    entry.intervals = (allowUnverifiedIntervals && intervals)
      ? intervals
      : CandleCache.intervalsFromCandles(entry.candles, tf);
    entry.version = CACHE_VERSION;
    entry.ts = Date.now();

    this._lruTouch(key, entry);
    this._persistIDB(key, entry).catch(() => {});
    return entry;
  }

  static intervalsFromCandles(candles, timeframeSec) {
    return intervalsFromCandles(candles, timeframeSec);
  }

  _mergeIntervals(intervals, timeframeSec = 1) {
    return mergeGridIntervals(intervals, timeframeSec);
  }

  _isCanonicalCandle(c) {
    return (
      Boolean(c) &&
      Number.isFinite(c.time) &&
      c.time > 0 &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close) &&
      Number.isFinite(c.volume) &&
      c.volume >= 0
    );
  }

  clear() {
    this._memory.clear();
    if (this.enableIDB && this._db) {
      try {
        this._db.transaction('candles', 'readwrite').objectStore('candles').clear();
      } catch {}
    }
  }

  async _openIDB() {
    if (!this.enableIDB) return null;
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this._version);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('candles')) {
          db.createObjectStore('candles');
        } else {
          try {
            request.transaction.objectStore('candles').clear();
          } catch {}
        }
      };
      request.onsuccess = () => {
        this._db = request.result;
        resolve(this._db);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async _persistIDB(key, entry) {
    try {
      const db = await this._openIDB();
      if (!db) return;
      db.transaction('candles', 'readwrite').objectStore('candles').put(
        {
          key,
          candles: entry.candles,
          intervals: entry.intervals,
          timeframeSec: entry.timeframeSec,
          ts: entry.ts,
          version: CACHE_VERSION,
        },
        key
      );
    } catch {}
  }

  async _deleteIDBEntry(key) {
    try {
      const db = await this._openIDB();
      if (!db) return;
      db.transaction('candles', 'readwrite').objectStore('candles').delete(key);
    } catch {}
  }

  async loadFromIDB(symbol, timeframe) {
    if (!this.enableIDB) return null;
    const key = this._key(symbol, timeframe);
    try {
      const db = await this._openIDB();
      const request = db.transaction('candles', 'readonly').objectStore('candles').get(key);
      return await new Promise((resolve) => {
        request.onsuccess = () => {
          const value = request.result;
          if (
            !value ||
            value.version !== CACHE_VERSION ||
            !Array.isArray(value.candles) ||
            !Array.isArray(value.intervals)
          ) {
            if (value) this._deleteIDBEntry(key).catch(() => {});
            resolve(null);
            return;
          }
          const candles = value.candles.filter(c => this._isCanonicalCandle(c)).map(c => ({ ...c }));
          const tf = this._getTimeframeSeconds(timeframe, value.timeframeSec, value);
          const entry = {
            candles,
            intervals: this._mergeIntervals(value.intervals, tf),
            timeframeSec: tf,
            ts: value.ts,
            version: value.version,
          };
          this._lruTouch(key, entry);
          resolve(entry);
        };
        request.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  size() {
    return this._memory.size;
  }
}
