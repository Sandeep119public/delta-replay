import { PRESENTATION_LOADING_STATES } from '../ports/ErrorPresentationPort.js';
import { formatTime } from '../utils/time.js';

const LoadingState = PRESENTATION_LOADING_STATES;

/**
 * ModeBanner manages the status bar, replay progress metrics,
 * and chart viewport overlay notices.
 *
 * update() receives a narrow replay status view
 * ({ total, status, loadingState, pendingStartIndex, currentIndex, candleAt })
 * instead of replay/app/candle stores.
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
    srTicker = document.getElementById('sr-ticker'),
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
    this.srTicker = srTicker;
    this.overlay = overlay;
    this.overlayText = overlayText;
    // Screen-reader announcements are throttled: visuals update every tick,
    // assistive tech hears status changes or a 5s heartbeat while playing.
    this._lastAnnounceAt = 0;
    this._lastAnnouncedStatus = '';
  }

  update(view = {}) {
    const {
      total = 0,
      status: st = 'idle',
      loadingState = LoadingState.IDLE,
      pendingStartIndex = 0,
      currentIndex = -1,
      candleAt = null,
    } = view;
    const hasData = total > 0;
    const candleAtFn = candleAt ?? (() => null);

    // 1. Update Mode Banner Styling & Text
    // Note: #mode-indicator was removed from the DOM during decluttering;
    // the banner now acts purely as a slim progress ticker.
    if (this.modeBanner) {
      this.modeBanner.className = 'mode-banner';
      // Machine-readable state for the ticker skin (dot + label).
      try { this.modeBanner.setAttribute('data-state', st); } catch {}
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

      if (this.modeIndicator) this.modeIndicator.textContent = label;
      if (this.progressPanel) {
        if (showProgress) this.progressPanel.classList.remove('hidden');
        else this.progressPanel.classList.add('hidden');
      }
    }

    // 2. Update Progress Numbers (ticker format: BAR 1,482 / 8,640 · 17.2%)
    const fmtCount = (n) => Number(n).toLocaleString('en-US');
    if (this.progressText && this.progressPct && this.marketTimeEl && this.marketTimeFull) {
      if (total === 0) {
        this.progressText.textContent = 'BAR 0 / 0';
        this.progressPct.textContent = '0%';
        this.marketTimeEl.textContent = '—';
        this.marketTimeFull.textContent = '—';
      } else if (st === 'ready' || st === 'idle') {
        this.progressText.textContent = `BAR ${fmtCount(pendingStartIndex + 1)} / ${fmtCount(total)}`;
        this.progressPct.textContent = ((pendingStartIndex + 1) / total * 100).toFixed(1) + '%';
        const c = candleAtFn(pendingStartIndex);
        const t = c ? formatTime(c.time) : '—';
        this.marketTimeEl.textContent = t;
        this.marketTimeFull.textContent = t;
      } else {
        const pctVal = total > 0 && currentIndex >= 0 ? ((currentIndex + 1) / total * 100).toFixed(1) : '0.0';
        this.progressText.textContent = `BAR ${currentIndex >= 0 ? fmtCount(currentIndex + 1) : 0} / ${fmtCount(total)}`;
        this.progressPct.textContent = pctVal + '%';
        const c = currentIndex >= 0 ? candleAtFn(currentIndex) : null;
        const t = c ? formatTime(c.time) : '—';
        this.marketTimeEl.textContent = t;
        this.marketTimeFull.textContent = t;
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

    // 4. Throttled screen-reader announcement (see constructor note)
    try {
      const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
      const statusChanged = st !== this._lastAnnouncedStatus;
      if (this.srTicker && (statusChanged || now - this._lastAnnounceAt >= 5000)) {
        this._lastAnnouncedStatus = st;
        this._lastAnnounceAt = now;
        const progress = this.progressText?.textContent || '';
        const market = this.marketTimeFull?.textContent || '';
        this.srTicker.textContent = `Replay ${st}. ${progress}. ${market}.`.trim();
      }
    } catch {}
  }
}
