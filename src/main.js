import { ReplayEngine } from './replay/ReplayEngine.js';
import { ChartManager } from './chart/ChartManager.js';
import { ChartAdapter } from './chart/ChartAdapter.js';
import { LocalCandleProvider } from './data/LocalCandleProvider.js';
import { DeltaCandleProvider } from './data/DeltaCandleProvider.js';
import { HistoricalDataManager, DataEvents } from './data/HistoricalDataManager.js';
import { CandleStore } from './data/CandleStore.js';
import { CandleCache } from './data/CandleCache.js';
import { AppState } from './state/AppState.js';
import { SymbolSelector } from './ui/SymbolSelector.js';
import { TimeframeSelector } from './ui/TimeframeSelector.js';
import { Timeline } from './ui/Timeline.js';
import { ReplayControls } from './ui/ReplayControls.js';
import { toUnixSeconds, unixToDateTimeInput, formatTime } from './utils/time.js';
import { PaperTradingEngine } from './trading/PaperTradingEngine.js';
import { TradingPanel } from './ui/TradingPanel.js';

const VISIBLE_WINDOW = 1000;

const appState = new AppState();
const engine = new ReplayEngine();
const deltaProvider = new DeltaCandleProvider();
const localProvider = new LocalCandleProvider();
const candleStore = new CandleStore();
const candleCache = new CandleCache();
const dataManager = new HistoricalDataManager({ provider: deltaProvider, store: candleStore, cache: candleCache, concurrency: 2, chunkSize: 2000 });

// --- Paper Trading Engine ---
const tradingEngine = new PaperTradingEngine({ startingBalance: 10000, replayEngine: engine });

// Integration guards
const _origSeek = engine.seek.bind(engine);
const _origReset = engine.reset.bind(engine);
const _origStart = engine.start.bind(engine);
const _origLoad = engine.load.bind(engine);
function _guardBlocked(action) {
  if (tradingEngine.hasOpenPosition()) {
    const msg = `Cannot ${action} while a position is open — close position first.`;
    showError(msg);
    const errEl = document.getElementById('trading-error');
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); setTimeout(()=>{errEl.textContent=''; errEl.classList.add('hidden');},3000); }
    return true;
  }
  return false;
}
engine.seek = (idx)=> _guardBlocked('seek') ? engine.getState() : _origSeek(idx);
engine.reset = ()=> _guardBlocked('reset replay') ? engine.getState() : _origReset();
engine.start = (idx)=> _guardBlocked('start replay') ? engine.getState() : _origStart(idx);
engine.load = (candles)=> {
  if(tradingEngine.hasOpenPosition()){
    const msg='Cannot load new data while a position is open — close position or reset account first.';
    showError(msg); const errEl=document.getElementById('trading-error'); if(errEl){errEl.textContent=msg; errEl.classList.remove('hidden'); setTimeout(()=>{errEl.textContent=''; errEl.classList.add('hidden');},3000);}
    return engine.getState();
  }
  return _origLoad(candles);
};

