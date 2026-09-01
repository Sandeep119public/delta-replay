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
    this._candles = candles;
    if (total === 0) {
      this.slider.disabled = true;
      this.slider.min = 0;
      this.slider.max = 0;
      this.slider.value = 0;
      this._updateLabels(0);
      return;
    }
    this.slider.disabled = false;
    this.slider.min = 0;
    this.slider.max = total - 1;
    this.slider.value = Math.floor(total * 0.5);
    this._updateLabels(Number(this.slider.value));
    // labels for start/end
    if (candles && candles.length) {
      this.startLabel.textContent = formatTime(candles[0].time);
      this.endLabel.textContent = formatTime(candles[candles.length - 1].time);
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
    const c = this._candles?.[idx];
    this.timeLabel.textContent = c ? formatTime(c.time) : '—';
    this.currentLabel.textContent = c ? formatTime(c.time) : '—';
    this.startIndexLabel.textContent = `Replay start: ${idx}`;
    if (this.startTimeLabelEl) {
      this.startTimeLabelEl.textContent = c ? `${formatTime(c.time)} · idx ${idx}` : '—';
    }
  }
}
