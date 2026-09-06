import { ReplayEngine } from '../replay/ReplayEngine.js';
import { BinanceCandleProvider } from '../data/BinanceCandleProvider.js';
import { HistoricalDataManager } from '../data/HistoricalDataManager.js';
import { CandleStore } from '../data/CandleStore.js';
import { CandleCache } from '../data/CandleCache.js';
import { AppState } from '../state/AppState.js';
import { PaperTradingEngine, EXECUTION_TIMING } from '../trading/PaperTradingEngine.js';

export function createCoreServices() {
  const appState = new AppState();
  const candleStore = new CandleStore();
  appState.setCandleStore(candleStore);
  const engine = new ReplayEngine();
  const candleCache = new CandleCache({ dbName: 'delta-replay-futures-v1' });
  const dataManager = new HistoricalDataManager({
    provider: new BinanceCandleProvider(),
    store: candleStore,
    cache: candleCache,
    concurrency: 2,
    chunkSize: 1000,
    strictMode: true,
  });
  const tradingEngine = new PaperTradingEngine({
    startingBalance: 10000,
    replayEngine: engine,
    executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
  });
  return { appState, candleStore, engine, candleCache, dataManager, tradingEngine };
}
