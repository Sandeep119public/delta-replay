import { describe, it, expect, vi } from 'vitest';
import { CandleIntegrity, INTEGRITY_STATUS } from '../src/data/CandleIntegrity.js';
import { HistoricalDataManager } from '../src/data/HistoricalDataManager.js';
import { CandleStore } from '../src/data/CandleStore.js';
import { BinanceClient } from '../src/data/BinanceClient.js';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { PaperTradingEngine, EXECUTION_POLICY, AMBIGUITY_POLICY } from '../src/trading/PaperTradingEngine.js';
import { ChartManager } from '../src/chart/ChartManager.js';
import { TradingEvents } from '../src/trading/TradingEvents.js';

describe('Adversarial Audit — Data Integrity & Gaps (Points 1, 2, 18)', () => {
  it('correctly classifies CONTIGUOUS dataset as VALID', () => {
    const raw = [
      { time: 1000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { time: 1060, open: 102, high: 108, low: 101, close: 106, volume: 15 },
      { time: 1120, open: 106, high: 109, low: 104, close: 107, volume: 12 },
    ];
    const { validCandles, metadata } = CandleIntegrity.process(raw, { from: 1000, to: 1120, timeframeSec: 60 });
    expect(validCandles.length).toBe(3);
    expect(metadata.gaps.length).toBe(0);
    expect(metadata.invalidCount).toBe(0);
    expect(metadata.integrityStatus).toBe(INTEGRITY_STATUS.VALID);
  });

  it('classifies gapped dataset as VALID_WITH_GAPS', () => {
    const raw = [
      { time: 1000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      // gap: 1060 is missing
      { time: 1120, open: 106, high: 109, low: 104, close: 107, volume: 12 },
    ];
    const { validCandles, metadata } = CandleIntegrity.process(raw, { from: 1000, to: 1120, timeframeSec: 60 });
    expect(validCandles.length).toBe(2);
    expect(metadata.gaps.length).toBe(1);
    expect(metadata.integrityStatus).toBe(INTEGRITY_STATUS.VALID_WITH_GAPS);
  });

  it('classifies dataset with corrupt candles as INVALID and never silently passes as VALID', () => {
    const raw = [
      { time: 1000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { time: 1060, open: 100, high: 50, low: 95, close: 102, volume: 10 }, // high < open: corrupt
    ];
    const { metadata } = CandleIntegrity.process(raw, { from: 1000, to: 1120, timeframeSec: 60 });
    expect(metadata.invalidCount).toBe(1);
    expect(metadata.integrityStatus).toBe(INTEGRITY_STATUS.INVALID);
  });

  it('strict contiguity mode rejects datasets with gaps', () => {
    const raw = [
      { time: 1000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { time: 1120, open: 106, high: 109, low: 104, close: 107, volume: 12 },
    ];
    expect(() => {
      CandleIntegrity.process(raw, { from: 1000, to: 1120, timeframeSec: 60, strict: true });
    }).toThrow(/candle gap/i);
  });

  it('strict contiguity mode rejects datasets with invalid candles', () => {
    const raw = [
      { time: 1000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { time: 1060, open: 100, high: 50, low: 95, close: 102, volume: 10 },
    ];
    expect(() => {
      CandleIntegrity.process(raw, { from: 1000, to: 1120, timeframeSec: 60, strict: true });
    }).toThrow(/invalid candle/i);
  });

  it('strict mode with allowGaps permits gaps but still rejects invalid candles', () => {
    const gapped = [
      { time: 1000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { time: 1120, open: 106, high: 109, low: 104, close: 107, volume: 12 },
    ];
    const res = CandleIntegrity.process(gapped, { from: 1000, to: 1120, timeframeSec: 60, strict: true, allowGaps: true });
    expect(res.metadata.integrityStatus).toBe(INTEGRITY_STATUS.VALID_WITH_GAPS);

    const corrupt = [
      { time: 1000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { time: 1060, open: 100, high: 50, low: 95, close: 102, volume: 10 },
    ];
    expect(() => {
      CandleIntegrity.process(corrupt, { from: 1000, to: 1120, timeframeSec: 60, strict: true, allowGaps: true });
    }).toThrow(/invalid candle/i);
  });

  it('standardizes half-open range [from, to) correctly', () => {
    const raw = [
      { time: 1000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { time: 1060, open: 102, high: 108, low: 101, close: 106, volume: 15 },
      { time: 1120, open: 106, high: 109, low: 104, close: 107, volume: 12 },
    ];
    const { validCandles } = CandleIntegrity.process(raw, { from: 1000, to: 1120, timeframeSec: 60, halfOpen: true });
    // Candle at time 1120 is excluded by [1000, 1120)
    expect(validCandles.length).toBe(2);
    expect(validCandles.map(c => c.time)).toEqual([1000, 1060]);
  });
});

describe('Adversarial Audit — Provider Decoupling & Market Source Integrity (Points 10, 11)', () => {
  it('BinanceClient throws error on Futures failure and does NOT silently fallback to Spot', async () => {
    let requestedUrls = [];
    const fetchFn = async (url) => {
      requestedUrls.push(url);
      return { ok: false, status: 500, statusText: 'Internal Server Error' };
    };
    const client = new BinanceClient({ fetchFn, timeoutMs: 1000 });
    await expect(client.fetchCandles({ symbol: 'BTCUSDT', resolution: '1m', start: 1000, end: 2000 })).rejects.toThrow(/Binance API error/);
    // Should NOT have made a request to api.binance.com (spot)
    expect(requestedUrls.some(u => u.startsWith('https://api.binance.com'))).toBe(false);
    expect(requestedUrls.every(u => u.startsWith('https://fapi.binance.com'))).toBe(true);
  });

  it('HistoricalDataManager calls provider.getCandles directly without reaching into provider.client', async () => {
    const mockProvider = {
      getCandles: vi.fn(async () => [
        { time: 1000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
        { time: 1060, open: 102, high: 108, low: 101, close: 106, volume: 15 },
      ]),
    };
    const store = new CandleStore();
    const manager = new HistoricalDataManager({ provider: mockProvider, store });
    const res = await manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 1120 });
    expect(mockProvider.getCandles).toHaveBeenCalled();
    expect(res.candles.length).toBe(2);
  });
});

describe('Adversarial Audit — Multi-Symbol Price Isolation (Point 4)', () => {
  it('does NOT re-price BTC position when an ETH candle arrives', () => {
    const engine = new PaperTradingEngine({ startingBalance: 100000, feeRate: 0 });
    // Initialize BTC price at 50,000
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1000, open: 50000, high: 50100, low: 49900, close: 50000, volume: 1 }, index: 0 });
    engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(engine.getPosition('BTCUSD').entryPrice).toBe(50000);
    expect(engine.getPosition('BTCUSD').currentPrice).toBe(50000);

    // Feed an ETH candle at 3,000
    engine.onMarketCandle({ symbol: 'ETHUSD', candle: { time: 1060, open: 3000, high: 3050, low: 2950, close: 3000, volume: 10 }, index: 1 });

    // BTC position currentPrice must remain 50,000, not 3,000!
    expect(engine.getPosition('BTCUSD').currentPrice).toBe(50000);
    expect(engine.getPosition('BTCUSD').unrealizedPnL).toBe(0);
  });

  it('does NOT trigger pending BTC limit order on ETH candle movements', () => {
    const engine = new PaperTradingEngine({ startingBalance: 100000, feeRate: 0 });
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1000, open: 50000, high: 50100, low: 49900, close: 50000, volume: 1 }, index: 0 });
    // Place BTC BUY limit at 48,000
    const res = engine.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 48000 });
    expect(res.success).toBe(true);

    // Feed an ETH candle with low = 2,500 (which is <= 48,000!)
    engine.onMarketCandle({ symbol: 'ETHUSD', candle: { time: 1060, open: 3000, high: 3100, low: 2500, close: 2800, volume: 10 }, index: 1 });

    // BTC order must still be PENDING!
    expect(engine.getOrder(res.order.id).status).toBe('PENDING');
    expect(engine.getPosition('BTCUSD')).toBeNull();
  });
});