// DOM
const symbolSelect=document.getElementById('symbol-select');
const timeframeSelect=document.getElementById('timeframe-select');
const loadBtn=document.getElementById('load-btn');
const dataStatus=document.getElementById('data-status');
const chartContainer=document.getElementById('chart-container');
const errorBanner=document.getElementById('error-banner');
const overlay=document.getElementById('chart-overlay');
const overlayText=document.getElementById('overlay-text');
const fromDateEl=document.getElementById('from-date');
const fromTimeEl=document.getElementById('from-time');
const toDateEl=document.getElementById('to-date');
const toTimeEl=document.getElementById('to-time');
const modeBanner=document.getElementById('mode-banner');
const modeIndicator=document.getElementById('mode-indicator');
const progressPanel=document.getElementById('progress-panel');
const progressText=document.getElementById('progress-text');
const progressPct=document.getElementById('progress-pct');
const marketTimeEl=document.getElementById('market-time');
const marketTimeFull=document.getElementById('market-time-full');
const sliderEl=document.getElementById('timeline-slider');
const startLabelEl=document.getElementById('timeline-start-label');
const currentLabelEl=document.getElementById('timeline-current-label');
const endLabelEl=document.getElementById('timeline-end-label');
const indexLabelEl=document.getElementById('timeline-index-label');
const timeLabelEl=document.getElementById('timeline-time-label');
const startIndexLabelEl=document.getElementById('start-index-label');
const startTimeLabelEl=document.getElementById('start-time-label');
const startReplayBtn=document.getElementById('start-replay-btn');
const jumpDateEl=document.getElementById('jump-date');
const jumpTimeEl=document.getElementById('jump-time');
const jumpBtn=document.getElementById('jump-btn');
const jumpError=document.getElementById('jump-error');
const playBtn=document.getElementById('btn-play');
const pauseBtn=document.getElementById('btn-pause');
const stepBtn=document.getElementById('btn-step');
const resetBtn=document.getElementById('btn-reset');
const speedSelect=document.getElementById('speed-select');
const statusEl=document.getElementById('replay-status');

new SymbolSelector(symbolSelect, appState);
new TimeframeSelector(timeframeSelect, appState);
const timeline=new Timeline({ sliderEl, startLabelEl, currentLabelEl, endLabelEl, indexLabelEl, timeLabelEl, startIndexLabelEl, appState, engine, startTimeLabelEl });
const controls=new ReplayControls({ playBtn, pauseBtn, stepBtn, resetBtn, startReplayBtn, speedSelect, statusEl, engine });
const tradingPanel=new TradingPanel({
  tradingEngine,
  balanceEl: document.getElementById('acct-balance'),
  equityEl: document.getElementById('acct-equity'),
  realizedEl: document.getElementById('acct-realized'),
  unrealizedEl: document.getElementById('acct-unrealized'),
  feesEl: document.getElementById('acct-fees'),
  posSymbolEl: document.getElementById('pos-symbol'),
  posSideEl: document.getElementById('pos-side'),
  posQtyEl: document.getElementById('pos-qty'),
  posEntryEl: document.getElementById('pos-entry'),
  posCurrentEl: document.getElementById('pos-current'),
  posPnlEl: document.getElementById('pos-pnl'),
  qtyInput: document.getElementById('trade-qty'),
  buyBtn: document.getElementById('btn-buy'),
  sellBtn: document.getElementById('btn-sell'),
  closeBtn: document.getElementById('btn-close'),
  resetBtn: document.getElementById('btn-reset-acct'),
  tradesListEl: document.getElementById('trades-list'),
  errorEl: document.getElementById('trading-error'),
});
const chartManager=new ChartManager(chartContainer);
try{ chartManager.init(); }catch(e){ showError('Chart initialization failed: '+e.message); }
const adapter=new ChartAdapter(engine, chartManager);
adapter.attach();

// Patch adapter to use windowed preview for TradingView-style
const origShowPreview = adapter.showPreview.bind(adapter);
adapter.showPreview = (candlesOrStore) => {
  // If preview with windowed store, show window
  if (Array.isArray(candlesOrStore)) {
    // legacy call with full array: window it if large
    if (candlesOrStore.length > VISIBLE_WINDOW) {
      const win = candlesOrStore.slice(Math.max(0, pendingStartIndex - VISIBLE_WINDOW + 1), pendingStartIndex + 1);
      chartManager.setData(win);
    } else {
      chartManager.setData(candlesOrStore);
    }
  } else {
    chartManager.setData(candlesOrStore);
  }
};
// Helper to show preview window for pending start
function updatePreviewWindow(idx) {
  if (!candleStore.getCount()) return;
  const win = candleStore.sliceWindow(Math.max(0, idx - VISIBLE_WINDOW + 1), idx);
  chartManager.setData(win);
  // Timeline already reflects idx
}
// Override ChartAdapter STARTED/SEEKED to window
// We monkey-patch by adding extra listeners that override with windowed setData after adapter's
// Instead we detach and re-attach windowed handlers via main: listen to engine events before adapter
// Simpler: after engine events, main will window via helper. We'll keep adapter's default but then override chart data with windowed slice.
function applyWindowedChart(idx) {
  const total = candleStore.getCount();
  if (total===0) return;
  const start = Math.max(0, idx - VISIBLE_WINDOW + 1);
  // For replay mode, visible is 0..idx, but window is start..idx
  const win = candleStore.sliceWindow(start, idx);
  chartManager.setData(win, { fit: false });
}

