import { describe, it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PaperTradingEngine } from '../src/trading/PaperTradingEngine.js';
import { createTradingPresentation } from '../src/app/TradingPresentationAdapter.js';
import { createDatasetView, createCandleView, createReplayStatusView } from '../src/app/DatasetPresentationAdapter.js';
import { TRADING_PRESENTATION_ACTION_NAMES, assertTradingPresentation } from '../src/ports/TradingPresentationPort.js';
import { TradingPanel } from '../src/ui/TradingPanel.js';
import { OrderFormView } from '../src/ui/OrderFormView.js';
import { ReplayDateSelector } from '../src/ui/ReplayDateSelector.js';
import { SymbolSelector } from '../src/ui/SymbolSelector.js';
import { TimeframeSelector } from '../src/ui/TimeframeSelector.js';
import { ModeBanner } from '../src/ui/ModeBanner.js';
import { AppState } from '../src/state/AppState.js';
import { CandleStore } from '../src/data/CandleStore.js';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';

const execFileAsync = promisify(execFile);

function mockEl(initial = {}) {
  const listeners = {};
  const classes = new Set(initial.classes || []);
  return {
    textContent: initial.textContent ?? '',
    innerHTML: initial.innerHTML ?? '',
    value: initial.value ?? '',
    className: initial.className ?? '',
    disabled: initial.disabled ?? false,
    dataset: { ...(initial.dataset || {}) },
    classList: {
      add(cls) { classes.add(cls); },
      remove(cls) { classes.delete(cls); },
      toggle(cls, force) {
        if (force === undefined) { if (classes.has(cls)) classes.delete(cls); else classes.add(cls); }
        else if (force) classes.add(cls);
        else classes.delete(cls);
      },
      contains(cls) { return classes.has(cls); },
    },
    addEventListener(e, h) { (listeners[e] = listeners[e] || []).push(h); },
    removeEventListener() {},
    dispatchEvent(e) { (listeners[e.type || e] || []).forEach((h) => h(e)); },
    click() { (listeners.click || []).forEach((h) => h({ type: 'click' })); },
    getAttribute(n) { return initial[n] ?? null; },
    setAttribute(n, v) { initial[n] = v; },
    ...initial,
  };
}