describe('Adversarial Audit — Realistic Gap-Through Execution (Point 5)', () => {
  it('BUY STOP fills at candle open when market gaps above stop in REALISTIC mode', () => {
    const engine = new PaperTradingEngine({ feeRate: 0, executionPolicy: EXECUTION_POLICY.REALISTIC });
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1000, open: 100, high: 105, low: 95, close: 100, volume: 1 }, index: 0 });
    engine.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });

    // Next candle gaps open at 115 (>> stop 105)
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1060, open: 115, high: 120, low: 114, close: 118, volume: 5 }, index: 1 });
    const pos = engine.getPosition('BTCUSD');
    expect(pos).not.toBeNull();
    // Realistic slippage: fills at open (115), not magical 105
    expect(pos.entryPrice).toBe(115);
  });

  it('SELL STOP fills at candle open when market gaps below stop in REALISTIC mode', () => {
    const engine = new PaperTradingEngine({ feeRate: 0, executionPolicy: EXECUTION_POLICY.REALISTIC });
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1000, open: 100, high: 105, low: 95, close: 100, volume: 1 }, index: 0 });
    engine.placeStopOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1, stopPrice: 95 });

    // Next candle gaps open down at 85 (<< stop 95)
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1060, open: 85, high: 88, low: 80, close: 82, volume: 5 }, index: 1 });
    const pos = engine.getPosition('BTCUSD');
    expect(pos).not.toBeNull();
    expect(pos.entryPrice).toBe(85);
  });

  it('BUY LIMIT fills at candle open (price improvement) when market gaps down in REALISTIC mode', () => {
    const engine = new PaperTradingEngine({ feeRate: 0, executionPolicy: EXECUTION_POLICY.REALISTIC });
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1000, open: 100, high: 105, low: 95, close: 100, volume: 1 }, index: 0 });
    engine.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 95 });

    // Next candle opens at 90 (below limit 95)
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1060, open: 90, high: 93, low: 88, close: 91, volume: 5 }, index: 1 });
    const pos = engine.getPosition('BTCUSD');
    expect(pos).not.toBeNull();
    // Price improvement: fills at 90
    expect(pos.entryPrice).toBe(90);
  });

  it('STOP LOSS fills at candle open when market gaps through SL in REALISTIC mode', () => {
    const engine = new PaperTradingEngine({ feeRate: 0, executionPolicy: EXECUTION_POLICY.REALISTIC });
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1000, open: 100, high: 105, low: 95, close: 100, volume: 1 }, index: 0 });
    engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    engine.setStopLoss('BTCUSD', 95);

    // Next candle gaps open down at 88 (below SL 95)
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1060, open: 88, high: 89, low: 80, close: 82, volume: 5 }, index: 1 });
    expect(engine.getPosition('BTCUSD')).toBeNull();
    const trade = engine.getTrades()[0];
    expect(trade.exitPrice).toBe(88);
    expect(trade.exitReason).toBe('STOP_LOSS');
  });
});

