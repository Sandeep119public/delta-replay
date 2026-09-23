import { CandleIntegrity } from '../data/CandleIntegrity.js';
import { LoadingState } from '../data/DataError.js';

const TIMEFRAME_SECONDS = Object.freeze({
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800,
  '12h': 43200, '1d': 86400, '3d': 259200, '1w': 604800,
});

export function createReplayLoadService({
  datasetRepository,
  localDatasetRepository = null,
  appState,
  replayEngine,
  hasOpenPosition,
  hasPendingOrders,
  hasTradingActivity,
}) {
  const required = { datasetRepository, appState, replayEngine };
  for (const [name, value] of Object.entries(required)) {
    if (!value) throw new TypeError('createReplayLoadService requires ' + name);
  }
  for (const [name, value] of Object.entries({ hasOpenPosition, hasPendingOrders, hasTradingActivity })) {
    if (typeof value !== 'function') throw new TypeError('createReplayLoadService requires ' + name + '() capability');
  }

  let loadToken = 0;
  let destroyed = false;

  async function readDataset(source, datasetId) {
    if (source === 'local') {
      if (!localDatasetRepository) throw new Error('Browser local dataset storage is unavailable');
      const record = await localDatasetRepository.get(datasetId || appState.replayDatasetId);
      if (!record?.metadata || !Array.isArray(record.candles)) {
        throw new Error('Local replay dataset was not found in this browser');
      }
      return { metadata: record.metadata, candles: record.candles };
    }

    const datasets = await datasetRepository.list();
    const selectedId = datasetId || appState.replayDatasetId || datasets[0]?.id;
    if (!selectedId) {
      const error = new Error('No saved replay dataset. Download historical Binance data first.');
      error.code = 'NO_DATASET';
      throw error;
    }

    const listing = datasets.find((dataset) => dataset.id === selectedId)
      || (typeof datasetRepository.get === 'function' ? await datasetRepository.get(selectedId) : null);
    if (!listing) {
      const error = new Error('Selected replay dataset no longer exists');
      error.code = 'DATASET_NOT_FOUND';
      throw error;
    }

    const payload = await datasetRepository.getCandles(selectedId);
    if (!payload?.metadata || !Array.isArray(payload.candles)) {
      throw new Error('Saved replay dataset is invalid');
    }
    return { metadata: payload.metadata, candles: payload.candles };
  }

  async function loadAndPrepareReplay({ datasetId = null, datasetSource = null } = {}) {
    if (destroyed) return null;

    if (hasTradingActivity()) {
      const error = new Error('Cannot replace replay data after trading activity. Reset the simulation first.');
      error.code = 'TRADING_ACTIVITY';
      throw error;
    }
    if (hasOpenPosition() || hasPendingOrders()) {
      const error = new Error('Cannot change replay data while a position is open or a pending order exists. Close the position and cancel pending orders first.');
      error.code = 'ACTIVE_TRADING';
      throw error;
    }

    const token = ++loadToken;
    appState.transitionLoading(LoadingState.LOADING);

    try {
      const source = datasetSource || appState.replayDatasetSource || 'github';
      const { metadata, candles } = await readDataset(source, datasetId);
      if (token !== loadToken || destroyed) return null;
      if (!candles.length) throw new Error('Replay dataset is empty');

      const timeframeSec = metadata.timeframeSec || TIMEFRAME_SECONDS[metadata.timeframe];
      const integrity = CandleIntegrity.process(candles, {
        from: candles[0].time,
        to: candles[candles.length - 1].time,
        timeframeSec,
        origin: 0,
        strict: true,
        policy: 'STRICT',
        timestampUnit: 'seconds',
      });

      if (!integrity.validCandles.length || integrity.validCandles.length !== candles.length) {
        throw new Error('Replay dataset failed strict integrity validation');
      }
      if (token !== loadToken || destroyed) return null;

      const replayMetadata = {
        ...metadata,
        datasetId: metadata.id || datasetId,
        local: source === 'local',
        saved: source !== 'local',
        source: source === 'local' ? 'local-file' : 'binance',
        quality: 'VALID',
      };

      const loadResult = await replayEngine.loadDataset(integrity.validCandles, {
        startIndex: 0,
        metadata: replayMetadata,
      });
      if (token !== loadToken || destroyed) return null;
      if (!loadResult?.totalCandles) throw new Error('Replay dataset is empty');

      appState.setReplayDatasetId(replayMetadata.datasetId, source);
      appState.symbol = metadata.symbol;
      appState.timeframe = metadata.timeframe;
      appState.setReplayState(loadResult);
      appState.setPendingStartIndex(0);
      appState.transitionLoading(LoadingState.SUCCESS);

      return { metadata: replayMetadata, state: loadResult };
    } catch (error) {
      if (token !== loadToken || destroyed) return null;
      const state = error?.code === 'NO_DATASET' ? LoadingState.EMPTY : LoadingState.INVALID_DATA;
      appState.transitionLoading(state, error);
      throw error;
    } finally {
      if (token === loadToken && !destroyed) appState.setLoading(false);
    }
  }

  return Object.freeze({
    loadAndPrepareReplay,
    invalidateCurrentLoad() { loadToken += 1; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      loadToken += 1;
    },
  });
}
