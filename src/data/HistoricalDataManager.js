import { EventEmitter } from '../core/EventEmitter.js';
import { CandleStore } from './CandleStore.js';
import { CandleCache } from './CandleCache.js';
import { CandleIntegrity, INTEGRITY_STATUS } from './CandleIntegrity.js';
import { CandleNormalizer } from './CandleNormalizer.js';
import { CandleValidator } from './CandleValidator.js';
import { TIMEFRAME_SECONDS, normalizeRange, computeGridMissing } from './CandleGrid.js';

export const DataEvents = {
  LOADING_STARTED: 'dataLoadingStarted',
  CHUNK_RECEIVED: 'dataChunkReceived',
  PROGRESS: 'dataProgress',
  READY: 'dataReady',
  READY_DEGRADED: 'dataReadyDegraded',
  ERROR: 'dataError',
};

export class HistoricalDataManager extends EventEmitter {
  constructor({ provider, store = null, cache = null, concurrency = 2, maxRetries = 3, chunkSize = 2000, strictMode = false } = {}) {
    super();
    if (!provider) throw new Error('HistoricalDataManager requires provider');
    this.provider = provider;
    this.store = store ?? new CandleStore();
    this.cache = cache ?? new CandleCache();
    this.concurrency = concurrency;
    this.maxRetries = maxRetries;
    this.chunkSize = chunkSize;
    this.strictMode = strictMode;
  }

