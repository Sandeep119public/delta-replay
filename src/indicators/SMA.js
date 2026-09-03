import { Indicator } from './Indicator.js';

export class SMA extends Indicator {
  constructor(period = 14, source = 'close') {
    super(`SMA(${period})`);
    this.period = period;
    this.source = source;
    this._window = [];
  }

  update(candle) {
    if (!candle) return null;
    const val = Number(candle[this.source]);
    if (!Number.isFinite(val)) return this.value;

    this._window.push(val);
    if (this._window.length > this.period) {
      this._window.shift();
    }

    if (this._window.length === this.period) {
      const sum = this._window.reduce((acc, v) => acc + v, 0);
      const sma = sum / this.period;
      this.values.push(sma);
      return sma;
    }
    return null;
  }

  isReady() {
    return this._window.length >= this.period;
  }

  reset() {
    super.reset();
    this._window = [];
  }
}