describe('Presentation boundary', () => {
  it('dependency graph stays green with the hardened ui boundary', async () => {
    const { stdout } = await execFileAsync(process.execPath, ['scripts/check-architecture.mjs']);
    expect(stdout).toContain('Architecture dependency graph: PASS');
  });

  it('narrow trading presentation exposes intent-shaped actions and frozen snapshots', () => {
    const engine = new PaperTradingEngine({ startingBalance: 10000 });
    const trading = createTradingPresentation(engine);
    expect(Object.isFrozen(trading)).toBe(true);
    expect(Object.isFrozen(trading.actions)).toBe(true);
    expect(Object.keys(trading.actions).sort()).toEqual([...TRADING_PRESENTATION_ACTION_NAMES].sort());
    expect(assertTradingPresentation(trading)).toBe(trading);
    // Engine-shaped surface is gone: no placeOrder/getAccountSnapshot on the port.
    expect(trading).not.toHaveProperty('placeOrder');
    expect(trading).not.toHaveProperty('getAccountSnapshot');
    const snap = trading.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap).toHaveProperty('account');
    expect(snap).toHaveProperty('markPrice');
    engine.destroy?.();
  });

  it('presentation snapshots are immutable view models', () => {
    const engine = new PaperTradingEngine({ startingBalance: 10000 });
    const trading = createTradingPresentation(engine);
    const snap = trading.snapshot();
    expect(() => { snap.account = null; }).toThrow();
    expect(Object.isFrozen(snap.positions)).toBe(true);
    engine.destroy?.();
  });

  it('dataset/candle/status adapters project stores into frozen views', () => {
    const store = new CandleStore();
    store.load([{ time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 }]);
    const appState = new AppState();
    appState.setCandleStore(store);
    const dataset = createDatasetView(appState);
    expect(Object.isFrozen(dataset)).toBe(true);
    const datasetSnap = dataset.snapshot();
    expect(Object.isFrozen(datasetSnap)).toBe(true);
    expect(datasetSnap.symbol).toBe('BTCUSDT');
    appState.symbol = 'ETHUSDT';
    expect(dataset.snapshot().symbol).toBe('ETHUSDT');
    expect(datasetSnap.symbol).toBe('BTCUSDT');
    const candles = createCandleView(store);
    expect(candles.getCount()).toBe(1);
    const replay = new ReplayEngine();
    const statusView = createReplayStatusView({ engine: replay, appState, candleStore: store });
    const status = statusView.snapshot();
    expect(Object.isFrozen(status)).toBe(true);
    expect(status.total).toBe(1);
    expect(typeof status.candleAt).toBe('function');
    replay.destroy();
  });

  it('UI constructors reject engine-shaped objects (no compat escape hatch)', () => {
    const engineShaped = {
      getAccountSnapshot: () => null,
      getPositions: () => [],
      placeOrder: () => ({ success: true }),
      on: () => {},
    };
    expect(() => new TradingPanel({ trading: engineShaped })).toThrow(TypeError);
    expect(() => new OrderFormView({ trading: engineShaped })).toThrow(TypeError);
  });

  it('TradingPanel is written against the narrow contract, not engine-shaped APIs', () => {
    global.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
    try {
      const engine = new PaperTradingEngine({ startingBalance: 10000, feeRate: 0 });
      const trading = createTradingPresentation(engine);
      const mkEl = () => mockEl();
      const panel = new TradingPanel({
        trading,
        balanceEl: mkEl(), equityEl: mkEl(), realizedEl: mkEl(), unrealizedEl: mkEl(), feesEl: mkEl(),
        posSymbolEl: mkEl(), posSideEl: mkEl(), posQtyEl: mkEl(), posEntryEl: mkEl(),
        posCurrentEl: mkEl(), posPnlEl: mkEl(),
        qtyInput: mkEl({ value: '1' }), buyBtn: mkEl(), sellBtn: mkEl(), closeBtn: mkEl(), resetBtn: mkEl(),
        tradesListEl: mkEl(), errorEl: mkEl(),
        orderTypeSelect: mkEl({ value: 'MARKET' }), limitPriceInput: mkEl(), stopPriceInput: mkEl(),
        pendingListEl: mkEl(), posSlEl: mkEl(), posTpEl: mkEl(), slInput: mkEl(), tpInput: mkEl(),
        setRiskBtn: mkEl(), clearRiskBtn: mkEl(),
      });
      expect(panel.trading).toBe(trading);
      expect(panel).not.toHaveProperty('engine');
      panel.render();
      engine.destroy?.();
    } finally {
      delete global.document;
    }
  });

  it('OrderFormView submits through intent-shaped actions', () => {
    global.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
    try {
      const actions = {
        submitMarketOrder: vi.fn(() => ({ success: true })),
        submitLimitOrder: vi.fn(() => ({ success: true })),
        submitStopOrder: vi.fn(() => ({ success: true })),
      };
      const trading = Object.freeze({
        snapshot: () => Object.freeze({
          account: null, positions: [], pendingOrders: [], orders: [], trades: [],
          stats: {}, hasMarket: true, markPrice: 50000,
        }),
        actions: Object.freeze({ ...actions, flattenPosition: vi.fn(), updateRisk: vi.fn(), setStopLoss: vi.fn(), setTakeProfit: vi.fn(), clearRisk: vi.fn(), cancelOrder: vi.fn(), resetAccount: vi.fn(), setCapital: vi.fn(), setFeeRate: vi.fn(), hasOpenPosition: () => false }),
        events: {}, on: vi.fn(),
      });
      const view = new OrderFormView({
        trading, qtyInput: mockEl({ value: '2' }), buyBtn: mockEl(),
        orderTypeSelect: mockEl({ value: 'MARKET' }), getSymbol: () => 'ETHUSDT',
      });
      view.placeOrder('BUY');
      expect(actions.submitMarketOrder).toHaveBeenCalledWith({ symbol: 'ETHUSDT', side: 'BUY', quantity: 2 });
    } finally {
      delete global.document;
    }
  });

  it('ReplayDateSelector drives replay through capability callbacks only', () => {
    const chip = mockEl({ dataset: { preset: '1d' } });
    const onLoadReplay = vi.fn();
    const onSeek = vi.fn();
    const replay = { getState: vi.fn(() => ({ status: 'paused', currentIndex: 0 })) };
    const selector = new ReplayDateSelector({
      dataset: { symbol: 'BTCUSDT', timeframe: '1m' },
      candles: { getCount: () => 10, get: () => null, getAll: () => [], findIndexByTime: () => 4 },
      replay, onLoadReplay, onSeek,
      presetChips: [chip], replayDateEl: mockEl(), replayTimeEl: mockEl(),
      jumpDateEl: mockEl({ value: '2024-01-01' }), jumpTimeEl: mockEl({ value: '00:00' }),
      jumpBtn: null, jumpErrorEl: mockEl(),
    });
    expect(selector).not.toHaveProperty('coordinator');
    selector.selectPreset('1d');
    expect(onLoadReplay).toHaveBeenCalledWith(expect.objectContaining({ autoStart: false }));
    selector.handleJump();
    expect(onSeek).toHaveBeenCalledWith(4);
  });

  it('selectors render from dataset views instead of AppState', () => {
    const selectEl = mockEl();
    const symbols = new SymbolSelector(selectEl, { symbol: 'ETHUSDT' }, ['BTCUSDT', 'ETHUSDT']);
    expect(selectEl.innerHTML).toContain('ETHUSDT');
    const tfEl = mockEl();
    const timeframes = new TimeframeSelector(tfEl, { timeframe: '5m' }, ['1m', '5m']);
    expect(tfEl.innerHTML).toContain('5m');
    expect(symbols).toBeDefined();
    expect(timeframes).toBeDefined();
  });

  it('ModeBanner renders from a frozen status view', () => {
    const progressText = mockEl(), progressPct = mockEl();
    const banner = new ModeBanner({
      modeBanner: { className: '', classList: { add() {}, remove() {} }, setAttribute: () => {} },
      modeIndicator: mockEl(), progressPanel: mockEl(), progressText, progressPct,
      marketTimeEl: mockEl(), marketTimeFull: mockEl(), srTicker: mockEl(),
      overlay: mockEl(), overlayText: mockEl(),
    });
    banner.update({ total: 100, status: 'paused', loadingState: 'IDLE', pendingStartIndex: 0, currentIndex: 9, candleAt: () => ({ time: 1000 }) });
    expect(progressText.textContent).toMatch(/BAR 10 \/ 100/);
  });
});
