/**
 * CandleCache — memory LRU + optional IndexedDB persistent.
 * Interval-aware: merges overlapping ranges.
 */
const CACHE_VERSION = 1;

export class CandleCache {
  constructor({ maxMemory = 20, dbName = 'delta-replay-cache', enableIDB = true } = {}) {
    this.maxMemory = maxMemory;
    this._memory = new Map(); // key -> { candles: [], intervals: [{from,to}], ts }
    this.dbName = dbName;
    this.enableIDB = enableIDB && typeof indexedDB !== 'undefined';
    this._db = null;
    this._version = CACHE_VERSION;
  }

  _key(symbol, timeframe) { return `${symbol}|${timeframe}`; }

  _lruTouch(key, entry) {
    if (this._memory.has(key)) this._memory.delete(key);
    this._memory.set(key, entry);
    if (this._memory.size > this.maxMemory) {
      const first = this._memory.keys().next().value;
      this._memory.delete(first);
    }
  }

  // Compute missing intervals: requested [from,to] minus cached intervals
  _computeMissing(requestedFrom, requestedTo, cachedIntervals) {
    if (!cachedIntervals || cachedIntervals.length === 0) return [{ from: requestedFrom, to: requestedTo }];
    const sorted = [...cachedIntervals].sort((a, b) => a.from - b.from);
    const missing = [];
    let cur = requestedFrom;
    for (const iv of sorted) {
      if (iv.to < cur || iv.from > requestedTo) continue;
      if (iv.from > cur) {
        missing.push({ from: cur, to: Math.min(iv.from - 1, requestedTo) });
      }
      cur = Math.max(cur, iv.to + 1);
      if (cur > requestedTo) break;
    }
    if (cur <= requestedTo) missing.push({ from: cur, to: requestedTo });
    // Filter zero-length
    return missing.filter(m => m.from <= m.to);
  }

  /**
   * Try to get cached candles for range. Returns { hit: boolean, candles: [], missing: [] }
   * hit true if fully covered.
   */
  get(symbol, timeframe, from, to) {
    const key = this._key(symbol, timeframe);
    const entry = this._memory.get(key);
    if (!entry) return { hit: false, candles: [], missing: [{ from, to }], intervals: [] };
    const missing = this._computeMissing(from, to, entry.intervals);
    if (missing.length === 0) {
      // fully cached: slice candles in range
      const sliced = entry.candles.filter(c => c.time >= from && c.time <= to);
      // LRU touch
      this._lruTouch(key, entry);
      return { hit: true, candles: sliced.map(c => ({ ...c })), missing: [], intervals: entry.intervals };
    }
    // partial: return intersecting cached part
    const cachedSlice = entry.candles.filter(c => c.time >= from && c.time <= to);
    return { hit: false, candles: cachedSlice.map(c => ({ ...c })), missing, intervals: entry.intervals };
  }

  /**
   * Merge new candles into cache, merge intervals.
   */
  set(symbol, timeframe, from, to, candles) {
    const key = this._key(symbol, timeframe);
    let entry = this._memory.get(key);
    if (!entry) {
      entry = { candles: [], intervals: [], ts: Date.now() };
    }
    // Merge candles: dedup by time, sort
    const map = new Map();
    for (const c of entry.candles) map.set(c.time, c);
    for (const c of candles) map.set(c.time, { ...c });
    const merged = Array.from(map.values()).sort((a, b) => a.time - b.time);
    entry.candles = merged;
    // Merge intervals
    entry.intervals = this._mergeIntervals([...entry.intervals, { from, to }]);
    entry.ts = Date.now();
    this._lruTouch(key, entry);
    // Fire-and-forget IDB persist
    if (this.enableIDB) this._persistIDB(key, entry).catch(() => {});
    return entry;
  }

  _mergeIntervals(intervals) {
    if (!intervals.length) return [];
    const sorted = [...intervals].sort((a, b) => a.from - b.from);
    const merged = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      const cur = sorted[i];
      if (cur.from <= last.to + 1) {
        last.to = Math.max(last.to, cur.to);
      } else {
        merged.push({ ...cur });
      }
    }
    return merged;
  }

  clear() {
    this._memory.clear();
    if (this.enableIDB && this._db) {
      // clear IDB store
      try {
        const tx = this._db.transaction('candles', 'readwrite');
        tx.objectStore('candles').clear();
      } catch {}
    }
  }

  // IDB helpers (best-effort)
  async _openIDB() {
    if (!this.enableIDB) return null;
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this._version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('candles')) db.createObjectStore('candles');
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  }

  async _persistIDB(key, entry) {
    try {
      const db = await this._openIDB();
      if (!db) return;
      const tx = db.transaction('candles', 'readwrite');
      tx.objectStore('candles').put({ key, candles: entry.candles, intervals: entry.intervals, ts: entry.ts }, key);
    } catch {}
  }

  async loadFromIDB(symbol, timeframe) {
    if (!this.enableIDB) return null;
    try {
      const db = await this._openIDB();
      const tx = db.transaction('candles', 'readonly');
      const req = tx.objectStore('candles').get(this._key(symbol, timeframe));
      return new Promise((resolve) => {
        req.onsuccess = () => {
          const val = req.result;
          if (val) {
            this._memory.set(this._key(symbol, timeframe), { candles: val.candles, intervals: val.intervals, ts: val.ts });
            resolve(val);
          } else resolve(null);
        };
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }

  size() { return this._memory.size; }
}
