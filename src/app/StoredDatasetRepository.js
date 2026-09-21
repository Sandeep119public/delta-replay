const DB_VERSION = 2;
const META_STORE = 'datasets';
const CANDLE_STORE = 'dataset_candles';
const FILE_STORE = 'dataset_files';

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
        const upgradeTransaction = request.transaction;
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(CANDLE_STORE)) {
          db.createObjectStore(CANDLE_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(FILE_STORE)) {
          db.createObjectStore(FILE_STORE, { keyPath: 'id' });
        }

        // Version 1 stored metadata, candles and CSV in one object. Move the
        // heavy payloads into dedicated stores so replay can read candles
        // without loading the archival CSV text.
        const legacyStore = upgradeTransaction?.objectStore?.(META_STORE);
        if (!legacyStore?.getAll) return;
        const candleStore = upgradeTransaction.objectStore(CANDLE_STORE);
        const fileStore = upgradeTransaction.objectStore(FILE_STORE);
        const requestAll = legacyStore.getAll();
        requestAll.onsuccess = () => {
          for (const record of requestAll.result || []) {
            if (!record?.id) continue;
            const { candles, csv, ...metadata } = record;
            if (Array.isArray(candles) && candles.length) candleStore.put({ id: record.id, candles });
            if (typeof csv === 'string' && csv) fileStore.put({ id: record.id, csv });
            legacyStore.put(metadata);
          }
        };
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
    return record ? clone(record) : null;
  }

  async _getRecord(storeName, id) {
    const db = await this._open();
    return this._request(db.transaction(storeName, 'readonly').objectStore(storeName).get(String(id)));
  }

  async save({ symbol, timeframe, from, to, candles, metadata = {} } = {}) {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    const normalizedTimeframe = String(timeframe || '').trim();
    if (!normalizedSymbol || !normalizedTimeframe) throw new Error('Dataset symbol and timeframe are required');
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error('Dataset range is invalid');

    const normalizedCandles = normalizeCandles(candles);
    const csv = candlesToCsv(normalizedCandles);
    const id = makeId({ symbol: normalizedSymbol, timeframe: normalizedTimeframe, from, to });
    const existing = await this._getRecord(META_STORE, id);
    const now = Date.now();
    const meta = {
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
    };

    const db = await this._open();
    const tx = db.transaction([META_STORE, CANDLE_STORE, FILE_STORE], 'readwrite');
    await Promise.all([
      this._request(tx.objectStore(META_STORE).put(meta)),
      this._request(tx.objectStore(CANDLE_STORE).put({ id, candles: normalizedCandles })),
      this._request(tx.objectStore(FILE_STORE).put({ id, csv })),
    ]);
    return this._metadata(meta);
  }

  async list() {
    const db = await this._open();
    const values = await this._request(db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll());
    return values.map((record) => this._metadata(record)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id) {
    if (!id) return null;
    const metadata = await this._getRecord(META_STORE, id);
    if (!metadata) return null;
    const candles = await this._getRecord(CANDLE_STORE, id);
    const file = await this._getRecord(FILE_STORE, id);
    return {
      ...clone(metadata),
      candles: clone(candles?.candles || []),
      csv: String(file?.csv || ''),
    };
  }

  async getCandles(id) {
    const metadata = await this._getRecord(META_STORE, id);
    if (!metadata) throw new Error('Saved replay dataset not found');
    const data = await this._getRecord(CANDLE_STORE, id);
    if (!Array.isArray(data?.candles) || !data.candles.length) throw new Error('Saved replay dataset is empty');
    return {
      metadata: this._metadata(metadata),
      candles: clone(data.candles),
    };
  }

  async getCsv(id) {
    const metadata = await this._getRecord(META_STORE, id);
    if (!metadata) throw new Error('Saved replay dataset not found');
    const file = await this._getRecord(FILE_STORE, id);
    return {
      metadata: this._metadata(metadata),
      csv: String(file?.csv || ''),
    };
  }

  async remove(id) {
    if (!id) return;
    const db = await this._open();
    const tx = db.transaction([META_STORE, CANDLE_STORE, FILE_STORE], 'readwrite');
    await Promise.all([
      this._request(tx.objectStore(META_STORE).delete(String(id))),
      this._request(tx.objectStore(CANDLE_STORE).delete(String(id))),
      this._request(tx.objectStore(FILE_STORE).delete(String(id))),
    ]);
  }

  async clear() {
    const db = await this._open();
    const tx = db.transaction([META_STORE, CANDLE_STORE, FILE_STORE], 'readwrite');
    await Promise.all([
      this._request(tx.objectStore(META_STORE).clear()),
      this._request(tx.objectStore(CANDLE_STORE).clear()),
      this._request(tx.objectStore(FILE_STORE).clear()),
    ]);
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
