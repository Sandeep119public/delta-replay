import { CandleNormalizer } from './CandleNormalizer.js';
import { CandleValidator } from './CandleValidator.js';

/**
 * Dataset integrity status classification.
 */
export const INTEGRITY_STATUS = Object.freeze({
  VALID: 'VALID',
  VALID_WITH_GAPS: 'VALID_WITH_GAPS',
  DEGRADED: 'DEGRADED',
  INVALID: 'INVALID',
});

/**
 * Explicit dataset integrity policies.
 * STRICT: any invalid candle or gap aborts dataset processing.
 * REPAIR: invalid candles are dropped and flagged for refetching/repair.
 * LENIENT: invalid candles are dropped and dataset is flagged as degraded.
 */
export const DATA_POLICY = Object.freeze({
  STRICT: 'STRICT',
  REPAIR: 'REPAIR',
  LENIENT: 'LENIENT',
});

/**
 * CandleIntegrity — linear dedup, sort, validate, gap detection, policy enforcement.
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
   * @param {string} [opts.policy] - 'STRICT' | 'REPAIR' | 'LENIENT'
   * @returns {{ validCandles: Array, metadata: object }}
   */
  static process(rawCandles, { from, to, timeframeSec, strict = false, allowGaps = false, halfOpen = false, policy = null, timestampUnit = 'auto' } = {}) {
    if (!Array.isArray(rawCandles)) throw new Error('rawCandles must be array');

    const effectivePolicy = policy ?? (strict ? DATA_POLICY.STRICT : DATA_POLICY.REPAIR);

    // 1. Normalize
    let normalized;
    try {
      normalized = CandleNormalizer.normalizeBatch(rawCandles, { timestampUnit });
    } catch (err) {
      throw new Error(`Normalization failed: ${err.message}`);
    }

    // 2. Sort ascending
    normalized.sort((a, b) => a.time - b.time);

    // 3. Dedup (keep last) - O(N) adjacent check since normalized array is sorted
    const deduped = [];
    let duplicatesRemoved = 0;
    for (const c of normalized) {
      if (deduped.length && deduped[deduped.length - 1].time === c.time) {
        deduped[deduped.length - 1] = c;
        duplicatesRemoved++;
        continue;
      }
      deduped.push(c);
    }

    // 4. Range filter (supports standard [from, to) half-open or legacy [from, to] closed)
    const ranged = deduped.filter(c => halfOpen ? (c.time >= from && c.time < to) : (c.time >= from && c.time <= to));

    // 5. Validate
    const { validCandles, errors } = CandleValidator.validateBatch(ranged);
    const invalidCount = errors.length;

    // 6. Gap and boundary coverage detection
    const gaps = [];
    let hasStartGap = false;
    let hasEndGap = false;
    let hasInternalGaps = false;

    if (timeframeSec && Number.isFinite(from) && Number.isFinite(to)) {
      const alignedStart = Math.ceil(from / timeframeSec) * timeframeSec;
      const expectedLast = halfOpen
        ? (to % timeframeSec === 0 ? to - timeframeSec : Math.floor(to / timeframeSec) * timeframeSec)
        : Math.floor(to / timeframeSec) * timeframeSec;

      if (validCandles.length === 0) {
        if (alignedStart <= expectedLast) {
          const missingCount = Math.round((expectedLast - alignedStart) / timeframeSec) + 1;
          hasStartGap = true;
          hasEndGap = true;
          gaps.push({
            type: 'FULL_GAP',
            from: alignedStart,
            to: expectedLast,
            missingCount,
          });
        }
      } else {
        // Boundary check: start coverage (PARTIAL_START)
        if (validCandles[0].time > alignedStart) {
          const missingCount = Math.round((validCandles[0].time - alignedStart) / timeframeSec);
          if (missingCount > 0) {
            hasStartGap = true;
            gaps.push({
              type: 'PARTIAL_START',
              from: alignedStart,
              to: validCandles[0].time - timeframeSec,
              missingCount,
            });
          }
        }

        // Internal gaps (INTERNAL_GAP)
        for (let i = 1; i < validCandles.length; i++) {
          const expected = validCandles[i - 1].time + timeframeSec;
          const actual = validCandles[i].time;
          if (actual !== expected) {
            const missingCount = Math.round((actual - expected) / timeframeSec);
            if (missingCount > 0) {
              hasInternalGaps = true;
              gaps.push({
                type: 'INTERNAL_GAP',
                from: expected,
                to: actual - timeframeSec,
                missingCount,
                afterIndex: i - 1,
              });
            } else if (actual > expected) {
              hasInternalGaps = true;
              gaps.push({
                type: 'INTERNAL_GAP',
                from: expected,
                to: actual,
                missingCount: 1,
                afterIndex: i - 1,
                irregular: true,
              });
            }
          }
        }

        // Boundary check: end coverage (PARTIAL_END)
        const lastCandle = validCandles[validCandles.length - 1];
        if (lastCandle.time < expectedLast) {
          const missingCount = Math.round((expectedLast - lastCandle.time) / timeframeSec);
          if (missingCount > 0) {
            hasEndGap = true;
            gaps.push({
              type: 'PARTIAL_END',
              from: lastCandle.time + timeframeSec,
              to: expectedLast,
              missingCount,
            });
          }
        }
      }
    } else if (timeframeSec) {
      for (let i = 1; i < validCandles.length; i++) {
        const expected = validCandles[i - 1].time + timeframeSec;
        const actual = validCandles[i].time;
        if (actual !== expected) {
          const missingCount = Math.round((actual - expected) / timeframeSec);
          if (missingCount > 0) {
            hasInternalGaps = true;
            gaps.push({
              type: 'INTERNAL_GAP',
              from: expected,
              to: actual - timeframeSec,
              missingCount,
              afterIndex: i - 1,
            });
          }
        }
      }
    }

    // Collect repair intervals for any corrupt candles
    const repairRanges = [];
    if (invalidCount > 0) {
      for (const err of errors) {
        const c = err.candle ?? ranged[err.index];
        if (c && Number.isFinite(c.time)) {
          repairRanges.push({ from: c.time, to: c.time });
        }
      }
    }

    // Explicit integrity status classification
    let integrityStatus = INTEGRITY_STATUS.VALID;
    if (invalidCount > 0) {
      integrityStatus = (effectivePolicy === DATA_POLICY.LENIENT)
        ? INTEGRITY_STATUS.DEGRADED
        : INTEGRITY_STATUS.INVALID;
    } else if (gaps.length > 0) {
      integrityStatus = INTEGRITY_STATUS.VALID_WITH_GAPS;
    }

    // Policy enforcement
    if (effectivePolicy === DATA_POLICY.STRICT) {
      if (invalidCount > 0) {
        throw new Error(`Integrity error: dataset contains ${invalidCount} invalid candle(s)`);
      }
      if (!allowGaps && gaps.length > 0) {
        const gapSummary = gaps.map(g => `${g.type || 'GAP'}: ${g.from}->${g.to}`).join(', ');
        throw new Error(`Integrity error: dataset contains ${gaps.length} candle gap(s) [${gapSummary}]; contiguous market time required`);
      }
    }

    const coverageType = gaps.length === 0
      ? 'CONTIGUOUS'
      : (hasStartGap && hasEndGap ? 'PARTIAL_BOTH' : (hasStartGap ? 'PARTIAL_START' : (hasEndGap ? 'PARTIAL_END' : 'INTERNAL_GAP')));

    return {
      validCandles,
      metadata: {
        requestedFrom: from,
        requestedTo: to,
        actualFirst: validCandles[0]?.time ?? null,
        actualLast: validCandles[validCandles.length - 1]?.time ?? null,
        totalInput: rawCandles.length,
        duplicatesRemoved,
        invalidCount,
        validCount: validCandles.length,
        count: validCandles.length,
        gaps,
        repairRanges,
        hasStartGap,
        hasEndGap,
        hasInternalGaps,
        coverageType,
        integrityStatus,
        policy: effectivePolicy,
        errors: errors.slice(0, 5),
      },
    };
  }
}
