/**
 * CandleCache — memory LRU + optional IndexedDB persistent.
 * Interval-aware: merges overlapping ranges.
 * Versioned: incompatible old records are discarded safely.
 */
export const CACHE_VERSION = 2;

export class CandleCache {
  constructor({ maxMemory = 20, dbName = 'delta-replay-cache', enableIDB = true } = {}) {
    this.maxMemory = maxMemory;
    this._memory = new Map(); // key -> { candles: [], intervals: [{from,to}], ts, version }
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
   * hit true if fully covered. Version mismatched entries are discarded.
   */
  get(symbol, timeframe, from, to) {
    const key = this._key(symbol, timeframe);
    const entry = this._memory.get(key);
    if (!entry) return { hit: false, candles: [], missing: [{ from, to }], intervals: [] };
    // Version check: discard stale version
    if (entry.version != null && entry.version !== CACHE_VERSION) {
      this._memory.delete(key);
      this._deleteIDBEntry(key).catch(() => {});
      return { hit: false, candles: [], missing: [{ from, to }], intervals: [] };
    }
    if (entry.version == null) {
      // Old record without version field -> treat as stale, discard
      this._memory.delete(key);
      this._deleteIDBEntry(key).catch(() => {});
      return { hit: false, candles: [], missing: [{ from, to }], intervals: [] };
    }
    // Validate intervals present, else miss
    if (!Array.isArray(entry.intervals)) {
      return { hit: false, candles: [], missing: [{ from, to }], intervals: [] };
    }
    const missing = this._computeMissing(from, to, entry.intervals);
    if (missing.length === 0) {
      // fully cached according to intervals: but verify candles actually exist for those intervals (defense against corrupted intervals)
      // We still return hit; caller (HistoricalDataManager) will revalidate via CandleIntegrity and repair if false.
      const sliced = entry.candles.filter(c => c.time >= from && c.time <= to);
      this._lruTouch(key, entry);
      return { hit: true, candles: sliced.map(c => ({ ...c })), missing: [], intervals: entry.intervals };
    }
    // partial: return intersecting cached part
    const cachedSlice = entry.candles.filter(c => c.time >= from && c.time <= to);
    return { hit: false, candles: cachedSlice.map(c => ({ ...c })), missing, intervals: entry.intervals };
  }

  /**
   * Repair stored intervals to match actual candles (gap-aware). Used when integrity detects stale false interval.
   */
  repairIntervals(symbol, timeframe, actualIntervals) {
    const key = this._key(symbol, timeframe);
    const entry = this._memory.get(key);
    if (!entry) return;
    entry.intervals = this._mergeIntervals(actualIntervals);
    entry.ts = Date.now();
    entry.version = CACHE_VERSION;
    this._lruTouch(key, entry);
    if (this.enableIDB) this._persistIDB(key, entry).catch(() => {});
  }

  /**
   * Merge new candles into cache, merge intervals.
   * If intervals contains gaps, caller should provide actual covered intervals (not just requested).
   * For backward compat, if candles has gaps, we derive intervals from candles.
   */
  set(symbol, timeframe, from, to, candles, opts = {}) {
    const key = this._key(symbol, timeframe);
    let entry = this._memory.get(key);
    if (!entry) {
      entry = { candles: [], intervals: [], ts: Date.now(), version: CACHE_VERSION };
    }
    // Merge candles: dedup by time, sort, with basic sanitization (drop NaN/Infinity time etc)
    const map = new Map();
    for (const c of entry.candles) {
      if (c && Number.isFinite(c.time) && Number.isFinite(c.open)) map.set(c.time, { ...c });
    }
    for (const c of candles) {
      if (!c || !Number.isFinite(c.time) || !Number.isFinite(c.open) || !Number.isFinite(c.high) || !Number.isFinite(c.low) || !Number.isFinite(c.close)) continue;
      // Also reject NaN/Infinity volume? volume can be 0 but must be finite
      if (!Number.isFinite(c.volume) && c.volume != null) continue;
      // reject mismatched? caller ensures symbol/timeframe consistent
      map.set(c.time, { ...c });
    }
    const merged = Array.from(map.values()).sort((a, b) => a.time - b.time);
    // Further dedup: ensure strictly increasing, keep last for duplicates (already deduped)
    entry.candles = merged;
    entry.version = CACHE_VERSION;
    // Determine intervals to add: if opts.intervals provided, use those (gap-aware), else use requested [from,to]
    const intervalsToAdd = opts.intervals ?? [{ from, to }];
    // Validate intervals: must be finite numbers, from<=to
    const cleanIntervals = intervalsToAdd.filter(iv => iv && Number.isFinite(iv.from) && Number.isFinite(iv.to) && iv.from <= iv.to);
    entry.intervals = this._mergeIntervals([...entry.intervals, ...cleanIntervals]);
    entry.ts = Date.now();
    this._lruTouch(key, entry);
    // Fire-and-forget IDB persist
    if (this.enableIDB) this._persistIDB(key, entry).catch(() => {});
    return entry;
  }

  // Derive continuous intervals from sorted candles given timeframeSec
  static intervalsFromCandles(candles, timeframeSec) {
    if (!candles.length || !timeframeSec) return [];
    const sorted = [...candles].sort((a,b)=>a.time-b.time);
    const intervals = [];
    let start = sorted[0].time;
    let prev = sorted[0].time;
    for (let i=1;i<sorted.length;i++) {
      const expected = prev + timeframeSec;
      if (sorted[i].time !== expected) {
        intervals.push({ from: start, to: prev });
        start = sorted[i].time;
      }
      prev = sorted[i].time;
    }
    intervals.push({ from: start, to: prev });
    return intervals;
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
      req.onupgradeneeded = (event) => {
        const db = req.result;
        if (!db.objectStoreNames.contains('candles')) db.createObjectStore('candles');
        else if (event.oldVersion < CACHE_VERSION) {
          try { const store = event.target.transaction.objectStore('candles'); store.clear(); } catch {}
        }
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
      tx.objectStore('candles').put({ key, candles: entry.candles, intervals: entry.intervals, ts: entry.ts, version: CACHE_VERSION }, key);
    } catch {}
  }

  async _deleteIDBEntry(key) {
    try {
      const db = await this._openIDB();
      if (!db) return;
      const tx = db.transaction('candles', 'readwrite');
      tx.objectStore('candles').delete(key);
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
            // Version check: discard incompatible
            if (val.version == null || val.version !== CACHE_VERSION) {
              // remove stale
              this._deleteIDBEntry(this._key(symbol, timeframe)).catch(()=>{});
              resolve(null);
              return;
            }
            // Basic corruption check: must be array of candles with finite time
            if (!Array.isArray(val.candles) || !Array.isArray(val.intervals)) {
              this._deleteIDBEntry(this._key(symbol, timeframe)).catch(()=>{});
              resolve(null);
              return;
            }
            // Filter obviously corrupt candles (NaN/Infinity time)
            const filtered = val.candles.filter(c => c && Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
            if (filtered.length === 0 && val.candles.length > 0) {
              this._deleteIDBEntry(this._key(symbol, timeframe)).catch(()=>{});
              resolve(null);
              return;
            }
            const entry = { candles: filtered.map(c=>({ ...c })), intervals: val.intervals.filter(iv=>iv && Number.isFinite(iv.from) && Number.isFinite(iv.to)), ts: val.ts, version: val.version };
            this._memory.set(this._key(symbol, timeframe), entry);
            resolve(val);
          } else resolve(null);
        };
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }

  size() { return this._memory.size; }
}
