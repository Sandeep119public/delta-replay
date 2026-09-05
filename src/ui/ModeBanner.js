import { LoadingState } from '../data/DataError.js';
import { formatTime } from '../utils/time.js';

/**
 * ModeBanner manages the status bar, replay progress metrics,
 * and chart viewport overlay notices.
 */
export class ModeBanner {
  constructor({
    modeBanner = document.getElementById('mode-banner'),
    modeIndicator = document.getElementById('mode-indicator'),
    progressPanel = document.getElementById('progress-panel'),
    progressText = document.getElementById('progress-text'),
    progressPct = document.getElementById('progress-pct'),
    marketTimeEl = document.getElementById('market-time'),
    marketTimeFull = document.getElementById('market-time-full'),
    overlay = document.getElementById('chart-overlay'),
    overlayText = document.getElementById('overlay-text'),
  } = {}) {
    this.modeBanner = modeBanner;
    this.modeIndicator = modeIndicator;
    this.progressPanel = progressPanel;
    this.progressText = progressText;
    this.progressPct = progressPct;
    this.marketTimeEl = marketTimeEl;
    this.marketTimeFull = marketTimeFull;
    this.overlay = overlay;
    this.overlayText = overlayText;
  }

  update({ replayState = null, appState = null, candleStore = null } = {}) {
    const total = candleStore?.getCount?.() || appState?.candles?.length || 0;
    const hasData = total > 0;
    const st = replayState?.status ?? appState?.replayState?.status ?? 'idle';
    const loadingState = appState?.loadingState ?? LoadingState.IDLE;
    const pendingStartIndex = appState?.pendingStartIndex ?? 0;
    const currentIndex = replayState?.currentIndex ?? -1;

    // 1. Update Mode Banner Styling & Text
    if (this.modeBanner && this.modeIndicator) {
      this.modeBanner.className = 'mode-banner';
      let label = '';
      let showProgress = false;

      if (!hasData || st === 'idle') {
        this.modeBanner.classList.add('mode-idle');
        label = hasData ? 'NO REPLAY STARTED' : 'NO DATA LOADED';
        showProgress = false;
      } else if (st === 'ready') {
        this.modeBanner.classList.add('mode-ready');
        label = 'PREVIEW MODE — READY TO REPLAY';
        showProgress = true;
      } else if (st === 'playing') {
        this.modeBanner.classList.add('mode-playing');
        label = '▶ PLAYING';
        showProgress = true;
      } else if (st === 'paused') {
        this.modeBanner.classList.add('mode-paused');
        label = '⏸ PAUSED';
        showProgress = true;
      } else if (st === 'ended') {
        this.modeBanner.classList.add('mode-ended');
        label = 'REPLAY COMPLETE';
        showProgress = true;
      } else {
        label = st.toUpperCase();
      }

      this.modeIndicator.textContent = label;
      if (this.progressPanel) {
        if (showProgress) this.progressPanel.classList.remove('hidden');
        else this.progressPanel.classList.add('hidden');
      }
    }

    // 2. Update Progress Numbers
    if (this.progressText && this.progressPct && this.marketTimeEl && this.marketTimeFull) {
      if (total === 0) {
        this.progressText.textContent = '0 / 0';
        this.progressPct.textContent = '0%';
        this.marketTimeEl.textContent = '—';
        this.marketTimeFull.textContent = 'CURRENT MARKET TIME: —';
      } else if (st === 'ready' || st === 'idle') {
        this.progressText.textContent = `${pendingStartIndex + 1} / ${total}`;
        this.progressPct.textContent = ((pendingStartIndex + 1) / total * 100).toFixed(2) + '%';
        const c = candleStore?.get?.(pendingStartIndex) || appState?.candles?.[pendingStartIndex];
        const t = c ? formatTime(c.time) : '—';
        this.marketTimeEl.textContent = t;
        this.marketTimeFull.textContent = `CURRENT MARKET TIME: ${t}`;
      } else {
        const pctVal = total > 0 && currentIndex >= 0 ? ((currentIndex + 1) / total * 100).toFixed(2) : '0.00';
        this.progressText.textContent = `${currentIndex >= 0 ? currentIndex + 1 : 0} / ${total}`;
        this.progressPct.textContent = pctVal + '%';
        const c = currentIndex >= 0 ? (candleStore?.get?.(currentIndex) || appState?.candles?.[currentIndex]) : null;
        const t = c ? formatTime(c.time) : '—';
        this.marketTimeEl.textContent = t;
        this.marketTimeFull.textContent = `CURRENT MARKET TIME: ${t}`;
      }
    }

    // 3. Update Chart Overlay
    if (this.overlay && this.overlayText) {
      if (!hasData) {
        if (loadingState === LoadingState.LOADING) {
          this.overlayText.textContent = 'Loading historical data…';
          this.overlay.classList.remove('hidden');
        } else if (
          loadingState === LoadingState.NETWORK_ERROR ||
          loadingState === LoadingState.HTTP_ERROR ||
          loadingState === LoadingState.TIMEOUT ||
          loadingState === LoadingState.INVALID_DATA ||
          loadingState === LoadingState.UNKNOWN_ERROR
        ) {
          this.overlayText.textContent = "Couldn't load historical candles.\nChoose a symbol and date range, then click Load Data.";
          this.overlay.classList.remove('hidden');
        } else if (loadingState === LoadingState.EMPTY) {
          this.overlayText.textContent = 'No candles found for the selected range.';
          this.overlay.classList.remove('hidden');
        } else {
          this.overlayText.textContent = 'No market data\n\nChoose a symbol and date range,\nthen click Load Data.';
          this.overlay.classList.remove('hidden');
        }
      } else if (st === 'ended') {
        this.overlayText.textContent = 'REPLAY COMPLETE — press RESET to replay';
        this.overlay.classList.remove('hidden');
      } else if (loadingState === LoadingState.LOADING) {
        this.overlayText.textContent = 'Loading historical data…';
        this.overlay.classList.remove('hidden');
      } else {
        this.overlay.classList.add('hidden');
      }
    }
  }
}
