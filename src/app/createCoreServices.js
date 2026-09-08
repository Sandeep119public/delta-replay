import { BinanceCandleProvider } from '../data/BinanceCandleProvider.js';
import { HistoricalDataManager } from '../data/HistoricalDataManager.js';
import { CandleStore } from '../data/CandleStore.js';
import { CandleCache } from '../data/CandleCache.js';
import { AppState } from '../state/AppState.js';
import { RemoteReplayEngine } from './RemoteReplayEngine.js';
import { RemoteTradingEngine } from './RemoteTradingEngine.js';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const SESSION_STORAGE_KEY = 'delta-replay.session-id';

function getSessionId() {
  try {
    const existing = globalThis.sessionStorage?.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const generated = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    globalThis.sessionStorage?.setItem(SESSION_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `delta-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
