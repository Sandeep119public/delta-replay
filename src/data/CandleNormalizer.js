/**
 * Normalizes external candle formats to canonical internal format.
 * Canonical: { time: seconds(int), open, high, low, close, volume }
 *
 * No other module should guess timestamp units.
 */
export class CandleNormalizer {
  /**
   * Normalize a single raw candle.
   * Supports:
   *  - { time, open, high, low, close, volume } where time may be seconds or ms
   *  - { t, o, h, l, c, v } alias
   *  - { timestamp, open, high, low, close, volume }
   *  - array form: [time, open, high, low, close, volume]
   */
  static normalize(raw) {
    if (Array.isArray(raw)) {
      const [time, open, high, low, close, volume] = raw;
      return CandleNormalizer._toCanonical({ time, open, high, low, close, volume });
    }
    if (raw && typeof raw === 'object') {
      const time = raw.time ?? raw.t ?? raw.timestamp ?? raw.time_ms ?? raw.timeSec;
      const open = raw.open ?? raw.o;
      const high = raw.high ?? raw.h;
      const low = raw.low ?? raw.l;
      const close = raw.close ?? raw.c;
      const volume = raw.volume ?? raw.v ?? 0;
      return CandleNormalizer._toCanonical({ time, open, high, low, close, volume });
    }
    throw new Error(`Cannot normalize candle: ${JSON.stringify(raw)}`);
  }

  static _toCanonical({ time, open, high, low, close, volume }) {
    if (time == null) throw new Error('Missing time field');
    let t = Number(time);
    if (!Number.isFinite(t)) throw new Error(`Invalid time: ${time}`);
    // Heuristic: if time > 1e12 it's ms, if > 1e10 it's ms (since seconds ~1.7e9 in 2024)
    // Threshold 1e11 (year 5138 in seconds, so safe to treat as ms)
    // Use 1e11 as cutoff: seconds ~ 1_700_000_000, ms ~ 1_700_000_000_000
    if (t > 1e11) t = Math.floor(t / 1000);
    else t = Math.floor(t);

    return {
      time: t,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume ?? 0)
    };
  }

  static normalizeBatch(rawArray) {
    if (!Array.isArray(rawArray)) throw new Error('normalizeBatch expects array');
    return rawArray.map((r) => CandleNormalizer.normalize(r));
  }
}