function setDefaultRange(){
  const nowSec=Math.floor(Date.now()/1000);
  const toSec=Math.floor(nowSec/60)*60;
  const fromSec=toSec-86400;
  const from=unixToDateTimeInput(fromSec);
  const to=unixToDateTimeInput(toSec);
  if(fromDateEl&&toDateEl){ fromDateEl.value=from.date; fromTimeEl.value=from.time; toDateEl.value=to.date; toTimeEl.value=to.time; }
}
setDefaultRange();

function findClosestIndex(targetSec){
  if(candleStore.getCount()) return candleStore.findIndexByTime(targetSec);
  const candles=appState.candles;
  if(!candles.length) return -1;
  let lo=0,hi=candles.length-1,best=0,minDiff=Infinity;
  while(lo<=hi){ const mid=(lo+hi)>>1; const diff=Math.abs(candles[mid].time-targetSec); if(diff<minDiff){minDiff=diff;best=mid;} if(candles[mid].time===targetSec) return mid; if(candles[mid].time<targetSec) lo=mid+1; else hi=mid-1; }
  if(best>0&&Math.abs(candles[best-1].time-targetSec)<minDiff) best--;
  if(best<candles.length-1&&Math.abs(candles[best+1].time-targetSec)<Math.abs(candles[best].time-targetSec)) best++;
  return best;
}

function updateModeBanner(state){
  const hasData=candleStore.getCount()>0 || appState.candles.length>0;
  const st=state?.status ?? engine.getState().status;
  modeBanner.className='mode-banner';
  let label=''; let showProgress=false;
  if(!hasData||st==='idle'){ modeBanner.classList.add('mode-idle'); label=hasData?'NO REPLAY STARTED':'NO DATA LOADED'; showProgress=false; }
  else if(st==='ready'){ modeBanner.classList.add('mode-ready'); label='PREVIEW MODE — READY TO REPLAY'; showProgress=true; }
  else if(st==='playing'){ modeBanner.classList.add('mode-playing'); label='▶ PLAYING'; showProgress=true; }
  else if(st==='paused'){ modeBanner.classList.add('mode-paused'); label='⏸ PAUSED'; showProgress=true; }
  else if(st==='ended'){ modeBanner.classList.add('mode-ended'); label='REPLAY COMPLETE'; showProgress=true; }
  else label=st.toUpperCase();
  modeIndicator.textContent=label;
  if(showProgress) progressPanel.classList.remove('hidden'); else progressPanel.classList.add('hidden');
  if(!hasData){
    if(appState.loading){ overlayText.textContent='LOADING HISTORICAL DATA…'; overlay.classList.remove('hidden'); }
    else if(appState.error){ overlayText.textContent='ERROR — '+appState.error; overlay.classList.remove('hidden'); }
    else { overlayText.textContent='Select historical range and click LOAD DATA'; overlay.classList.remove('hidden'); }
  } else if(st==='ended'){ overlayText.textContent='REPLAY COMPLETE — press RESET to replay'; overlay.classList.remove('hidden'); }
  else if(appState.loading){ overlayText.textContent='LOADING HISTORICAL DATA…'; overlay.classList.remove('hidden'); }
  else overlay.classList.add('hidden');
}