describe('Adversarial Audit — Same-Candle Ambiguity Policies (Point 6)', () => {
  const setupBothHit = (policy) => {
    const engine = new PaperTradingEngine({ feeRate: 0, ambiguityPolicy: policy });
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1000, open: 100, high: 105, low: 95, close: 100, volume: 1 }, index: 0 });
    engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    engine.setRisk({ symbol: 'BTCUSD', stopLoss: 90, takeProfit: 110 });
    // Candle 1 spans [85, 115], touching both SL (90) and TP (110)
    return engine;
  };

  it('CONSERVATIVE / SL_FIRST priority: SL wins on conflict', () => {
    const engine = setupBothHit(AMBIGUITY_POLICY.CONSERVATIVE);
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1060, open: 100, high: 115, low: 85, close: 105, volume: 5 }, index: 1 });
    expect(engine.getPosition('BTCUSD')).toBeNull();
    expect(engine.getTrades()[0].exitReason).toBe('STOP_LOSS');
  });

  it('TP_FIRST priority: TP wins on conflict', () => {
    const engine = setupBothHit(AMBIGUITY_POLICY.TP_FIRST);
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1060, open: 100, high: 115, low: 85, close: 105, volume: 5 }, index: 1 });
    expect(engine.getPosition('BTCUSD')).toBeNull();
    expect(engine.getTrades()[0].exitReason).toBe('TAKE_PROFIT');
  });

  it('OPEN_PROXIMITY priority: closer price to open wins', () => {
    const engine = setupBothHit(AMBIGUITY_POLICY.OPEN_PROXIMITY);
    // Open = 108. Distance to TP (110) is 2. Distance to SL (90) is 18. TP is closer!
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1060, open: 108, high: 115, low: 85, close: 105, volume: 5 }, index: 1 });
    expect(engine.getPosition('BTCUSD')).toBeNull();
    expect(engine.getTrades()[0].exitReason).toBe('TAKE_PROFIT');
  });
});

