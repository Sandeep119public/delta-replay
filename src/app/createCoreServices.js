import { BinanceCandleProvider } from '../data/BinanceCandleProvider.js';
import { HistoricalDataManager } from '../data/HistoricalDataManager.js';
import { CandleStore } from '../data/CandleStore.js';
import { CandleCache } from '../data/CandleCache.js';
import { AppState } from '../state/AppState.js';
import { RemoteReplayEngine } from './RemoteReplayEngine.js';
import { RemoteTradingEngine } from './RemoteTradingEngine.js';
import { BackendService } from './BackendService.js';
import { SessionMutationPipeline } from './SessionMutationPipeline.js';
import { RemoteDatasetRepository } from './RemoteDatasetRepository.js';
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
  const mutationPipeline = new SessionMutationPipeline();
  const datasetRepository = new RemoteDatasetRepository();
  const replayApi = new BackendService('replay', sessionId);
  const tradingApi = new BackendService('trading', sessionId);
  const backtestApi = new BackendService('backtest', sessionId);
  const tradingEngine = new RemoteTradingEngine(tradingApi, mutationPipeline);
  const engine = new RemoteReplayEngine(replayApi, tradingEngine, () => appState.symbol, mutationPipeline);
  return { tradingEngine, engine, appState, candleStore, candleCache, dataManager, datasetRepository, replayApi, tradingApi, backtestApi, mutationPipeline, sessionId };
}
