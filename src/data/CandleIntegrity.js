import { CandleNormalizer } from './CandleNormalizer.js';
import { CandleValidator } from './CandleValidator.js';

/**
 * Dataset integrity status classification.
 */
export const INTEGRITY_STATUS = Object.freeze({
  VALID: 'VALID',
  VALID_WITH_GAPS: 'VALID_WITH_GAPS',
  INVALID: 'INVALID',
});

/**
 * CandleIntegrity — dedup, sort, validate, gap detection.
 * No invention of candles; reports missing intervals.
 */
export class CandleIntegrity {
  /**
   * Process raw chunks → canonical sorted validated array + metadata.
   * @param {Array} rawCandles - raw objects from API chunks
   * @param {object} opts
   * @param {number} opts.from - requested from sec
   * @param {number} opts.to - requested to sec
   * @param {number} opts.timeframeSec
   * @param {boolean} [opts.strict=false] - reject dataset if invalid or gapped
   * @param {boolean} [opts.allowGaps=false] - when strict, allow gaps but reject invalid
   * @param {boolean} [opts.halfOpen=false] - use [from, to) half-open interval
   * @returns {{ validCandles: Array, metadata: object }}
   */
  static process(rawCandles, { from, to, timeframeSec, strict = false, allowGaps = false, halfOpen = false } = {}) {
    if (!Array.isArray(rawCandles)) throw new Error('rawCandles must be array');

    // 1. Normalize
    let normalized;
    try {
      normalized = CandleNormalizer.normalizeBatch(rawCandles);
    } catch (err) {
      throw new Error(`Normalization failed: ${err.message}`);
    }

    // 2. Sort ascending
    normalized.sort((a, b) => a.time - b.time);

    // 3. Dedup (keep last)
    const deduped = [];
    const seen = new Set();
    let duplicatesRemoved = 0;
    for (const c of normalized) {
      if (deduped.length && deduped[deduped.length - 1].time === c.time) {
        deduped[deduped.length - 1] = c;
        duplicatesRemoved++;
        continue;
      }
      if (seen.has(c.time)) {
        const idx = deduped.findIndex(x => x.time === c.time);
        if (idx >= 0) { deduped[idx] = c; duplicatesRemoved++; }
        continue;
      }
      deduped.push(c);
      seen.add(c.time);
    }

    // 4. Range filter (supports standard [from, to) half-open or legacy [from, to] closed)
    const ranged = deduped.filter(c => halfOpen ? (c.time >= from && c.time < to) : (c.time >= from && c.time <= to));

    // 5. Validate
    const { validCandles, errors } = CandleValidator.validateBatch(ranged);
    const invalidCount = errors.length;

    // 6. Gap detection
    const gaps = [];
    if (timeframeSec) {
      for (let i = 1; i < validCandles.length; i++) {
        const expected = validCandles[i - 1].time + timeframeSec;
        const actual = validCandles[i].time;
        if (actual !== expected) {
          // Report gap: missing intervals between
          const missingCount = Math.round((actual - expected) / timeframeSec);
          if (missingCount > 0) {
            gaps.push({
              from: expected,
              to: actual - timeframeSec,
              missingCount,
              afterIndex: i - 1,
            });
          } else if (actual > expected) {
            // Irregular gap (not aligned)
            gaps.push({ from: expected, to: actual, missingCount: 1, afterIndex: i - 1, irregular: true });
          }
        }
      }
    }

    // Explicit integrity status
    let integrityStatus = INTEGRITY_STATUS.VALID;
    if (invalidCount > 0) {
      integrityStatus = INTEGRITY_STATUS.INVALID;
    } else if (gaps.length > 0) {
      integrityStatus = INTEGRITY_STATUS.VALID_WITH_GAPS;
    }

    // Strict validation enforcement
    if (strict) {
      if (invalidCount > 0) {
        throw new Error(`Integrity error: dataset contains ${invalidCount} invalid candle(s)`);
      }
      if (!allowGaps && gaps.length > 0) {
        throw new Error(`Integrity error: dataset contains ${gaps.length} candle gap(s); contiguous market time required`);
      }
    }

    const metadata = {
      requestedFrom: from,
      requestedTo: to,
      actualFirst: validCandles[0]?.time ?? null,
      actualLast: validCandles[validCandles.length - 1]?.time ?? null,
      count: validCandles.length,
      duplicatesRemoved,
      invalidCount,
      gaps,
      integrityStatus,
      errors: errors.slice(0, 5),
    };

    return { validCandles, metadata };
  }
}
