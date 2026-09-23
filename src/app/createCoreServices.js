import { CandleStore } from '../data/CandleStore.js';
import { CandleCache } from '../data/CandleCache.js';
import { AppState } from '../state/AppState.js';
import { DeterministicReplayEngine } from './DeterministicReplayEngine.js';
import { RemoteTradingEngine } from './RemoteTradingEngine.js';
import { BackendService } from './BackendService.js';
import { SessionMutationPipeline } from './SessionMutationPipeline.js';
import { RemoteDatasetRepository } from './RemoteDatasetRepository.js';
import { LocalDatasetRepository } from './LocalDatasetRepository.js';
import { getSessionId } from './sessionId.js';

export function createCoreServices() {
  const sessionId = getSessionId();
  const appState = new AppState();
  const candleStore = new CandleStore();
  appState.setCandleStore(candleStore);
  const candleCache = new CandleCache({ dbName: 'delta-replay-futures-v2' });
  const mutationPipeline = new SessionMutationPipeline();
  const datasetRepository = new RemoteDatasetRepository();
  const localDatasetRepository = new LocalDatasetRepository();
  const tradingApi = new BackendService('trading', sessionId);
  const backtestApi = new BackendService('backtest', sessionId);
  const replayTradingEngine = new RemoteTradingEngine(tradingApi, mutationPipeline);
  const engine = new DeterministicReplayEngine({
    symbolProvider: () => appState.symbol,
    onCandle: ({ candle, index, symbol }) => replayTradingEngine.onMarketCandle({ candle, index, symbol }),
  });
  return {
    tradingEngine: replayTradingEngine,
    engine,
    appState,
    candleStore,
    candleCache,
    datasetRepository,
    localDatasetRepository,
    replayApi: null,
    tradingApi,
    backtestApi,
    mutationPipeline,
    sessionId,
  };
}
