/**
 * Pure fee calculation boundary for trading execution.
 */
export class FeeCalculator {
  static calculate(notional, rate = 0) {
    const n = Number(notional);
    const r = Number(rate);
    if (!Number.isFinite(n) || !Number.isFinite(r) || n <= 0 || r < 0) return 0;
    return n * r;
  }
}
