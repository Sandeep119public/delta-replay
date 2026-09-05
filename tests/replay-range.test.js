import { describe, it, expect } from 'vitest';
import {
  calculateAutoRange,
  resolveReplayTargetUnixSeconds,
  findClosestCandleIndex,
  resolvePresetTarget,
  PRESET_CONFIG
} from '../src/utils/replayRange.js';

describe('replayRange utility — Separation of Concerns', () => {
  describe('calculateAutoRange', () => {
    it('calculates historical context and forward replay range for 1m timeframe', () => {
      const targetSec = 1700000000;
      const nowSec = 1700200000;
      const { from, to } = calculateAutoRange(targetSec, '1m', nowSec);

      // 350 context candles * 60s = 21000s before target
      expect(from).toBe(targetSec - 350 * 60);
      // 1200 forward candles * 60s = 72000s after target
      expect(to).toBe(targetSec + 1200 * 60);
    });

    it('clamps "to" to current time when target is near present', () => {
      const nowSec = 1700010000;
      const targetSec = 1700000000;
      const { from, to } = calculateAutoRange(targetSec, '1m', nowSec);

      expect(to).toBe(nowSec);
      // If window is < 500 * tfSec, it shifts from backwards to ensure enough candles
      expect(to - from).toBeGreaterThanOrEqual(500 * 60);
    });
  });

  describe('resolveReplayTargetUnixSeconds', () => {
    it('converts date and time strings to UTC unix timestamp', () => {
      const ts = resolveReplayTargetUnixSeconds('2024-01-15', '12:30');
      const d = new Date(ts * 1000);
      expect(d.getUTCFullYear()).toBe(2024);
      expect(d.getUTCMonth()).toBe(0); // Jan
      expect(d.getUTCDate()).toBe(15);
      expect(d.getUTCHours()).toBe(12);
      expect(d.getUTCMinutes()).toBe(30);
    });

    it('falls back to fallback date/time if primary is missing or invalid', () => {
      const ts = resolveReplayTargetUnixSeconds('', '', '2024-02-01', '08:00');
      const d = new Date(ts * 1000);
      expect(d.getUTCFullYear()).toBe(2024);
      expect(d.getUTCMonth()).toBe(1); // Feb
      expect(d.getUTCDate()).toBe(1);
    });
  });

  describe('findClosestCandleIndex', () => {
    const testCandles = [
      { time: 1000, open: 10, high: 12, low: 9, close: 11 },
      { time: 1060, open: 11, high: 13, low: 10, close: 12 },
      { time: 1120, open: 12, high: 14, low: 11, close: 13 },
      { time: 1180, open: 13, high: 15, low: 12, close: 14 },
    ];

    it('finds exact matching timestamp index', () => {
      expect(findClosestCandleIndex(1060, null, testCandles)).toBe(1);
      expect(findClosestCandleIndex(1180, null, testCandles)).toBe(3);
    });

    it('finds nearest candle when target is between candles', () => {
      expect(findClosestCandleIndex(1070, null, testCandles)).toBe(1);
      expect(findClosestCandleIndex(1110, null, testCandles)).toBe(2);
    });

    it('handles empty candle array gracefully', () => {
      expect(findClosestCandleIndex(1000, null, [])).toBe(-1);
    });
  });

  describe('resolvePresetTarget', () => {
    it('resolves 1d preset and adjusts 1m timeframe to 5m', () => {
      const nowSec = 1700000000;
      const { targetSec, recommendedTimeframe } = resolvePresetTarget('1d', '1m', nowSec);
      expect(targetSec).toBe(nowSec - 86400);
      expect(recommendedTimeframe).toBe('5m');
    });

    it('resolves 7d preset and adjusts timeframe to 1h', () => {
      const nowSec = 1700000000;
      const { targetSec, recommendedTimeframe } = resolvePresetTarget('7d', '5m', nowSec);
      expect(targetSec).toBe(nowSec - 7 * 86400);
      expect(recommendedTimeframe).toBe('1h');
    });
  });
});
