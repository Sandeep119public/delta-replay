import { formatTime } from '../utils/time.js';

export class Timeline {
  constructor({ sliderEl, startLabelEl, currentLabelEl, endLabelEl, indexLabelEl, timeLabelEl, startIndexLabelEl, appState, engine, startTimeLabelEl = null }) {
    this.slider = sliderEl;
    this.startLabel = startLabelEl;
    this.currentLabel = currentLabelEl;
    this.endLabel = endLabelEl;
    this.indexLabel = indexLabelEl;
    this.timeLabel = timeLabelEl;
    this.startIndexLabel = startIndexLabelEl;
    this.startTimeLabelEl = startTimeLabelEl;
    this.appState = appState;
    this.engine = engine;

    this._total = 0;
    this._onChange = null;
    this._onCommit = null;
    this._markers = [];
    try {
      this.markersEl = typeof document !== 'undefined' ? document.getElementById('timeline-markers') : null;
      this.startHereBtn = typeof document !== 'undefined' ? document.getElementById('timeline-start-btn') : null;
    } catch { this.markersEl = null; this.startHereBtn = null; }

    this.slider.addEventListener('input', () => {
      const idx = Number(this.slider.value);
      this._updateLabels(idx);
      if (this._onChange) this._onChange(idx);
    });

    this.slider.addEventListener('change', () => {
      const idx = Number(this.slider.value);
      this._updateLabels(idx);
      if (this._onCommit) this._onCommit(idx);
    });
  }

  onChange(fn) { this._onChange = fn; }
  onCommit(fn) { this._onCommit = fn; }
  onStartHere(fn) {
    this._onStartHere = fn;
    try {
      const btn = this.startHereBtn || (typeof document !== 'undefined' ? document.getElementById('timeline-start-btn') : null);
      if (btn && !btn.dataset.wired) {
        btn.dataset.wired = '1';
        btn.addEventListener('click', () => this._onStartHere?.(Number(this.slider.value)));
      }
    } catch {}
  }

  /** Trade markers: green dots for LONG entries, red for SHORT. Index-based. */
  setMarkers(markers = []) {
    this._markers = Array.isArray(markers) ? markers : [];
    this._renderMarkers();
  }

  _renderMarkers() {
    try {
      const el = this.markersEl || (typeof document !== 'undefined' ? document.getElementById('timeline-markers') : null);
      if (!el) return;
      if (!this._total || !this._markers.length) { el.innerHTML = ''; return; }
      el.innerHTML = this._markers.map(m => {
        const pct = this._total > 1 ? (Math.min(Math.max(0, m.index), this._total - 1) / (this._total - 1)) * 100 : 0;
        const cls = String(m.side).toUpperCase() === 'SELL' || String(m.side).toUpperCase() === 'SHORT' ? 'is-short' : 'is-long';
        return `<span class="tl-marker ${cls}" style="left:${pct}%" title="${m.side} @ #${m.index}"></span>`;
      }).join('');
    } catch {}
  }

  setTotal(total, candles) {
    this._total = total;
    // Store only timestamps to avoid duplicating full OHLC (future OHLC not needed for labels)
    this._times = candles ? candles.map(c => c.time) : [];
    // Keep reference for backward compat but not used for OHLC
    this._candles = candles;
    if (total === 0) {
      this.slider.disabled = true;
      this.slider.min = 0;
      this.slider.max = 0;
      this.slider.value = 0;
      this.startLabel.textContent = '—';
      this.endLabel.textContent = '—';
      this._updateLabels(0);
      return;
    }
    this.slider.disabled = false;
    this.slider.min = 0;
    this.slider.max = total - 1;
    this.slider.value = Math.floor(total * 0.5);
    try {
      const btn = this.startHereBtn || (typeof document !== 'undefined' ? document.getElementById('timeline-start-btn') : null);
      if (btn) btn.disabled = false;
    } catch {}
    this._renderMarkers();
    this._updateLabels(Number(this.slider.value));
    // labels for start/end use timestamps only
    if (this._times && this._times.length) {
      this.startLabel.textContent = formatTime(this._times[0]);
      this.endLabel.textContent = formatTime(this._times[this._times.length - 1]);
    }
  }

  setPosition(index) {
    if (this._total === 0) return;
    this.slider.value = index;
    this._updateLabels(index);
  }

  _updateProgress(idx) {
    if (!this.slider || !this.slider.style || typeof this.slider.style.setProperty !== 'function') return;
    const pct = this._total > 1 ? (idx / (this._total - 1)) * 100 : 0;
    this.slider.style.setProperty('--timeline-progress', `${pct}%`);
  }

  getSelectedIndex() {
    return Number(this.slider.value);
  }

  setEnabled(enabled) {
    this.slider.disabled = !enabled;
  }

  _updateLabels(idx) {
    this.indexLabel.textContent = `${idx + 1} / ${this._total > 0 ? this._total : 0}`;
    this._updateProgress(idx);
    this._renderMarkers();
    const t = this._times?.[idx] ?? this._candles?.[idx]?.time;
    const timeStr = Number.isFinite(t) ? formatTime(t) : '—';
    this.timeLabel.textContent = timeStr;
    this.currentLabel.textContent = timeStr;
    this.startIndexLabel.textContent = `Replay cursor: #${idx + 1} of ${this._total}`;
    if (this.startTimeLabelEl) {
      this.startTimeLabelEl.textContent = Number.isFinite(t) ? timeStr : '—';
    }
  }
}