function updateProgress(state){
  const s=state??engine.getState();
  const total=candleStore.getCount() || appState.candles.length;
  const idx=s.currentIndex;
  if(total===0){ progressText.textContent='0 / 0'; progressPct.textContent='0%'; marketTimeEl.textContent='—'; marketTimeFull.textContent='CURRENT MARKET TIME: —'; return; }
  if(s.status==='ready'||s.status==='idle'){
    progressText.textContent=`${pendingStartIndex+1} / ${total}`;
    progressPct.textContent=((pendingStartIndex+1)/total*100).toFixed(2)+'%';
    const c=candleStore.get(pendingStartIndex) || appState.candles[pendingStartIndex];
    const t=c?formatTime(c.time):'—';
    marketTimeEl.textContent=t; marketTimeFull.textContent=`CURRENT MARKET TIME: ${t}`;
  }else{
    const pctVal=total>0&&idx>=0?((idx+1)/total*100).toFixed(2):'0.00';
    progressText.textContent=`${idx>=0?idx+1:0} / ${total}`;
    progressPct.textContent=pctVal+'%';
    const c=idx>=0?(candleStore.get(idx)||appState.candles[idx]):null;
    const t=c?formatTime(c.time):'—';
    marketTimeEl.textContent=t; marketTimeFull.textContent=`CURRENT MARKET TIME: ${t}`;
  }
}

function onReplayEventSync(state){ updateModeBanner(state); updateProgress(state); }

let pendingStartIndex=0;
timeline.onChange((idx)=>{
  pendingStartIndex=idx;
  controls.setStartIndex(idx);
  updateProgress(engine.getState());
  // TradingView-style: preview shows window before start
  const st=engine.getState();
  if(st.status==='ready'||st.status==='idle'){
    updatePreviewWindow(idx);
  }
});

function handleJump(){
  jumpError.classList.add('hidden'); jumpError.textContent='';
  const total=candleStore.getCount()||appState.candles.length;
  if(!total){ jumpError.textContent='Load data first'; jumpError.classList.remove('hidden'); return; }
  if(!jumpDateEl.value){ jumpError.textContent='Select date'; jumpError.classList.remove('hidden'); return; }
  let target; try{ target=toUnixSeconds(jumpDateEl.value, jumpTimeEl.value||'00:00'); }catch(e){ jumpError.textContent=e.message; jumpError.classList.remove('hidden'); return; }
  const idx=findClosestIndex(target);
  if(idx<0){ jumpError.textContent='No candle found for that time'; jumpError.classList.remove('hidden'); return; }
  const st=engine.getState();
  if(st.status==='idle'||st.status==='ready'){
    pendingStartIndex=idx; controls.setStartIndex(idx); timeline.setPosition(idx); updateProgress(st); updatePreviewWindow(idx);
  }else if(st.status==='playing'){
    if(!tradingEngine.canSeek()){ jumpError.textContent='Cannot jump while position open'; jumpError.classList.remove('hidden'); return; }
    try{ engine.pause(); }catch{}
    trySeek(idx);
  }else if(st.status==='paused'||st.status==='ended'){ trySeek(idx); }
}
if(jumpBtn) jumpBtn.addEventListener('click', handleJump);

function trySeek(idx){
  if(tradingEngine.hasOpenPosition()){ showError('Cannot seek while a position is open — close position first.'); const errEl=document.getElementById('trading-error'); if(errEl){errEl.textContent='Seek blocked: close open position first'; errEl.classList.remove('hidden'); setTimeout(()=>{errEl.textContent=''; errEl.classList.add('hidden');},3000);} return false; }
  try{ engine.seek(idx); // seek will emit SEEKED which we window
    // Apply window after seek
    setTimeout(()=> applyWindowedChart(idx), 0);
    return true; }catch(e){ showError(e.message); return false; }
}

let loadToken=0; let currentAbort=null;

