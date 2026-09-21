const DB_VERSION = 1;
const STORE_NAME = 'datasets';
export const STORED_DATASET_DB = 'delta-replay-datasets-v1';
export const DATASET_FORMAT = 'CSV';

const clone = (value) => value == null ? value : structuredClone(value);

export function candlesToCsv(candles) {
  if (!Array.isArray(candles) || !candles.length) throw new Error('Cannot serialize an empty dataset');
  const rows = ['time,open,high,low,close,volume'];
  for (const candle of candles) {
    rows.push([
      Number(candle.time),
      Number(candle.open),
      Number(candle.high),
      Number(candle.low),
      Number(candle.close),
      Number(candle.volume ?? 0),
    ].join(','));
  }
  return rows.join('\n') + '\n';
}

function normalizeCandles(candles) {
  if (!Array.isArray(candles) || candles.length === 0) throw new Error('Dataset must contain at least one candle');
  return candles.map((candle) => ({
    time: Number(candle.time),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.volume ?? 0),
  }));
}

function makeId({ symbol, timeframe, from, to }) {
  return [symbol, timeframe, Math.floor(from), Math.floor(to)]
    .map((value) => String(value).trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '_'))
    .join('__');
}

export class StoredDatasetRepository {
  constructor({ dbName = STORED_DATASET_DB, indexedDBFactory = globalThis.indexedDB } = {}) {
    this.dbName = dbName;
    this.indexedDBFactory = indexedDBFactory;
    this._dbPromise = null;
    this._destroyed = false;
  }

  async _open() {
    if (this._destroyed) throw new Error('StoredDatasetRepository is closed');
    if (!this.indexedDBFactory) throw new Error('IndexedDB is not available in this browser');
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const request = this.indexedDBFactory.open(this.dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open local dataset storage'));
    });
    return this._dbPromise;
  }

  _request(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
      request.onblocked = () => reject(new Error('IndexedDB request was blocked'));
    });
  }

  _metadata(record) {
    if (!record) return null;
    const { candles, csv, ...metadata } = record;
    return clone(metadata);
  }

  async save({ symbol, timeframe, from, to, candles, metadata = {} } = {}) {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    const normalizedTimeframe = String(timeframe || '').trim();
    if (!normalizedSymbol || !normalizedTimeframe) throw new Error('Dataset symbol and timeframe are required');
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error('Dataset range is invalid');

    const normalizedCandles = normalizeCandles(candles);
    const csv = candlesToCsv(normalizedCandles);
    const id = makeId({ symbol: normalizedSymbol, timeframe: normalizedTimeframe, from, to });
    const existing = await this.get(id);
    const now = Date.now();
    const record = {
      id,
      symbol: normalizedSymbol,
      timeframe: normalizedTimeframe,
      from: Math.floor(from),
      to: Math.floor(to),
      count: normalizedCandles.length,
      format: DATASET_FORMAT,
      fileName: id.toLowerCase() + '.csv',
      byteLength: typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(csv).byteLength : csv.length,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      quality: metadata.quality || metadata.integrityStatus || 'VALID',
      coverageType: metadata.coverageType || 'CONTIGUOUS',
      csv,
      candles: normalizedCandles,
    };

    const db = await this._open();
    await this._request(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record));
    return this._metadata(record);
  }

  async list() {
    const db = await this._open();
    const records = await this._request(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
    return records.map((record) => this._metadata(record)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id) {
    if (!id) return null;
    const db = await this._open();
    const record = await this._request(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(String(id)));
    return record ? clone(record) : null;
  }

  async getCandles(id) {
    const record = await this.get(id);
    if (!record) throw new Error('Saved replay dataset not found');
    return { metadata: this._metadata(record), candles: clone(record.candles) };
  }

  async getCsv(id) {
    const record = await this.get(id);
    if (!record) throw new Error('Saved replay dataset not found');
    return { metadata: this._metadata(record), csv: String(record.csv || '') };
  }

  async remove(id) {
    if (!id) return;
    const db = await this._open();
    await this._request(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(String(id)));
  }

  close() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._dbPromise) this._dbPromise.then((db) => { try { db.close(); } catch {} }).catch(() => {});
    this._dbPromise = null;
  }

  destroy() {
    this.close();
  }
}
