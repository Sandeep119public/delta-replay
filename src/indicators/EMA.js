import { Indicator } from './Indicator.js';

export class EMA extends Indicator {
  constructor(period = 14, source = 'close') {
    super(`EMA(${period})`);
    this.period = period;
    this.source = source;
    this._multiplier = 2 / (period + 1);
    this._window = [];
  }

  update(candle) {
    if (!candle) return null;
    const val = Number(candle[this.source]);
    if (!Number.isFinite(val)) return this.value;

    if (this.values.length === 0) {
      this._window.push(val);
      if (this._window.length === this.period) {
        const sum = this._window.reduce((acc, v) => acc + v, 0);
        const initialEma = sum / this.period;
        this.values.push(initialEma);
        return initialEma;
      }
      return null;
    }

    const prevEma = this.values[this.values.length - 1];
    const currentEma = (val - prevEma) * this._multiplier + prevEma;
    this.values.push(currentEma);
    return currentEma;
  }

  isReady() {
    return this.values.length > 0;
  }

  reset() {
    super.reset();
    this._window = [];
  }
}
