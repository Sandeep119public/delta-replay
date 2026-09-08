import { BinanceCandleProvider } from '../data/BinanceCandleProvider.js';
import { HistoricalDataManager } from '../data/HistoricalDataManager.js';
import { CandleStore } from '../data/CandleStore.js';
import { CandleCache } from '../data/CandleCache.js';
import { AppState } from '../state/AppState.js';
import { RemoteReplayEngine } from './RemoteReplayEngine.js';
import { RemoteTradingEngine } from './RemoteTradingEngine.js';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const SESSION_STORAGE_KEY = 'delta-replay.session-id';

function fallbackUuid() {
  const bytes = new Uint8Array(16);
  try {
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      const now = Date.now();
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = (now + index * 31 + Math.floor(Math.random() * 256)) & 0xff;
      }
    }
  } catch {
    const now = Date.now();
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = (now + index * 31 + Math.floor(Math.random() * 256)) & 0xff;
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getSessionId() {
  try {
    const existing = globalThis.sessionStorage?.getItem(SESSION_STORAGE_KEY);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
      return existing;
    }
    const generated = globalThis.crypto?.randomUUID?.() || fallbackUuid();
    globalThis.sessionStorage?.setItem(SESSION_STORAGE_KEY, generated);
    return generated;
  } catch {
    return fallbackUuid();
  }
}

class BackendService {
  constructor(path, sessionId = getSessionId()) {
    this.path = path;
    this.sessionId = sessionId;
  }

  async request(endpoint = '', options = {}) {
    const response = await fetch(`${API_BASE}/api/v1/${this.path}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': this.sessionId,
        ...(options.headers || {}),
      },
    });

    let body = null;
    if (response.status !== 204) {
      try { body = await response.json(); } catch { body = null; }
    }
    if (!response.ok) {
      const message = body?.detail || body?.message || `${this.path} API failed: ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.code = `HTTP_${response.status}`;
      error.details = body;
      throw error;
    }
    return body;
  }
}

export function createCoreServices() {
  const sessionId = getSessionId();
  const appState = new AppState();
  const candleStore = new CandleStore();
  appState.setCandleStore(candleStore);
  const candleCache = new CandleCache({ dbName: 'delta-replay-futures-v2' });
  const dataManager = new HistoricalDataManager({
    provider: new BinanceCandleProvider(),
    store: candleStore,
    cache: candleCache,
    concurrency: 2,
    chunkSize: 1000,
    strictMode: true,
  });
  const replayApi = new BackendService('replay', sessionId);
  const tradingApi = new BackendService('trading', sessionId);
  const backtestApi = new BackendService('backtest', sessionId);
  const tradingEngine = new RemoteTradingEngine(tradingApi);
  const engine = new RemoteReplayEngine(replayApi, tradingEngine);
  return {
    tradingEngine,
    engine,
    appState,
    candleStore,
    candleCache,
    dataManager,
    replayApi,
    tradingApi,
    backtestApi,
    sessionId,
  };
}
