import { ReplayEngine } from './replay/ReplayEngine.js';
import { ChartManager } from './chart/ChartManager.js';
import { ChartAdapter } from './chart/ChartAdapter.js';
import { LocalCandleProvider } from './data/LocalCandleProvider.js';
import { CandleValidator } from './data/CandleValidator.js';
import { AppState } from './state/AppState.js';
import { SymbolSelector } from './ui/SymbolSelector.js';
import { TimeframeSelector } from './ui/TimeframeSelector.js';
import { Timeline } from './ui/Timeline.js';
import { ReplayControls } from './ui/ReplayControls.js';

const appState = new AppState();
const engine = new ReplayEngine();
const provider = new LocalCandleProvider({ basePath: '/sample-data' });

// DOM
const symbolSelect = document.getElementById('symbol-select');
const timeframeSelect = document.getElementById('timeframe-select');
const loadBtn = document.getElementById('load-btn');
const dataStatus = document.getElementById('data-status');
const chartContainer = document.getElementById('chart-container');
const errorBanner = document.getElementById('error-banner');

const sliderEl = document.getElementById('timeline-slider');
const startLabelEl = document.getElementById('timeline-start-label');
const currentLabelEl = document.getElementById('timeline-current-label');
const endLabelEl = document.getElementById('timeline-end-label');
const indexLabelEl = document.getElementById('timeline-index-label');
const timeLabelEl = document.getElementById('timeline-time-label');
const startIndexLabelEl = document.getElementById('start-index-label');
const startReplayBtn = document.getElementById('start-replay-btn');

const playBtn = document.getElementById('btn-play');
const pauseBtn = document.getElementById('btn-pause');
const stepBtn = document.getElementById('btn-step');
const resetBtn = document.getElementById('btn-reset');
const speedSelect = document.getElementById('speed-select');
const statusEl = document.getElementById('replay-status');

// Init UI components
new SymbolSelector(symbolSelect, appState);
new TimeframeSelector(timeframeSelect, appState);

const timeline = new Timeline({
  sliderEl, startLabelEl, currentLabelEl, endLabelEl,
  indexLabelEl, timeLabelEl, startIndexLabelEl,
  appState, engine
});

const controls = new ReplayControls({
  playBtn, pauseBtn, stepBtn, resetBtn, startReplayBtn, speedSelect, statusEl, engine
});

// Chart
const chartManager = new ChartManager(chartContainer);
try {
  chartManager.init();
} catch (e) {
  showError('Chart initialization failed: ' + e.message);
}
const adapter = new ChartAdapter(engine, chartManager);
adapter.attach();

// Timeline -> controls linkage
let pendingStartIndex = 0;
timeline.onChange((idx) => {
  pendingStartIndex = idx;
  controls.setStartIndex(idx);
  startIndexLabelEl.textContent = `Replay start: ${idx}`;
  // If not yet in replay (ready/idle), update preview? Keep preview but timeline moves preview marker
  // We keep chart preview showing all until replay starts; timeline just picks start.
});

// Load logic with race protection
let loadToken = 0;

async function loadData() {
  const token = ++loadToken;
  const symbol = appState.symbol;
  const timeframe = appState.timeframe;
  appState.setLoading(true);
  hideError();
  dataStatus.textContent = `Loading ${symbol} ${timeframe}...`;
  loadBtn.disabled = true;
  try {
    const candles = await provider.getCandles({ symbol, timeframe });
    if (token !== loadToken) return; // stale

    // Validate already done in engine, but also ensure non-empty
    if (!candles.length) throw new Error('No candles returned');

    appState.setCandles(candles);
    engine.load(candles);
    appState.setReplayState(engine.getState());

    // Preview: show all candles
    adapter.showPreview(candles);
    timeline.setTotal(candles.length, candles);
    pendingStartIndex = Number(timeline.getSelectedIndex());
    controls.setStartIndex(pendingStartIndex);

    // Enable controls for start
    startReplayBtn.disabled = false;
    dataStatus.textContent = `${candles.length} candles loaded — select start and click START REPLAY`;
    timeline.setEnabled(true);
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (token !== loadToken) return;
    showError(err.message);
    dataStatus.textContent = 'Load failed';
  } finally {
    if (token === loadToken) {
      appState.setLoading(false);
      loadBtn.disabled = false;
    }
  }
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.remove('hidden');
}
function hideError() {
  errorBanner.classList.add('hidden');
  errorBanner.textContent = '';
}

// Engine -> AppState sync
engine.on('stateChanged', (s) => {
  appState.setReplayState(s);
  // update timeline position to currentIndex when playing/step/seek
  if (s.currentIndex >= 0) timeline.setPosition(s.currentIndex);
  // update controls start index availability
  if (s.status === 'ready') {
    timeline.setEnabled(true);
    startReplayBtn.disabled = false;
  } else if (s.status === 'playing' || s.status === 'paused' || s.status === 'ended') {
    // during replay, timeline slider reflects current position, but selection for start is locked?
    // Keep timeline enabled for seek
    timeline.setEnabled(true);
    startReplayBtn.disabled = true; // prevent re-start without reset
  }
  if (s.status === 'ended') {
    dataStatus.textContent = `Replay ended at ${s.currentIndex + 1} / ${s.totalCandles}`;
  }
});

engine.on('started', () => {
  dataStatus.textContent = `Replaying from ${pendingStartIndex}`;
  timeline.setPosition(pendingStartIndex);
});

// Seek via timeline during replay: clicking slider should seek? We already have input handler.
// But we need to distinguish preview selection vs seek. If engine is playing/paused/ended, slider input should seek.
sliderEl.addEventListener('change', () => {
  const idx = Number(sliderEl.value);
  const st = engine.getState();
  if (st.status === 'paused' || st.status === 'playing' || st.status === 'ended') {
    try { engine.seek(idx); } catch (e) { showError(e.message); }
  } else {
    pendingStartIndex = idx;
    controls.setStartIndex(idx);
  }
});

// Buttons
loadBtn.addEventListener('click', loadData);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    const s = engine.getState();
    if (s.status === 'paused') engine.play();
    else if (s.status === 'playing') engine.pause();
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    try { engine.stepForward(); } catch {}
  } else if (e.code === 'KeyR') {
    e.preventDefault();
    engine.reset();
    // after reset, restore preview?
    const st = engine.getState();
    if (st.status === 'paused' || st.status === 'ready') {
      // if reset went to paused at startIndex, chart already has visible; timeline position updated
      // if ready, show preview again
      if (st.status === 'ready') {
        adapter.showPreview(appState.candles);
        timeline.setTotal(appState.candles.length, appState.candles);
        controls.setStartIndex(pendingStartIndex);
        startReplayBtn.disabled = false;
      }
    }
  }
});

// Auto-load on startup
loadData();

// Handle engine reset to restore timeline correctly
engine.on('reset', (s) => {
  if (s.status === 'ready') {
    // show preview
    adapter.showPreview(appState.candles);
    timeline.setTotal(appState.candles.length, appState.candles);
    startReplayBtn.disabled = false;
  }
});
