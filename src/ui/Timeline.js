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

    this.slider.addEventListener('input', () => {
      const idx = Number(this.slider.value);
      this._updateLabels(idx);
      if (this._onChange) this._onChange(idx);
    });
  }

  onChange(fn) { this._onChange = fn; }

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

  getSelectedIndex() {
    return Number(this.slider.value);
  }

  setEnabled(enabled) {
    this.slider.disabled = !enabled;
  }

  _updateLabels(idx) {
    this.indexLabel.textContent = `${idx} / ${this._total > 0 ? this._total - 1 : 0}`;
    const t = this._times?.[idx] ?? this._candles?.[idx]?.time;
    this.timeLabel.textContent = Number.isFinite(t) ? formatTime(t) : '—';
    this.currentLabel.textContent = Number.isFinite(t) ? formatTime(t) : '—';
    this.startIndexLabel.textContent = `Replay start: ${idx}`;
    if (this.startTimeLabelEl) {
      this.startTimeLabelEl.textContent = Number.isFinite(t) ? `${formatTime(t)} · idx ${idx}` : '—';
    }
  }
}