  async load({ symbol, timeframe, from, to, signal, strict = this.strictMode, allowGaps = false, halfOpen = false, policy = null, origin = null, venue = null } = {}) {
    if (!symbol || !timeframe) throw new Error('symbol and timeframe required');
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('from/to must be numbers');
    if (from >= to) throw new Error('from must be < to');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const tfSec = TIMEFRAME_SECONDS[timeframe];
    if (!tfSec) throw new Error(`Unsupported timeframe ${timeframe}`);
    const gridSpec = typeof this.provider?.getGridSpec === 'function' ? this.provider.getGridSpec() : null;
    const gridOrigin = origin ?? gridSpec?.origin ?? this.provider?.gridOrigin ?? (this.provider?.client?.gridOrigin ?? 0);
    const resolvedVenue = venue ?? this.provider?.venue ?? 'DEFAULT';
    const range = normalizeRange(from, to, tfSec, gridOrigin);
    if (!range.hasCandle) { const err = new Error(`Requested range [${from}, ${to}] contains no complete candle for timeframe ${timeframe}`); err.code = 'INVALID_REQUEST'; this.emit(DataEvents.ERROR, err); throw err; }
    const { requestedFrom, requestedTo, effectiveFrom, effectiveTo } = range;
    this.emit(DataEvents.LOADING_STARTED, { symbol, timeframe, from: requestedFrom, to: requestedTo, effectiveFrom, effectiveTo, venue: resolvedVenue, gridOrigin });
    const estimated = Math.floor((effectiveTo - effectiveFrom) / tfSec) + 1;
    const MAX_ALLOWED = 100000;
    if (estimated > MAX_ALLOWED) { const err = new Error(`Requested range would require ~${estimated} candles (max ${MAX_ALLOWED} for ${timeframe}). Use a larger timeframe or smaller date range.`); err.code = 'INVALID_REQUEST'; this.emit(DataEvents.ERROR, err); throw err; }
    const integrityOptions = { from: effectiveFrom, to: effectiveTo, timeframeSec: tfSec, origin: gridOrigin, strict, allowGaps, halfOpen, policy: policy ?? (strict ? 'STRICT' : 'REPAIR'), timestampUnit: 'seconds' };
    let cacheRes = this.cache.get(symbol, timeframe, effectiveFrom, effectiveTo, { timeframeSec: tfSec, venue: resolvedVenue, gridOrigin });
    if (!cacheRes.hit && this.cache.enableIDB) { const idb = await this.cache.loadFromIDB(symbol, timeframe, { venue: resolvedVenue, gridOrigin }); if (idb) cacheRes = this.cache.get(symbol, timeframe, effectiveFrom, effectiveTo, { timeframeSec: tfSec, venue: resolvedVenue, gridOrigin }); }
    if (cacheRes.hit) {
      const integrityCheck = CandleIntegrity.process(cacheRes.candles, { from: effectiveFrom, to: effectiveTo, timeframeSec: tfSec, origin: gridOrigin, halfOpen, policy: 'REPAIR', timestampUnit: 'seconds' });
      const validCandles = integrityCheck.validCandles; const metadata = integrityCheck.metadata; const isClean = metadata.invalidCount === 0 && (!strict || allowGaps || metadata.gaps.length === 0);
      if (validCandles.length === 0) { this.cache.invalidate(symbol, timeframe, { venue: resolvedVenue, gridOrigin }); cacheRes = { hit: false, candles: [], missing: [{ from: effectiveFrom, to: effectiveTo }], intervals: [] }; }
      else {
        const actualIntervals = CandleCache.intervalsFromCandles(validCandles, tfSec);
        const authoritativeCoverage = this.cache.getCoverage(symbol, timeframe, { timeframeSec: tfSec, venue: resolvedVenue, gridOrigin });
        let realMissing = computeGridMissing(effectiveFrom, effectiveTo, authoritativeCoverage, tfSec);
        if (realMissing.length === 0 && !isClean && metadata.gaps.length > 0) realMissing = metadata.gaps.map(g => ({ from: g.from, to: g.to + (halfOpen ? tfSec : 0) }));
        if (realMissing.length === 0 && isClean) {
          if (JSON.stringify(authoritativeCoverage) !== JSON.stringify(actualIntervals)) this.cache.repairIntervals(symbol, timeframe, { timeframeSec: tfSec, venue: resolvedVenue, gridOrigin });
          this.store.load(validCandles, { symbol, timeframe, requestedFrom, requestedTo, effectiveFrom, effectiveTo, venue: resolvedVenue, gridOrigin, quality: 'VALID', ...metadata, cached: true });
          this.emit(DataEvents.READY, { candles: validCandles, metadata: this.store.getMetadata(), quality: 'VALID' });
          this.emit(DataEvents.PROGRESS, { loaded: validCandles.length, total: validCandles.length, pct: 100 });
          return { candles: validCandles, metadata: this.store.getMetadata(), quality: 'VALID' };
        }
        this.cache.reconcile(symbol, timeframe, { from: effectiveFrom, to: effectiveTo, candles: validCandles, timeframeSec: tfSec, venue: resolvedVenue, gridOrigin, halfOpen });
        cacheRes = { hit: false, candles: validCandles, missing: realMissing.length > 0 ? realMissing : [{ from: effectiveFrom, to: effectiveTo }], intervals: actualIntervals };
      }
    }
    if (!cacheRes.hit && cacheRes.candles.length > 0) {
      try {
        const { validCandles: cachedValid } = CandleIntegrity.process(cacheRes.candles, { from: effectiveFrom, to: effectiveTo, timeframeSec: tfSec, origin: gridOrigin, policy: 'REPAIR', timestampUnit: 'seconds' });
        if (cachedValid.length !== cacheRes.candles.length) { const actualCachedIntervals = CandleCache.intervalsFromCandles(cachedValid, tfSec); const realMissing = computeGridMissing(effectiveFrom, effectiveTo, actualCachedIntervals, tfSec); cacheRes.candles = cachedValid; cacheRes.missing = realMissing; cacheRes.intervals = actualCachedIntervals; this.cache.reconcile(symbol, timeframe, { from: effectiveFrom, to: effectiveTo, candles: cachedValid, timeframeSec: tfSec, venue: resolvedVenue, gridOrigin, halfOpen }); }
      } catch {}
    }
    const missingRanges = cacheRes.missing.length ? cacheRes.missing : [{ from: effectiveFrom, to: effectiveTo }];
    const chunks = [];
    for (const mr of missingRanges) { let cur = mr.from; while (cur <= mr.to) { const chunkSpan = (this.chunkSize - 1) * tfSec; const chunkEnd = Math.min(mr.to, cur + chunkSpan); chunks.push({ from: cur, to: chunkEnd }); cur = chunkEnd + tfSec; } }
    const totalChunks = chunks.length; let completed = 0; const rawCollected = [...cacheRes.candles];
    const emitProgress = () => { const pct = totalChunks === 0 ? 100 : Math.round((completed / totalChunks) * 100); this.emit(DataEvents.PROGRESS, { loaded: rawCollected.length, total: estimated, totalChunks, completed, pct }); };
    const isRetryable = (err) => { if (!err || err.name === 'AbortError') return false; const msg = (err.message ?? String(err)).toLowerCase(); if (msg.includes('illegal invocation')) return false; if (['INVALID_REQUEST','INVALID_RESPONSE','NO_DATA'].includes(err.code)) return false; if (err.code === 'TIMEOUT' || err.name === 'TimeoutError' || err.code === 'NETWORK_ERROR') return true; if (err.code === 'CORS_ERROR') return false; const status = err.details?.status ?? err.status; if (status === 408 || status === 429) return true; if (typeof status === 'number' && status >= 500 && status < 600) return true; return false; };
    const fetchChunkWithRetry = async (chunk, attempt = 0) => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); try { if (typeof this.provider.fetchChunk === 'function') return await this.provider.fetchChunk({ symbol, timeframe, from: chunk.from, to: chunk.to, signal }); if (typeof this.provider.getCandles === 'function') return await this.provider.getCandles({ symbol, timeframe, from: chunk.from, to: chunk.to, signal }); throw new Error('Provider must implement fetchChunk or getCandles'); } catch (err) { if (err?.name === 'AbortError') throw err; if (attempt < this.maxRetries && isRetryable(err)) { const backoff = Math.min(5000, Math.pow(2, attempt) * 200 + Math.random() * 100); await new Promise((res, rej) => { const t = setTimeout(res, backoff); signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true }); }); return fetchChunkWithRetry(chunk, attempt + 1); } throw err; } };
    const results=[]; let idx=0; const workers=Array.from({length:Math.min(this.concurrency,chunks.length)},async()=>{while(idx<chunks.length){if(signal?.aborted)throw new DOMException('Aborted','AbortError');const chunkIdx=idx++;const chunk=chunks[chunkIdx];const raw=await fetchChunkWithRetry(chunk);results[chunkIdx]=raw;completed++;if(Array.isArray(raw)){rawCollected.push(...raw);this.emit(DataEvents.CHUNK_RECEIVED,{index:chunkIdx,chunk,count:raw.length});}else this.emit(DataEvents.CHUNK_RECEIVED,{index:chunkIdx,chunk,count:0});emitProgress();}});
    try { await Promise.all(workers); } catch(err) { this.emit(DataEvents.ERROR,err); throw err; }
    if(signal?.aborted)throw new DOMException('Aborted','AbortError'); const allRaw=rawCollected;
    if(allRaw.length===0){const err=new Error('No candles found');err.code='NO_DATA';this.emit(DataEvents.ERROR,err);throw err;}
    let validCandles,metadata; try { const integrityRes=CandleIntegrity.process(allRaw,integrityOptions);validCandles=integrityRes.validCandles;metadata=integrityRes.metadata; } catch(err){this.emit(DataEvents.ERROR,err);throw err;}
    const effectivePolicy=policy??(strict?'STRICT':'REPAIR');
    if(effectivePolicy==='REPAIR'&&metadata.repairRanges&&metadata.repairRanges.length>0){const repairRequested=metadata.repairRanges.length;const repairedMap=new Map();for(const rRange of metadata.repairRanges){try{const freshRaw=await fetchChunkWithRetry(rRange);if(Array.isArray(freshRaw)&&freshRaw.length>0){const normalizedChunk=CandleNormalizer.normalizeBatch(freshRaw,{timestampUnit:'seconds'});for(const c of normalizedChunk){const v=CandleValidator.validate(c);if(v.valid&&c.time>=rRange.from&&c.time<=rRange.to)repairedMap.set(c.time,c);}}}catch{}}let allNormalized=[];try{allNormalized=CandleNormalizer.normalizeBatch(allRaw,{timestampUnit:'seconds'});}catch{allNormalized=allRaw;}const repairTimes=new Set(metadata.repairRanges.map(r=>r.from));const combined=allNormalized.filter(c=>!repairTimes.has(c.time)).concat([...repairedMap.values()]);let recheck;try{recheck=CandleIntegrity.process(combined,integrityOptions);}catch(err){if(strict){this.emit(DataEvents.ERROR,err);throw err;}recheck={validCandles,metadata:{...metadata,invalidCount:repairRequested}};}const repairSucceeded=metadata.repairRanges.filter(r=>repairedMap.has(r.from)).length;const repairFailed=repairRequested-repairSucceeded;const repairCompletelySuccessful=recheck.metadata.invalidCount===0&&repairFailed===0;if(repairCompletelySuccessful){validCandles=recheck.validCandles;metadata={...recheck.metadata,requestedFrom,requestedTo,effectiveFrom,effectiveTo,repairRequested,repairSucceeded,repairFailed,repairSuccess:true,integrityStatus:INTEGRITY_STATUS.VALID};}else{validCandles=recheck.validCandles;metadata={...recheck.metadata,requestedFrom,requestedTo,effectiveFrom,effectiveTo,repairRequested,repairSucceeded,repairFailed,repairSuccess:false,integrityStatus:INTEGRITY_STATUS.DEGRADED};if(strict){const err=new Error(`Integrity error: repair failed for ${repairFailed} candle(s)`);err.code='INTEGRITY_ERROR';this.emit(DataEvents.ERROR,err);throw err;}}}
    if(validCandles.length===0){const err=new Error('No valid candles after integrity');err.code='NO_DATA';this.emit(DataEvents.ERROR,err);throw err;}
    if(metadata.repairSuccess!==false&&metadata.integrityStatus!==INTEGRITY_STATUS.DEGRADED)this.cache.set(symbol,timeframe,effectiveFrom,effectiveTo,validCandles,{timeframeSec:tfSec,venue:resolvedVenue,gridOrigin});
    const isDegraded=metadata.integrityStatus===INTEGRITY_STATUS.DEGRADED||metadata.repairSuccess===false;const quality=isDegraded?'DEGRADED':'VALID';
    this.store.load(validCandles,{symbol,timeframe,requestedFrom,requestedTo,effectiveFrom,effectiveTo,venue:resolvedVenue,gridOrigin,quality,...metadata});
    this.emit(DataEvents.READY,{candles:validCandles,metadata:this.store.getMetadata(),quality}); if(isDegraded)this.emit(DataEvents.READY_DEGRADED,{candles:validCandles,metadata:this.store.getMetadata(),quality}); emitProgress(); return {candles:validCandles,metadata:this.store.getMetadata(),quality};
  }
  getStore(){return this.store;} getCache(){return this.cache;} clear(){this.store.clear();this.cache.clear();}
}
