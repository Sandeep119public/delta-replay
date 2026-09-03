/**
 * CandleCache - memory LRU + optional IndexedDB persistence.
 *
 * Intervals are an explicit cache-coverage contract. When callers provide
 * intervals they are authoritative; otherwise set() records the requested
 * range for backward compatibility. HistoricalDataManager revalidates cache
 * contents with CandleIntegrity before trusting a hit.
 */
export const CACHE_VERSION = 3;

const TIMEFRAME_SECONDS = Object.freeze({
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600,
  '1d': 86400, '1w': 604800,
});

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

  _key(symbol, timeframe) { return `${symbol}|${timeframe}`; }

  _getTimeframeSeconds(timeframe, explicit = null, entry = null) {
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    if (Number.isFinite(entry?.timeframeSec) && entry.timeframeSec > 0) return entry.timeframeSec;
    return TIMEFRAME_SECONDS[timeframe] ?? null;
  }

  _lruTouch(key, entry) {
    this._memory.delete(key);
    this._memory.set(key, entry);
    while (this._memory.size > this.maxMemory) this._memory.delete(this._memory.keys().next().value);
  }

  _computeMissing(requestedFrom, requestedTo, cachedIntervals = []) {
    const start = Math.floor(requestedFrom), end = Math.floor(requestedTo);
    if (start > end) return [];
    if (!cachedIntervals.length) return [{ from: start, to: end }];
    const sorted = this._mergeIntervals(cachedIntervals).filter(iv => iv.to >= start && iv.from <= end);
    const missing = [];
    let cursor = start;
    for (const iv of sorted) {
      if (iv.from > cursor) missing.push({ from: cursor, to: Math.min(end, iv.from - 1) });
      cursor = Math.max(cursor, iv.to + 1);
      if (cursor > end) break;
    }
    if (cursor <= end) missing.push({ from: cursor, to: end });
    return missing.filter(iv => iv.from <= iv.to);
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
    entry.timeframeSec = this._getTimeframeSeconds(timeframe, timeframeSec, entry);
    const missing = this._computeMissing(from, to, entry.intervals);
    const candles = entry.candles.filter(c => c.time >= from && c.time <= to).map(c => ({ ...c }));
    this._lruTouch(key, entry);
    return { hit: missing.length === 0, candles, missing, intervals: entry.intervals.map(iv => ({ ...iv })) };
  }

  invalidate(symbol, timeframe) {
    const key = this._key(symbol, timeframe);
    this._memory.delete(key);
    if (this.enableIDB) this._deleteIDBEntry(key).catch(() => {});
  }

  replace(symbol, timeframe, candles = [], { timeframeSec = null, intervals = null } = {}) {
    const tf = this._getTimeframeSeconds(timeframe, timeframeSec);
    const canonical = (Array.isArray(candles) ? candles : [])
      .filter(c => this._isCanonicalCandle(c)).map(c => ({ ...c })).sort((a, b) => a.time - b.time);
    const entry = {
      candles: canonical,
      intervals: this._mergeIntervals(intervals ?? CandleCache.intervalsFromCandles(canonical, tf)),
      timeframeSec: tf,
      ts: Date.now(),
      version: CACHE_VERSION,
    };
    this._lruTouch(this._key(symbol, timeframe), entry);
    this._persistIDB(this._key(symbol, timeframe), entry).catch(() => {});
    return entry;
  }

  repairIntervals(symbol, timeframe, actualIntervals, { timeframeSec = null } = {}) {
    const key = this._key(symbol, timeframe), entry = this._memory.get(key);
    if (!entry) return;
    entry.intervals = this._mergeIntervals(actualIntervals);
    entry.timeframeSec = this._getTimeframeSeconds(timeframe, timeframeSec, entry);
    entry.ts = Date.now(); entry.version = CACHE_VERSION;
    this._lruTouch(key, entry);
    this._persistIDB(key, entry).catch(() => {});
  }

  set(symbol, timeframe, from, to, candles = [], { intervals = null, timeframeSec = null } = {}) {
    const key = this._key(symbol, timeframe);
    const entry = this._memory.get(key) ?? { candles: [], intervals: [], ts: Date.now(), version: CACHE_VERSION, timeframeSec: null };
    const byTime = new Map();
    for (const c of entry.candles) if (this._isCanonicalCandle(c)) byTime.set(c.time, { ...c });
    for (const c of candles) if (this._isCanonicalCandle(c)) byTime.set(c.time, { ...c });
    entry.candles = [...byTime.values()].sort((a, b) => a.time - b.time);
    entry.timeframeSec = this._getTimeframeSeconds(timeframe, timeframeSec, entry);
    const nextIntervals = intervals ?? [{ from, to }];
    entry.intervals = this._mergeIntervals([...entry.intervals, ...nextIntervals]);
    entry.version = CACHE_VERSION;
    entry.ts = Date.now();
    this._lruTouch(key, entry);
    this._persistIDB(key, entry).catch(() => {});
    return entry;
  }

  static intervalsFromCandles(candles, timeframeSec) {
    if (!Array.isArray(candles) || !candles.length || !Number.isFinite(timeframeSec) || timeframeSec <= 0) return [];
    const sorted = candles.filter(c => c && Number.isFinite(c.time)).slice().sort((a, b) => a.time - b.time);
    if (!sorted.length) return [];
    const intervals = [];
    let start = sorted[0].time, previous = sorted[0].time;
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i].time;
      if (current !== previous + timeframeSec) {
        intervals.push({ from: start, to: previous });
        start = current;
      }
      previous = current;
    }
    intervals.push({ from: start, to: previous });
    return intervals;
  }

  _mergeIntervals(intervals) {
    const clean = intervals.filter(iv => iv && Number.isFinite(iv.from) && Number.isFinite(iv.to) && iv.from <= iv.to)
      .map(iv => ({ from: Math.floor(iv.from), to: Math.floor(iv.to) })).sort((a, b) => a.from - b.from);
    if (!clean.length) return [];
    const merged = [{ ...clean[0] }];
    for (let i = 1; i < clean.length; i++) {
      const cur = clean[i], last = merged[merged.length - 1];
      if (cur.from <= last.to + 1) last.to = Math.max(last.to, cur.to); else merged.push({ ...cur });
    }
    return merged;
  }

  _isCanonicalCandle(c) {
    return Boolean(c) && Number.isFinite(c.time) && c.time > 0
      && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low)
      && Number.isFinite(c.close) && Number.isFinite(c.volume) && c.volume >= 0;
  }

  clear() {
    this._memory.clear();
    if (this.enableIDB && this._db) {
      try { this._db.transaction('candles', 'readwrite').objectStore('candles').clear(); } catch {}
    }
  }

  async _openIDB() {
    if (!this.enableIDB) return null;
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this._version);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('candles')) db.createObjectStore('candles');
        else { try { request.transaction.objectStore('candles').clear(); } catch {} }
      };
      request.onsuccess = () => { this._db = request.result; resolve(this._db); };
      request.onerror = () => reject(request.error);
    });
  }

  async _persistIDB(key, entry) {
    try {
      const db = await this._openIDB(); if (!db) return;
      db.transaction('candles', 'readwrite').objectStore('candles').put({ key, candles: entry.candles, intervals: entry.intervals, timeframeSec: entry.timeframeSec, ts: entry.ts, version: CACHE_VERSION }, key);
    } catch {}
  }

  async _deleteIDBEntry(key) {
    try {
      const db = await this._openIDB(); if (!db) return;
      db.transaction('candles', 'readwrite').objectStore('candles').delete(key);
    } catch {}
  }

  async loadFromIDB(symbol, timeframe) {
    if (!this.enableIDB) return null;
    const key = this._key(symbol, timeframe);
    try {
      const db = await this._openIDB();
      const request = db.transaction('candles', 'readonly').objectStore('candles').get(key);
      return await new Promise(resolve => {
        request.onsuccess = () => {
          const value = request.result;
          if (!value || value.version !== CACHE_VERSION || !Array.isArray(value.candles) || !Array.isArray(value.intervals)) {
            if (value) this._deleteIDBEntry(key).catch(() => {});
            resolve(null); return;
          }
          const candles = value.candles.filter(c => this._isCanonicalCandle(c)).map(c => ({ ...c }));
          const tf = this._getTimeframeSeconds(timeframe, value.timeframeSec, value);
          const entry = { candles, intervals: this._mergeIntervals(value.intervals), timeframeSec: tf, ts: value.ts, version: value.version };
          this._lruTouch(key, entry); resolve(entry);
        };
        request.onerror = () => resolve(null);
      });
    } catch { return null; }
  }

  size() { return this._memory.size; }
}
