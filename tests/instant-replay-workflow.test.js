import { describe, it, expect } from 'vitest';
import { HistoricalDataManager } from '../src/data/HistoricalDataManager.js';
import { CandleCache } from '../src/data/CandleCache.js';
import { CandleStore } from '../src/data/CandleStore.js';
import { DeltaCandleProvider, TIMEFRAME_SECONDS } from '../src/data/DeltaCandleProvider.js';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { AppState } from '../src/state/AppState.js';
import { SymbolSelector } from '../src/ui/SymbolSelector.js';
import { TimeframeSelector } from '../src/ui/TimeframeSelector.js';

describe('Instant Historical Replay Workflow & Persistent Caching', () => {
  it('TIMEFRAME_SECONDS has correct durations for 1m to 1d', () => {
    expect(TIMEFRAME_SECONDS['1m']).toBe(60);
    expect(TIMEFRAME_SECONDS['5m']).toBe(300);
    expect(TIMEFRAME_SECONDS['15m']).toBe(900);
    expect(TIMEFRAME_SECONDS['1h']).toBe(3600);
    expect(TIMEFRAME_SECONDS['4h']).toBe(14400);
    expect(TIMEFRAME_SECONDS['1d']).toBe(86400);
  });

  it('SymbolSelector and TimeframeSelector render expanded standard pairs and resolutions', () => {
    const mockSymbolEl = { innerHTML: '' };
    const mockTfEl = { innerHTML: '' };
    const state = new AppState();
    new SymbolSelector(mockSymbolEl, state);
    new TimeframeSelector(mockTfEl, state);

    expect(mockSymbolEl.innerHTML).toContain('BTCUSD');
    expect(mockSymbolEl.innerHTML).toContain('BTCUSDT');
    expect(mockSymbolEl.innerHTML).toContain('ETHUSD');
    expect(mockSymbolEl.innerHTML).toContain('SOLUSDT');
    expect(mockSymbolEl.innerHTML).toContain('XRPUSDT');

    expect(mockTfEl.innerHTML).toContain('1m');
    expect(mockTfEl.innerHTML).toContain('3m');
    expect(mockTfEl.innerHTML).toContain('5m');
    expect(mockTfEl.innerHTML).toContain('15m');
    expect(mockTfEl.innerHTML).toContain('30m');
    expect(mockTfEl.innerHTML).toContain('1h');
    expect(mockTfEl.innerHTML).toContain('4h');
    expect(mockTfEl.innerHTML).toContain('1d');
  });

  it('Persistent caching preserves fetched candles and returns cached: true without re-downloading', async () => {
    const baseTime = 1700000000;
    const testCandles = Array.from({ length: 100 }, (_, i) => ({
      time: baseTime + i * 60,
      open: 50000 + i,
      high: 50010 + i,
      low: 49990 + i,
      close: 50005 + i,
      volume: 10 + i
    }));

    let fetchCount = 0;
    const mockClient = {
      gridOrigin: baseTime,
      fetchCandles: async () => {
        fetchCount++;
        return testCandles;
      }
    };

    const provider = new DeltaCandleProvider({ client: mockClient });
    const cache = new CandleCache({ enableIDB: false });
    const store = new CandleStore();
    const manager = new HistoricalDataManager({ provider, cache, store });

    // First load -> network fetch
    const res1 = await manager.load({
      symbol: 'BTCUSD',
      timeframe: '1m',
      from: baseTime,
      to: baseTime + 99 * 60
    });

    expect(fetchCount).toBeGreaterThanOrEqual(1);
    expect(res1.candles.length).toBe(100);

    // Reset fetch count to test zero-network cache hit
    const initialFetches = fetchCount;

    // Second load of same range -> served from cache instantly with zero network calls
    const res2 = await manager.load({
      symbol: 'BTCUSD',
      timeframe: '1m',
      from: baseTime,
      to: baseTime + 99 * 60
    });

    expect(fetchCount).toBe(initialFetches);
    expect(res2.candles.length).toBe(100);
    expect(res2.metadata.cached).toBe(true);
  });

  it('ReplayEngine can load candles and cue immediately at the chosen historical timestamp', () => {
    const baseTime = 1700000000;
    const testCandles = Array.from({ length: 50 }, (_, i) => ({
      time: baseTime + i * 60,
      open: 100 + i,
      high: 110 + i,
      low: 95 + i,
      close: 105 + i,
      volume: 1
    }));

    const engine = new ReplayEngine();
    engine.load(testCandles);

    expect(engine.getState().status).toBe('ready');
    expect(engine.getTotalCandles()).toBe(50);

    // Cue at index 20 (representing the selected historical date)
    engine.start(20);
    expect(engine.getState().status).toBe('paused');
    expect(engine.getState().currentIndex).toBe(20);

    // Step forward
    engine.stepForward();
    expect(engine.getState().currentIndex).toBe(21);
  });
});
