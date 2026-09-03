export class Indicator {
  constructor(name) {
    this.name = name;
    this.values = [];
  }

  update(candle) {
    throw new Error('Indicator must implement update(candle)');
  }

  get value() {
    return this.values.length > 0 ? this.values[this.values.length - 1] : null;
  }

  isReady() {
    return this.values.length > 0;
  }

  reset() {
    this.values = [];
  }
}