describe('Adversarial Audit — Decoupled Replay Action Guards & Windowed APIs (Points 3, 7, 8)', () => {
  it('action guards cleanly block seek and start without monkey patching methods', () => {
    const engine = new ReplayEngine();
    engine.load([
      { time: 1000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { time: 1060, open: 102, high: 108, low: 101, close: 106, volume: 15 },
      { time: 1120, open: 106, high: 109, low: 104, close: 107, volume: 12 },
    ]);
    engine.start(0);

    let seekBlocked = false;
    const unregister = engine.registerActionGuard((action) => {
      if (action === 'seek') {
        seekBlocked = true;
        return { allowed: false, reason: 'Test block' };
      }
      return { allowed: true };
    });

    engine.seek(2);
    expect(seekBlocked).toBe(true);
    expect(engine.getState().currentIndex).toBe(0); // seek blocked!

    // Unregister guard and seek again
    unregister();
    engine.seek(2);
    expect(engine.getState().currentIndex).toBe(2); // seek permitted!
  });

  it('exposes windowed, context, and revealed candle queries', () => {
    const engine = new ReplayEngine();
    const candles = Array.from({ length: 50 }, (_, i) => ({
      time: 1000 + i * 60,
      open: 100 + i,
      high: 105 + i,
      low: 95 + i,
      close: 102 + i,
      volume: 10,
    }));
    engine.load(candles);
    engine.start(10); // Starts at index 10

    // Context candles (prior to start index)
    const context = engine.getContextCandles();
    expect(context.length).toBe(10);
    expect(context[0].time).toBe(1000);
    expect(context[9].time).toBe(1000 + 9 * 60);

    // Step forward 5 times to index 15
    for (let i = 0; i < 5; i++) engine.stepForward();
    expect(engine.getState().currentIndex).toBe(15);

    // Revealed candles: 10 .. 15 (6 candles)
    const revealed = engine.getRevealedCandles();
    expect(revealed.length).toBe(6);
    expect(revealed[0].time).toBe(1000 + 10 * 60);
    expect(revealed[5].time).toBe(1000 + 15 * 60);

    // Windowed query: visible window of 4 candles
    const window = engine.getVisibleWindow(4);
    expect(window.length).toBe(4);
    expect(window[window.length - 1].time).toBe(1000 + 15 * 60);

    // Current candle
    expect(engine.getCurrentCandle().time).toBe(1000 + 15 * 60);
  });
});

describe('Adversarial Audit — Residual Correctness Hardening (Points 1-6)', () => {
  it('Cache strict-mode bypass: cached gapped data is rejected identically in strict mode', async () => {
    const { CandleCache, CACHE_VERSION } = await import('../src/data/CandleCache.js');
    const cache = new CandleCache({ enableIDB: false });
    // Seed cache with gapped candles: 1000 and 1120 (missing 1060)
    const gappedCandles = [
      { time: 1000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { time: 1120, open: 106, high: 109, low: 104, close: 107, volume: 12 },
    ];
    const key = cache._key('BTCUSD', '1m');
    cache._memory.set(key, {
      candles: gappedCandles,
      intervals: [{ from: 1000, to: 1120 }],
      ts: Date.now(),
      version: CACHE_VERSION,
    });

    const mockProvider = {
      fetchChunk: vi.fn(),
      getCandles: vi.fn(),
    };
    const store = new CandleStore();
    const manager = new HistoricalDataManager({ provider: mockProvider, store, cache, strictMode: true });

    // Loading cached range with strict: true must throw integrity error, NOT bypass strict validation!
    await expect(manager.load({ symbol: 'BTCUSD', timeframe: '1m', from: 1000, to: 1120, strict: true })).rejects.toThrow(/Integrity error.*gap/);
  });

  it('Boundary coverage: detects missing start prefix (PARTIAL_START)', () => {
    // Requested [1000, 1200), but first candle starts at 1060
    const raw = [
      { time: 1060, open: 102, high: 108, low: 101, close: 106, volume: 15 },
      { time: 1120, open: 106, high: 109, low: 104, close: 107, volume: 12 },
    ];
    const res = CandleIntegrity.process(raw, { from: 1000, to: 1180, timeframeSec: 60, halfOpen: true });
    expect(res.metadata.hasStartGap).toBe(true);
    expect(res.metadata.gaps.some(g => g.type === 'PARTIAL_START')).toBe(true);
    expect(res.metadata.coverageType).toContain('PARTIAL_START');

    // Strict mode must reject it
    expect(() => {
      CandleIntegrity.process(raw, { from: 1000, to: 1180, timeframeSec: 60, halfOpen: true, strict: true });
    }).toThrow(/Integrity error.*gap/);
  });

  it('Boundary coverage: detects missing end suffix (PARTIAL_END)', () => {
    // Requested [1000, 1240), but last candle ends at 1120
    const raw = [
      { time: 1000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { time: 1060, open: 102, high: 108, low: 101, close: 106, volume: 15 },
      { time: 1120, open: 106, high: 109, low: 104, close: 107, volume: 12 },
    ];
    const res = CandleIntegrity.process(raw, { from: 1000, to: 1240, timeframeSec: 60, halfOpen: true });
    expect(res.metadata.hasEndGap).toBe(true);
    expect(res.metadata.gaps.some(g => g.type === 'PARTIAL_END')).toBe(true);
    expect(res.metadata.coverageType).toContain('PARTIAL_END');

    // Strict mode must reject it
    expect(() => {
      CandleIntegrity.process(raw, { from: 1000, to: 1240, timeframeSec: 60, halfOpen: true, strict: true });
    }).toThrow(/Integrity error.*gap/);
  });

  it('Unified solvency: identical cash requirement for market, limit, and stop orders under marginRate = 1.0', () => {
    // Starting cash: 50. Price: 100. Qty: 1. Notional: 100.
    const engine = new PaperTradingEngine({ startingBalance: 50, feeRate: 0.001, marginRate: 1.0 });
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1000, open: 100, high: 105, low: 95, close: 100, volume: 1 }, index: 0 });

    // Market order requires 100 * 1.0 + fee = 100.10 > 50 -> REJECT
    const mkt = engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(mkt.success).toBe(false);
    expect(mkt.code).toBe('INSUFFICIENT_CASH');

    // Limit order fill requires 100.10 > 50 -> REJECT fill
    const lmt = engine.placeLimitOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, limitPrice: 95 });
    expect(lmt.success).toBe(true);
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1060, open: 95, high: 96, low: 90, close: 94, volume: 1 }, index: 1 });
    expect(engine.getOrder(lmt.order.id).status).toBe('REJECTED');
    expect(engine.getOrder(lmt.order.id).rejectionReason).toBe('INSUFFICIENT_CASH');

    // Stop order fill requires 100.10 > 50 -> REJECT fill
    const stp = engine.placeStopOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1, stopPrice: 105 });
    expect(stp.success).toBe(true);
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1120, open: 105, high: 110, low: 104, close: 108, volume: 1 }, index: 2 });
    expect(engine.getOrder(stp.order.id).status).toBe('REJECTED');
    expect(engine.getOrder(stp.order.id).rejectionReason).toBe('INSUFFICIENT_CASH');
  });

  it('Unified solvency: marginRate = 0 (unlimited leverage / fee only) uniformly permits all orders', () => {
    // Starting cash: 50. Price: 100. Qty: 1. Notional: 100. Fee = 0.10 <= 50.
    const engine = new PaperTradingEngine({ startingBalance: 50, feeRate: 0.001, marginRate: 0 });
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1000, open: 100, high: 105, low: 95, close: 100, volume: 1 }, index: 0 });

    const mkt = engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(mkt.success).toBe(true);
    expect(engine.getPosition('BTCUSD')).not.toBeNull();
  });

  it('Per-symbol market state: market order uses the exact target symbol price even if another symbol arrived recently', () => {
    const engine = new PaperTradingEngine({ startingBalance: 100000, feeRate: 0 });
    // 1) BTC candle arrives at 50,000
    engine.onMarketCandle({ symbol: 'BTCUSD', candle: { time: 1000, open: 50000, high: 50100, low: 49900, close: 50000, volume: 1 }, index: 0 });

    // 2) ETH candle arrives at 3,000
    engine.onMarketCandle({ symbol: 'ETHUSD', candle: { time: 1060, open: 3000, high: 3050, low: 2950, close: 3000, volume: 10 }, index: 1 });

    // 3) BUY BTC must execute at 50,000 (BTC price), NOT 3,000 (ETH price)!
    const res = engine.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(res.success).toBe(true);
    expect(engine.getPosition('BTCUSD').entryPrice).toBe(50000);
    expect(engine.getPosition('BTCUSD').openedAt).toBe(1000); // BTC candle time, not ETH candle time!

    // 4) BUY ETH executes at 3,000
    const resEth = engine.placeOrder({ symbol: 'ETHUSD', side: 'BUY', quantity: 2 });
    expect(resEth.success).toBe(true);
    expect(engine.getPosition('ETHUSD').entryPrice).toBe(3000);
  });

  it('Provider contract: HistoricalDataManager strictly enforces provider interface', async () => {
    const { CandleCache } = await import('../src/data/CandleCache.js');
    const invalidProvider = { client: { fetchCandles: () => [] } }; // does not have fetchChunk or getCandles
    const manager = new HistoricalDataManager({ provider: invalidProvider, store: new CandleStore(), cache: new CandleCache({ enableIDB: false }) });
    await expect(manager.load({ symbol: 'BTCUSDT', timeframe: '1m', from: 1000, to: 1120 })).rejects.toThrow(/Provider must implement fetchChunk or getCandles/);
  });
});
