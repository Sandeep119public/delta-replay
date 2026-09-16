import { EventEmitter } from '../core/EventEmitter.js';
import { CandleStore } from './CandleStore.js';
import { CandleCache } from './CandleCache.js';
import { CandleIntegrity, INTEGRITY_STATUS } from './CandleIntegrity.js';
import { CandleNormalizer } from './CandleNormalizer.js';
import { CandleValidator } from './CandleValidator.js';
import { TIMEFRAME_SECONDS, normalizeRange, computeGridMissing } from './CandleGrid.js';

export const DataEvents = { LOADING_STARTED: 'dataLoadingStarted', CHUNK_RECEIVED: 'dataChunkReceived', PROGRESS: 'dataProgress', READY: 'dataReady', READY_DEGRADED: 'dataReadyDegraded', ERROR: 'dataError' };

export class HistoricalDataManager {
  constructor({ provider, store = null, cache = null, concurrency = 2, maxRetries = 3, chunkSize = 2000, strictMode = false } = {}) {
    super();
    if (!provider) throw new Error('HistoricalDataManager requires provider');
    this.provider=provider; this.store=store??new CandleStore(); this.cache=cache??new CandleCache(); this.concurrency=concurrency; this.maxRetries=maxRetries; this.chunkSize=chunkSize; this.strictMode=strictMode;
  }
