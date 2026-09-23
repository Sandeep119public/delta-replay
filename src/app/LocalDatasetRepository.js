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
  return [csvLine(CSV_HEADER), ...candles.map((c) => csvLine([c.time, c.open, c.high, c.low, c.close, c.volume]))].join('\n') + '\n';
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const header = lines.shift()?.trim();
  if (header !== CSV_HEADER.join(',')) throw new Error('Local dataset CSV schema must be time,open,high,low,close,volume');

  const raw = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(',');
    if (cells.length !== CSV_HEADER.length) throw new Error('Local dataset CSV row ' + (i + 2) + ' has an invalid column count');
    raw.push({ time: cells[0], open: cells[1], high: cells[2], low: cells[3], close: cells[4], volume: cells[5] });
  }
  if (!raw.length) throw new Error('Local dataset CSV contains no candles');
  return CandleNormalizer.normalizeBatch(raw, { timestampUnit: 'seconds' });
}

function inferIdentity(fileName) {
  const name = String(fileName || '').replace(/\.csv$/i, '');
  const match = name.match(/^([A-Z0-9._-]{2,32})-(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w)(?:-([a-f0-9]{16,64}))?$/i);
  if (!match) throw new Error('Local dataset filename must be SYMBOL-TIMEFRAME.csv or SYMBOL-TIMEFRAME-CONTENTID.csv');
  return { symbol: match[1].toUpperCase(), timeframe: match[2], contentIdPrefix: match[3]?.toLowerCase() || '' };
}

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Replay dataset contains a non-finite number');
    return value.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 21 });
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [String(key), canonicalValue(value[key])]));
  throw new Error('Unsupported replay dataset value');
}

async function datasetContentId(candles) {
  const canonical = JSON.stringify(canonicalValue(candles));
  if (!globalThis.crypto?.subtle) {
    let h1 = 0x811c9dc5;
    for (let i = 0; i < canonical.length; i += 1) { h1 ^= canonical.charCodeAt(i); h1 = Math.imul(h1, 0x01000193); }
    return (h1 >>> 0).toString(16).padStart(8, '0').repeat(8);
  }
  const bytes = new TextEncoder().encode(canonical);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
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

function memoryList() {
  return [...memory.values()].map((item) => ({ ...item.metadata })).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function putPersistent(record) {
  const db = await openDatabase();
  if (!db) return false;
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Unable to store local dataset'));
      tx.onabort = () => reject(tx.error || new Error('Unable to store local dataset'));
    });
    return true;
  } finally {
    try { db.close(); } catch {}
  }
}

export class LocalDatasetRepository {
  async list() {
    if (!globalThis.indexedDB) return memoryList();
    const db = await openDatabase();
    if (!db) return memoryList();
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
    if (!globalThis.indexedDB) {
      const record = memory.get(id);
      return record ? structuredClone(record) : null;
    }
    const db = await openDatabase();
    if (!db) {
      const record = memory.get(id);
      return record ? structuredClone(record) : null;
    }
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
    const timeframeSec = this._timeframeSeconds(identity.timeframe);
    const integrity = CandleIntegrity.process(candles, {
      timeframeSec,
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

    const computedContentId = await datasetContentId(candles);
    if (!computedContentId.startsWith(identity.contentIdPrefix)) {
      throw new Error('Local dataset content identity does not match its filename');
    }

    const now = Date.now();
    const metadata = {
      id: 'local-' + computedContentId.slice(0, 32),
      contentId: computedContentId,
      schemaVersion: 2,
      symbol: identity.symbol,
      timeframe: identity.timeframe,
      timeframeSec,
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
    if (globalThis.indexedDB && await putPersistent(record)) {
      return structuredClone(metadata);
    }
    memory.set(record.id, structuredClone(record));
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
