import { CandleIntegrity } from '../data/CandleIntegrity.js';
import { CandleNormalizer } from '../data/CandleNormalizer.js';

const DB_NAME = 'delta-replay-local-datasets-v1';
const STORE_NAME = 'datasets';
const CSV_HEADER = ['time', 'open', 'high', 'low', 'close', 'volume'];
const MAX_FILE_BYTES = 90 * 1024 * 1024;

const memory = new Map();

function csvLine(values) {
  return values.map((value) => String(value)).join(',');
}

function toCsv(candles) {
  return [csvLine(CSV_HEADER), ...candles.map((c) => csvLine([
    c.time, c.open, c.high, c.low, c.close, c.volume,
  ]))].join('\n') + '\n';
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line, index, all) => line.length || index < all.length - 1);
  const header = lines.shift()?.trim();
  if (header !== CSV_HEADER.join(',')) throw new Error('Local dataset CSV schema must be time,open,high,low,close,volume');
  const raw = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(',');
    if (cells.length !== CSV_HEADER.length) throw new Error(`Local dataset CSV row ${i + 2} has an invalid column count`);
    raw.push({
      time: cells[0],
      open: cells[1],
      high: cells[2],
      low: cells[3],
      close: cells[4],
      volume: cells[5],
    });
  }
  if (!raw.length) throw new Error('Local dataset CSV contains no candles');
  return CandleNormalizer.normalizeBatch(raw, { timestampUnit: 'seconds' });
}

function inferIdentity(fileName) {
  const name = String(fileName || '').replace(/\.csv$/i, '');
  const match = name.match(/^([A-Z0-9._-]{2,32})-(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w)-([a-f0-9]{16,64})$/i);
  if (!match) throw new Error('Local dataset filename must be SYMBOL-TIMEFRAME-CONTENTID.csv');
  return {
    symbol: match[1].toUpperCase(),
    timeframe: match[2],
    contentId: match[3].toLowerCase(),
  };
}

async function digest(text) {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  let h1 = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h1 ^= text.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0').repeat(8);
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open local dataset storage'));
  });
}

async function withStore(mode, operation) {
  const db = await openDatabase();
  if (!db) return operation(null);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let result;
    try {
      result = operation(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      try { db.close(); } catch {}
      resolve(result);
    };
    tx.onerror = () => {
      try { db.close(); } catch {}
      reject(tx.error || new Error('Local dataset storage transaction failed'));
    };
    tx.onabort = () => {
      try { db.close(); } catch {}
      reject(tx.error || new Error('Local dataset storage transaction aborted'));
    };
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local dataset storage request failed'));
  });
}

export class LocalDatasetRepository {
  async list() {
    if (!globalThis.indexedDB) {
      return [...memory.values()].map((item) => ({ ...item.metadata })).sort((a, b) => b.updatedAt - a.updatedAt);
    }
    const db = await openDatabase();
    if (!db) return [...memory.values()].map((item) => ({ ...item.metadata }));
    const values = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Unable to list local datasets'));
    });
    try { db.close(); } catch {}
    return values.map((item) => ({ ...item.metadata })).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id) {
    if (!id) return null;
    if (!globalThis.indexedDB) return memory.get(id)?.metadata ? { ...memory.get(id) } : null;
    const db = await openDatabase();
    if (!db) return memory.get(id) ? structuredClone(memory.get(id)) : null;
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Unable to read local dataset'));
    });
    try { db.close(); } catch {}
    return value ? structuredClone(value) : null;
  }

  async importFile(file) {
    if (!file || typeof file.text !== 'function') throw new TypeError('A local dataset file is required');
    if (Number(file.size || 0) > MAX_FILE_BYTES) throw new Error('Local dataset file exceeds the 90 MiB safety limit');
    if (!/\.csv$/i.test(file.name || '')) throw new Error('Only canonical CSV replay datasets are supported for local import');
    const identity = inferIdentity(file.name);
    const text = await file.text();
    const candles = parseCsv(text);
    const integrity = CandleIntegrity.process(candles, {
      timeframeSec: this._timeframeSeconds(identity.timeframe),
      from: candles[0].time,
      to: candles[candles.length - 1].time,
      origin: 0,
      strict: true,
      policy: 'STRICT',
      timestampUnit: 'seconds',
    });
    if (!integrity.validCandles.length || integrity.validCandles.length !== candles.length) {
      throw new Error('Local dataset failed strict integrity validation');
    }
    const computedContentId = await digest(JSON.stringify(candles));
    if (identity.contentId !== computedContentId.slice(0, identity.contentId.length)) {
      throw new Error('Local dataset content identity does not match its filename');
    }
    const now = Date.now();
    const metadata = {
      id: `local-${computedContentId.slice(0, 32)}`,
      contentId: computedContentId,
      schemaVersion: 2,
      symbol: identity.symbol,
      timeframe: identity.timeframe,
      timeframeSec: this._timeframeSeconds(identity.timeframe),
      from: candles[0].time,
      to: candles[candles.length - 1].time,
      count: candles.length,
      format: 'CSV',
      source: 'local-file',
      status: 'validated',
      quality: 'VALID',
      fileName: file.name,
      local: true,
      saved: false,
      createdAt: now,
      updatedAt: now,
    };
    const record = { id: metadata.id, metadata, candles };
    memory.set(record.id, structuredClone(record));
    if (globalThis.indexedDB) {
      const db = await openDatabase();
      if (db) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(record);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error || new Error('Unable to store local dataset'));
          tx.onabort = () => reject(tx.error || new Error('Unable to store local dataset'));
        });
        try { db.close(); } catch {}
      }
    }
    return structuredClone(metadata);
  }

  async remove(id) {
    if (!String(id || '').startsWith('local-')) throw new Error('Only local browser datasets can be removed here');
    memory.delete(id);
    if (!globalThis.indexedDB) return;
    const db = await openDatabase();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Unable to remove local dataset'));
      tx.onabort = () => reject(tx.error || new Error('Unable to remove local dataset'));
    });
    try { db.close(); } catch {}
  }

  async getCsv(id) {
    const record = await this.get(id);
    if (!record) throw new Error('Local dataset not found');
    return { metadata: record.metadata, csv: toCsv(record.candles) };
  }

  _timeframeSeconds(timeframe) {
    return {
      '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
      '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800,
      '12h': 43200, '1d': 86400, '3d': 259200, '1w': 604800,
    }[timeframe] || null;
  }
}
