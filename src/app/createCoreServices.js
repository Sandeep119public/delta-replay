import { BinanceCandleProvider } from '../data/BinanceCandleProvider.js';
import { HistoricalDataManager } from '../data/HistoricalDataManager.js';
import { CandleStore } from '../data/CandleStore.js';
import { CandleCache } from '../data/CandleCache.js';
import { AppState } from '../state/AppState.js';
import { RemoteReplayEngine } from './RemoteReplayEngine.js';
import { RemoteTradingEngine } from './RemoteTradingEngine.js';
import { BackendService } from './BackendService.js';
import { SessionRequestQueue } from './SessionRequestQueue.js';
import { getSessionId } from './sessionId.js';

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
  const requestQueue = new SessionRequestQueue();
  const replayApi = new BackendService('replay', sessionId, requestQueue);
  const tradingApi = new BackendService('trading', sessionId, requestQueue);
  const backtestApi = new BackendService('backtest', sessionId, requestQueue);
  const tradingEngine = new RemoteTradingEngine(tradingApi);
  const engine = new RemoteReplayEngine(replayApi, tradingEngine, () => appState.symbol);
  return { tradingEngine, engine, appState, candleStore, candleCache, dataManager, replayApi, tradingApi, backtestApi, sessionId };
}
