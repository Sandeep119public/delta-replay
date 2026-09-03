/**
 * Validates canonical candles.
 * Canonical: { time: seconds, open, high, low, close, volume }
 */
export class CandleValidator {
  /**
   * Validate a single candle.
   * @returns {{ valid: boolean, reason?: string }}
   */
  static validate(candle, prevTime = null) {
    if (!candle || typeof candle !== 'object') {
      return { valid: false, reason: 'candle must be an object' };
    }
    const { time, open, high, low, close, volume } = candle;

    if (!Number.isFinite(time) || time <= 0) {
      return { valid: false, reason: `invalid time: ${time}` };
    }
    if (prevTime !== null && time <= prevTime) {
      return { valid: false, reason: `time not strictly increasing: ${time} <= ${prevTime}` };
    }

    for (const [k, v] of [['open', open], ['high', high], ['low', low], ['close', close]]) {
      if (!Number.isFinite(v) || v <= 0) {
        return { valid: false, reason: `invalid ${k}: ${v}` };
      }
    }

    if (high < open) return { valid: false, reason: `high (${high}) < open (${open})` };
    if (high < close) return { valid: false, reason: `high (${high}) < close (${close})` };
    if (low > open) return { valid: false, reason: `low (${low}) > open (${open})` };
    if (low > close) return { valid: false, reason: `low (${low}) > close (${close})` };
    if (high < low) return { valid: false, reason: `high (${high}) < low (${low})` };

    if (!Number.isFinite(volume) || volume < 0) {
      return { valid: false, reason: `invalid volume: ${volume}` };
    }

    return { valid: true };
  }

  /**
   * Validate array, return diagnostics.
   * @returns {{ validCandles: object[], errors: {index:number, reason:string}[] }}
   */
  static validateBatch(candles) {
    const validCandles = [];
    const errors = [];
    let prevTime = null;
    for (let i = 0; i < candles.length; i++) {
      const res = CandleValidator.validate(candles[i], prevTime);
      if (res.valid) {
        validCandles.push(candles[i]);
        prevTime = candles[i].time;
      } else {
        errors.push({ index: i, reason: res.reason, candle: candles[i] });
      }
    }
    return { validCandles, errors };
  }
}
