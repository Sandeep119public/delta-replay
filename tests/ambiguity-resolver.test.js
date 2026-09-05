import { describe, it, expect } from 'vitest';
import {
  AmbiguityResolver,
  AMBIGUITY_POLICY,
  AMBIGUITY_RESOLUTION,
  EXECUTION_POLICY,
} from '../src/trading/AmbiguityResolver.js';

describe('AmbiguityResolver — SL/TP Collision & Execution Policies', () => {
  it('returns not triggered if no position or candle provided', () => {
    const resolver = new AmbiguityResolver();
    expect(resolver.evaluate()).toEqual({
      triggered: false,
      ambiguityResolution: AMBIGUITY_RESOLUTION.NONE,
      isAmbiguous: false,
    });
  });

  it('ignores stops created or opened on the current candle', () => {
    const resolver = new AmbiguityResolver();
    const position = {
      side: 'LONG',
      openedIndex: 10,
      stopLossPrice: 90,
      stopLossCreatedIndex: 10,
    };
    const candle = { open: 100, high: 105, low: 85, close: 95 };

    // Same index as open
    const res = resolver.evaluate({ position, candle, candleIndex: 10 });
    expect(res.triggered).toBe(false);
  });

  it('triggers SL on long position when candle low breaks stop loss', () => {
    const resolver = new AmbiguityResolver();
    const position = {
      side: 'LONG',
      openedIndex: 5,
      stopLossPrice: 90,
      stopLossCreatedIndex: 5,
      takeProfitPrice: 120,
      takeProfitCreatedIndex: 5,
    };
    const candle = { open: 95, high: 100, low: 88, close: 92 };

    const res = resolver.evaluate({ position, candle, candleIndex: 6 });
    expect(res.triggered).toBe(true);
    expect(res.exitReason).toBe('STOP_LOSS');
    expect(res.exitPrice).toBe(90);
    expect(res.isAmbiguous).toBe(false);
    expect(res.ambiguityResolution).toBe(AMBIGUITY_RESOLUTION.NONE);
  });

  it('triggers TP on short position when candle low breaks take profit', () => {
    const resolver = new AmbiguityResolver();
    const position = {
      side: 'SHORT',
      openedIndex: 5,
      stopLossPrice: 110,
      stopLossCreatedIndex: 5,
      takeProfitPrice: 80,
      takeProfitCreatedIndex: 5,
    };
    const candle = { open: 90, high: 92, low: 78, close: 82 };

    const res = resolver.evaluate({ position, candle, candleIndex: 6 });
    expect(res.triggered).toBe(true);
    expect(res.exitReason).toBe('TAKE_PROFIT');
    expect(res.exitPrice).toBe(80);
    expect(res.isAmbiguous).toBe(false);
  });

  describe('Ambiguity Collision (both SL and TP breached in same bar)', () => {
    const longPosition = {
      side: 'LONG',
      openedIndex: 5,
      stopLossPrice: 90,
      stopLossCreatedIndex: 5,
      takeProfitPrice: 110,
      takeProfitCreatedIndex: 5,
    };
    // Bar has high 115 (breaches TP) and low 85 (breaches SL)
    const volatileCandle = { open: 100, high: 115, low: 85, close: 102 };

    it('defaults to CONSERVATIVE (SL_FIRST)', () => {
      const resolver = new AmbiguityResolver({ policy: AMBIGUITY_POLICY.CONSERVATIVE });
      const res = resolver.evaluate({ position: longPosition, candle: volatileCandle, candleIndex: 6 });

      expect(res.triggered).toBe(true);
      expect(res.exitReason).toBe('STOP_LOSS');
      expect(res.isAmbiguous).toBe(true);
      expect(res.ambiguityResolution).toBe(AMBIGUITY_RESOLUTION.SL_FIRST);
    });

    it('resolves to TP_FIRST when configured', () => {
      const resolver = new AmbiguityResolver({ policy: AMBIGUITY_POLICY.TP_FIRST });
      const res = resolver.evaluate({ position: longPosition, candle: volatileCandle, candleIndex: 6 });

      expect(res.triggered).toBe(true);
      expect(res.exitReason).toBe('TAKE_PROFIT');
      expect(res.isAmbiguous).toBe(true);
      expect(res.ambiguityResolution).toBe(AMBIGUITY_RESOLUTION.TP_FIRST);
    });

    it('resolves to OPEN_PROXIMITY heuristic closer to TP', () => {
      const resolver = new AmbiguityResolver({ policy: AMBIGUITY_POLICY.OPEN_PROXIMITY });
      // Open 108 is closer to TP 110 (dist 2) than SL 90 (dist 18)
      const candleNearTP = { open: 108, high: 115, low: 85, close: 102 };
      const res = resolver.evaluate({ position: longPosition, candle: candleNearTP, candleIndex: 6 });

      expect(res.triggered).toBe(true);
      expect(res.exitReason).toBe('TAKE_PROFIT');
      expect(res.isAmbiguous).toBe(true);
      expect(res.ambiguityResolution).toBe(AMBIGUITY_RESOLUTION.HEURISTIC_PROXIMITY);
    });

    it('resolves to OPEN_PROXIMITY heuristic closer to SL', () => {
      const resolver = new AmbiguityResolver({ policy: AMBIGUITY_POLICY.OPEN_PROXIMITY });
      // Open 92 is closer to SL 90 (dist 2) than TP 110 (dist 18)
      const candleNearSL = { open: 92, high: 115, low: 85, close: 102 };
      const res = resolver.evaluate({ position: longPosition, candle: candleNearSL, candleIndex: 6 });

      expect(res.triggered).toBe(true);
      expect(res.exitReason).toBe('STOP_LOSS');
      expect(res.isAmbiguous).toBe(true);
      expect(res.ambiguityResolution).toBe(AMBIGUITY_RESOLUTION.HEURISTIC_PROXIMITY);
    });
  });

  describe('Execution Policy & Gap Handling', () => {
    it('uses threshold price in SIMPLIFIED execution mode even if gap opened', () => {
      const resolver = new AmbiguityResolver({ executionPolicy: EXECUTION_POLICY.SIMPLIFIED });
      const position = {
        side: 'LONG',
        openedIndex: 5,
        stopLossPrice: 90,
        stopLossCreatedIndex: 5,
      };
      // Candle opened gap-down at 80
      const gappedCandle = { open: 80, high: 85, low: 75, close: 78 };
      const res = resolver.evaluate({ position, candle: gappedCandle, candleIndex: 6 });

      expect(res.triggered).toBe(true);
      expect(res.exitPrice).toBe(90); // Exact threshold
    });

    it('fills at open price in REALISTIC execution mode when gap opened past SL', () => {
      const resolver = new AmbiguityResolver({ executionPolicy: EXECUTION_POLICY.REALISTIC });
      const position = {
        side: 'LONG',
        openedIndex: 5,
        stopLossPrice: 90,
        stopLossCreatedIndex: 5,
      };
      // Candle opened gap-down at 80 (< SL 90)
      const gappedCandle = { open: 80, high: 85, low: 75, close: 78 };
      const res = resolver.evaluate({ position, candle: gappedCandle, candleIndex: 6 });

      expect(res.triggered).toBe(true);
      expect(res.exitPrice).toBe(80); // Filled at open gap
    });

    it('fills at open price in REALISTIC execution mode when gap opened past TP on Short', () => {
      const resolver = new AmbiguityResolver({ executionPolicy: EXECUTION_POLICY.REALISTIC });
      const position = {
        side: 'SHORT',
        openedIndex: 5,
        takeProfitPrice: 80,
        takeProfitCreatedIndex: 5,
      };
      // Short TP is triggered if price goes <= 80. Open is 70 (< 80)
      const gappedCandle = { open: 70, high: 75, low: 65, close: 68 };
      const res = resolver.evaluate({ position, candle: gappedCandle, candleIndex: 6 });

      expect(res.triggered).toBe(true);
      expect(res.exitPrice).toBe(70); // Filled at open gap
    });
  });

  describe('Configuration validation', () => {
    it('validates and updates policy and execution policy', () => {
      const resolver = new AmbiguityResolver();
      resolver.setPolicy(AMBIGUITY_POLICY.TP_FIRST);
      expect(resolver.policy).toBe(AMBIGUITY_POLICY.TP_FIRST);

      resolver.setExecutionPolicy(EXECUTION_POLICY.REALISTIC);
      expect(resolver.executionPolicy).toBe(EXECUTION_POLICY.REALISTIC);

      expect(() => resolver.setPolicy('INVALID')).toThrow(/Invalid ambiguity policy/);
      expect(() => resolver.setExecutionPolicy('INVALID')).toThrow(/Invalid execution policy/);
    });
  });
});
