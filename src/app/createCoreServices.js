import { BinanceCandleProvider } from '../data/BinanceCandleProvider.js';
import { HistoricalDataManager } from '../data/HistoricalDataManager.js';
import { CandleStore } from '../data/CandleStore.js';
import { CandleCache } from '../data/CandleCache.js';
import { AppState } from '../state/AppState.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

class BackendService {
  constructor(path) { this.path = path; }
  async request(endpoint = '', options = {}) {
    const response = await fetch(`${API_BASE}/api/v1/${this.path}${endpoint}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    if (!response.ok) throw new Error(`${this.path} API failed: ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
}

export function createCoreServices() {
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
  return {
    appState,
    candleStore,
    candleCache,
    dataManager,
    replayApi: new BackendService('replay'),
    tradingApi: new BackendService('trading'),
    backtestApi: new BackendService('backtest'),
  };
}
