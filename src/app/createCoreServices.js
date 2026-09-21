import { StoredDatasetProvider } from '../data/StoredDatasetProvider.js';
import { HistoricalDataManager } from '../data/HistoricalDataManager.js';
import { CandleStore } from '../data/CandleStore.js';
import { CandleCache } from '../data/CandleCache.js';
import { AppState } from '../state/AppState.js';
import { RemoteReplayEngine } from './RemoteReplayEngine.js';
import { RemoteTradingEngine } from './RemoteTradingEngine.js';
import { BackendService } from './BackendService.js';
import { DatasetService } from './DatasetService.js';
import { SessionMutationPipeline } from './SessionMutationPipeline.js';
import { getSessionId } from './sessionId.js';

export function createCoreServices() {
  const sessionId = getSessionId();
  const appState = new AppState();
  const candleStore = new CandleStore();
  appState.setCandleStore(candleStore);

  // Replay can read only datasets that already exist in the local Parquet store.
  // There is deliberately no Binance provider on this path.
  const candleCache = new CandleCache({ dbName: 'binance-stored-replay-v3' });
  const replayDataManager = new HistoricalDataManager({
    provider: new StoredDatasetProvider(),
    store: candleStore,
    cache: candleCache,
    concurrency: 2,
    chunkSize: 1000,
    strictMode: true,
  });

  // DatasetService owns the separate download workflow.
  const datasetService = new DatasetService();

  const mutationPipeline = new SessionMutationPipeline();
  const replayApi = new BackendService('replay', sessionId);
  const tradingApi = new BackendService('trading', sessionId);
  const backtestApi = new BackendService('backtest', sessionId);
  const tradingEngine = new RemoteTradingEngine(tradingApi, mutationPipeline);
  const engine = new RemoteReplayEngine(
    replayApi,
    tradingEngine,
    () => appState.symbol,
    mutationPipeline,
  );

  return {
    tradingEngine,
    engine,
    appState,
    candleStore,
    candleCache,
    replayDataManager,
    datasetService,
    replayApi,
    tradingApi,
    backtestApi,
    mutationPipeline,
    sessionId,
  };
}