async function loadData(){
  if(tradingEngine.hasOpenPosition()){ showError('Cannot load new data while a position is open — close position or reset account first.'); const errEl=document.getElementById('trading-error'); if(errEl){errEl.textContent='Cannot load new data while a position is open'; errEl.classList.remove('hidden'); setTimeout(()=>{errEl.textContent=''; errEl.classList.add('hidden');},3000);} return; }
  const token=++loadToken;
  if(currentAbort){ try{currentAbort.abort();}catch{}}
  const abortController=new AbortController(); currentAbort=abortController; const signal=abortController.signal;
  const symbol=appState.symbol; const timeframe=appState.timeframe;
  let from,to;
  try{
    if(!fromDateEl.value||!toDateEl.value) throw new Error('Select both FROM and TO dates (UTC)');
    from=toUnixSeconds(fromDateEl.value, fromTimeEl.value||'00:00');
    to=toUnixSeconds(toDateEl.value, toTimeEl.value||'00:00');
    if(!Number.isFinite(from)||!Number.isFinite(to)) throw new Error('Invalid date/time');
    if(from>=to) throw new Error('FROM must be before TO');
    const maxRangeSec=365*86400*2;
    if(to-from>maxRangeSec) throw new Error('Range too large (max ~730 days). Reduce range.');
  }catch(err){ showError(err.message); dataStatus.textContent='Invalid date range'; appState.setError(err.message); updateModeBanner(); return; }

  appState.setLoading(true); appState.clearError(); hideError();
  dataStatus.textContent=`Loading ${symbol} ${timeframe}...`;
  loadBtn.disabled=true; loadBtn.textContent='LOADING...'; updateModeBanner();

  // Listen to manager progress
  const onProgress = ({completed,totalChunks,pct,loaded})=>{
    if(token!==loadToken) return;
    dataStatus.textContent=`Loading ${symbol} ${timeframe} — chunk ${completed}/${totalChunks} (${pct}%) — ${loaded} candles`;
  };
  const onChunk = ({index,count})=>{
    if(token!==loadToken) return;
    // could update overlay
  };
  dataManager.on(DataEvents.PROGRESS, onProgress);
  dataManager.on(DataEvents.CHUNK_RECEIVED, onChunk);

  try{
    const { candles, metadata } = await dataManager.load({ symbol, timeframe, from, to, signal });
    dataManager.off(DataEvents.PROGRESS, onProgress);
    dataManager.off(DataEvents.CHUNK_RECEIVED, onChunk);
    if(token!==loadToken) return;
    if(signal.aborted) return;
    if(!candles.length) throw new Error('No candles returned');
    // Store already in candleStore via manager; also sync AppState for timeline compatibility
    appState.setCandles(candles);
    engine.load(candles);
    appState.setReplayState(engine.getState());
    // Windowed preview instead of full
    timeline.setTotal(candles.length, candles);
    pendingStartIndex=Number(timeline.getSelectedIndex());
    controls.setStartIndex(pendingStartIndex);
    updatePreviewWindow(pendingStartIndex);
    startReplayBtn.disabled=false;
    const fromLbl=new Date(from*1000).toISOString().slice(0,16).replace('T',' ')+' UTC';
    const toLbl=new Date(to*1000).toISOString().slice(0,16).replace('T',' ')+' UTC';
    const gapInfo=metadata.gaps?.length?` • ${metadata.gaps.length} gaps`:' • no gaps';
    const dupInfo=metadata.duplicatesRemoved?` • ${metadata.duplicatesRemoved} dups removed`:'';
    dataStatus.textContent=`Loaded: ${symbol} ${timeframe} ${candles.length} candles (${fromLbl} → ${toLbl})${gapInfo}${dupInfo} • actual ${formatTime(metadata.actualFirst)} → ${formatTime(metadata.actualLast)}`;
    timeline.setEnabled(true);
    updateModeBanner(engine.getState()); updateProgress(engine.getState());
  }catch(err){
    dataManager.off(DataEvents.PROGRESS, onProgress);
    dataManager.off(DataEvents.CHUNK_RECEIVED, onChunk);
    if(err?.name==='AbortError') return;
    if(token!==loadToken) return;
    let msg=err.message||String(err);
    if(err.code){ const map={'INVALID_REQUEST':'Invalid request','NO_DATA':'No data','TIMEOUT':'Request timeout','NETWORK_ERROR':'Network error','CORS_ERROR':'CORS/Network error','API_ERROR':'Exchange API error','INVALID_RESPONSE':'Invalid response'}; const prefix=map[err.code]?`${map[err.code]}: `:`[${err.code}] `; msg=prefix+msg; }
    showError(msg); appState.setError(msg); dataStatus.textContent='Error loading candles'; updateModeBanner();
  }finally{
    if(token===loadToken){ appState.setLoading(false); loadBtn.disabled=false; loadBtn.textContent='LOAD DATA'; if(currentAbort===abortController) currentAbort=null; updateModeBanner(engine.getState()); }
  }
}

function showError(msg){ errorBanner.textContent=msg; errorBanner.classList.remove('hidden'); }
function hideError(){ errorBanner.classList.add('hidden'); errorBanner.textContent=''; }

engine.on('stateChanged', (s)=>{
  appState.setReplayState(s);
  if(s.currentIndex>=0) timeline.setPosition(s.currentIndex);
  onReplayEventSync(s);
  if(s.status==='ready'){ timeline.setEnabled(true); startReplayBtn.disabled=false; }
  else if(s.status==='playing'||s.status==='paused'||s.status==='ended'){ timeline.setEnabled(true); startReplayBtn.disabled=true; }
  if(s.status==='ended'){ dataStatus.textContent=`Replay ended at ${s.currentIndex+1} / ${s.totalCandles}`; }
});
engine.on('started', (payload)=>{
  dataStatus.textContent=`Replaying from ${payload?.index ?? pendingStartIndex}`;
  timeline.setPosition(payload?.index ?? pendingStartIndex);
  onReplayEventSync(engine.getState());
});
engine.on('played', ()=> onReplayEventSync(engine.getState()));
engine.on('paused', ()=> onReplayEventSync(engine.getState()));
engine.on('stepped', ()=> onReplayEventSync(engine.getState()));
engine.on('seeked', ()=> onReplayEventSync(engine.getState()));
engine.on('ended', ()=> onReplayEventSync(engine.getState()));
engine.on('reset', (s)=>{
  if(s.status==='ready'){
    // preview window after reset
    updatePreviewWindow(pendingStartIndex);
    timeline.setTotal(candleStore.getCount()||appState.candles.length, candleStore.getAll().length?candleStore.getAll():appState.candles);
    startReplayBtn.disabled=false;
  }
  onReplayEventSync(s);
});
engine.on('loaded', ()=> onReplayEventSync(engine.getState()));

sliderEl.addEventListener('change', ()=>{
  const idx=Number(sliderEl.value);
  const st=engine.getState();
  if(st.status==='paused'||st.status==='playing'||st.status==='ended'){
    if(st.status==='playing'){ try{engine.pause();}catch{} }
    trySeek(idx);
  }else{
    pendingStartIndex=idx; controls.setStartIndex(idx); updateProgress(st); updatePreviewWindow(idx);
  }
});
loadBtn.addEventListener('click', loadData);
document.addEventListener('keydown', (e)=>{
  if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||e.target instanceof HTMLTextAreaElement) return;
  if(e.code==='Space'){ e.preventDefault(); const s=engine.getState(); if(s.status==='paused') engine.play(); else if(s.status==='playing') engine.pause(); }
  else if(e.code==='ArrowRight'){ e.preventDefault(); try{engine.stepForward();}catch{} }
  else if(e.code==='KeyR'){ e.preventDefault(); engine.reset(); const st=engine.getState(); if(st.status==='paused'||st.status==='ready'){ if(st.status==='ready'){ updatePreviewWindow(pendingStartIndex); timeline.setTotal(candleStore.getCount()||appState.candles.length, candleStore.getAll().length?candleStore.getAll():appState.candles); controls.setStartIndex(pendingStartIndex); startReplayBtn.disabled=false; } } }
  else if(e.code==='Escape'){ const s=engine.getState(); if(s.status==='playing') engine.pause(); }
});
updateModeBanner(); updateProgress();
loadData();
