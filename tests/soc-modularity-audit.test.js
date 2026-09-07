import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TradingIntentResolver } from '../src/trading/TradingIntentResolver.js';
import { ChartTradingOverlay } from '../src/chart/ChartTradingOverlay.js';
import { PaperTradingEngine } from '../src/trading/PaperTradingEngine.js';
import { TradingEvents } from '../src/trading/TradingEvents.js';
import { ReplayCommandController } from '../src/app/ReplayCommandController.js';
import { ToastNotificationView } from '../src/ui/ToastNotificationView.js';
import { FloatingPositionView } from '../src/ui/FloatingPositionView.js';
import { ReplayDateSelector } from '../src/ui/ReplayDateSelector.js';
import { createTradingPresentation } from '../src/app/TradingPresentationAdapter.js';
import { AppState } from '../src/state/AppState.js';
import { Order, ORDER_STATUSES } from '../src/trading/Order.js';
import { FundingManager } from '../src/trading/FundingManager.js';

function createMockElement(initial = {}) {
  const classes = new Set(initial.classes || []);
  const listeners = {};
  return {
    textContent: initial.textContent ?? '',
    innerHTML: initial.innerHTML ?? '',
    value: initial.value ?? '',
    className: initial.className ?? '',
    dataset: { ...(initial.dataset || {}) },
    disabled: initial.disabled ?? false,
    classList: {
      add(cls) { classes.add(cls); },
      remove(cls) { classes.delete(cls); },
      toggle(cls, force) {
        if (force === undefined) {
          if (classes.has(cls)) classes.delete(cls);
          else classes.add(cls);
        } else if (force) classes.add(cls);
        else classes.delete(cls);
      },
      contains(cls) { return classes.has(cls); },
    },
    addEventListener(event, handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    removeEventListener(event, handler) {
      if (listeners[event]) listeners[event] = listeners[event].filter(h => h !== handler);
    },
    dispatchEvent(event) {
      const handlers = listeners[event.type || event] || [];
      handlers.forEach(h => h(event));
    },
    click() {
      const handlers = listeners['click'] || [];
      handlers.forEach(h => h({ type: 'click' }));
    },
    ...initial,
  };
}

describe('SoC and Modularity Deep Audit Verification', () => {
  describe('1. TradingIntentResolver & ChartTradingOverlay Decoupling', () => {
    it('TradingIntentResolver correctly resolves Long TP and SL', () => {
      const activePos = { symbol: 'BTCUSDT', side: 'LONG', entryPrice: 50000 };
      const tp = TradingIntentResolver.resolveClickIntent(52000, activePos);
      expect(tp).toEqual({ action: 'SET_TP', price: 52000, isTP: true, symbol: 'BTCUSDT' });
      const sl = TradingIntentResolver.resolveClickIntent(48000, activePos);
      expect(sl).toEqual({ action: 'SET_SL', price: 48000, isTP: false, symbol: 'BTCUSDT' });
    });
    it('TradingIntentResolver correctly resolves Short TP and SL', () => {
      const activePos = { symbol: 'BTCUSDT', side: 'SHORT', entryPrice: 50000 };
      const tp = TradingIntentResolver.resolveClickIntent(47000, activePos);
      expect(tp).toEqual({ action: 'SET_TP', price: 47000, isTP: true, symbol: 'BTCUSDT' });
      const sl = TradingIntentResolver.resolveClickIntent(53000, activePos);
      expect(sl).toEqual({ action: 'SET_SL', price: 53000, isTP: false, symbol: 'BTCUSDT' });
    });
    it('TradingIntentResolver returns PRICE_SELECT when no position is open', () => {
      const intent = TradingIntentResolver.resolveClickIntent(65000, null);
      expect(intent).toEqual({ action: 'PRICE_SELECT', price: 65000 });
    });
    it('TradingIntentResolver returns null for non-positive or invalid prices', () => {
      expect(TradingIntentResolver.resolveClickIntent(0, null)).toBeNull();
      expect(TradingIntentResolver.resolveClickIntent(-10, null)).toBeNull();
      expect(TradingIntentResolver.resolveClickIntent(NaN, null)).toBeNull();
    });
    it('ChartTradingOverlay delegates resolveClickIntent to TradingIntentResolver', () => {
      const overlay = new ChartTradingOverlay();
      const pos = { symbol: 'ETHUSDT', side: 'LONG', entryPrice: 3000 };
      const res = overlay.resolveClickIntent(3200, pos);
      expect(res.action).toBe('SET_TP');
      expect(res.isTP).toBe(true);
      expect(res.symbol).toBe('ETHUSDT');
    });
  });

  describe('2. PaperTradingEngine Public rejectIntent API', () => {
    it('exposes rejectIntent as a public method and emits ORDER_REJECTED event', () => {
      const engine = new PaperTradingEngine({ startingBalance: 10000 });
      const onRejected = vi.fn();
      engine.on(TradingEvents.ORDER_REJECTED, onRejected);
      const res = engine.rejectIntent('CUSTOM_ERROR', 'Intent cannot be fulfilled');
      expect(res.success).toBe(false);
      expect(res.code).toBe('CUSTOM_ERROR');
      expect(res.message).toBe('Intent cannot be fulfilled');
      expect(onRejected).toHaveBeenCalledTimes(1);
      expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ code: 'CUSTOM_ERROR', message: 'Intent cannot be fulfilled' }));
    });
  });

  describe('3. ReplayCommandController', () => {
    let mockEngine, mockAppState, mockCandleStore, mockTradingEngine, mockCoordinator, headerBtn, controller;
    beforeEach(() => {
      mockEngine = {
        _state: { status: 'ready', currentIndex: 0 },
        getState: vi.fn(function() { return this._state; }),
        start: vi.fn(function() { this._state.status = 'playing'; }),
        play: vi.fn(function() { this._state.status = 'playing'; }),
        pause: vi.fn(function() { this._state.status = 'paused'; }),
        reset: vi.fn(function() { this._state.status = 'ready'; }),
        stepForward: vi.fn(), seek: vi.fn(), on: vi.fn(),
      };
      mockAppState = { pendingStartIndex: 10, candles: [{ time: 1000 }] };
      mockCandleStore = { getCount: vi.fn(() => 100) };
      mockTradingEngine = { hasOpenPosition: vi.fn(() => false) };
      mockCoordinator = { loadAndPrepareReplay: vi.fn(), updatePreviewWindow: vi.fn(), showTradingError: vi.fn() };
      headerBtn = createMockElement();
      controller = new ReplayCommandController({ engine: mockEngine, appState: mockAppState, candleStore: mockCandleStore, tradingEngine: mockTradingEngine, coordinator: mockCoordinator, headerBtn });
    });
    it('renders initial header button text based on engine status', () => expect(headerBtn.innerHTML).toContain('START REPLAY'));
    it('togglePlayPause starts engine from pendingStartIndex when status is ready', () => { controller.togglePlayPause(); expect(mockEngine.start).toHaveBeenCalledWith(10); expect(mockEngine.play).toHaveBeenCalledTimes(1); });
    it('togglePlayPause pauses engine when status is playing', () => { mockEngine._state.status = 'playing'; controller.togglePlayPause(); expect(mockEngine.pause).toHaveBeenCalledTimes(1); });
    it('togglePlayPause plays engine when status is paused', () => { mockEngine._state.status = 'paused'; controller.togglePlayPause(); expect(mockEngine.play).toHaveBeenCalledTimes(1); });
    it('trySeek blocks seek and emits error when position is open', () => { mockTradingEngine.hasOpenPosition.mockReturnValue(true); expect(controller.trySeek(25)).toBe(false); expect(mockEngine.seek).not.toHaveBeenCalled(); expect(mockCoordinator.showTradingError).toHaveBeenCalledWith(expect.stringContaining('Cannot seek while a position is open')); });
    it('trySeek executes seek when no position is open', () => { expect(controller.trySeek(25)).toBe(true); expect(mockEngine.seek).toHaveBeenCalledWith(25); });
    it('binds keyboard shortcuts (Space, ArrowRight, KeyR, Escape)', () => { const mockDoc = createMockElement(); const unbind = controller.bindKeyboardShortcuts(mockDoc); const spaceEvent = { type: 'keydown', code: 'Space', preventDefault: vi.fn(), target: {} }; mockDoc.dispatchEvent(spaceEvent); expect(spaceEvent.preventDefault).toHaveBeenCalled(); expect(mockEngine.start).toHaveBeenCalled(); const stepEvent = { type: 'keydown', code: 'ArrowRight', preventDefault: vi.fn(), target: {} }; mockDoc.dispatchEvent(stepEvent); expect(mockEngine.stepForward).toHaveBeenCalled(); unbind(); });
    it('ArrowLeft steps one candle back via guarded seek', () => { mockEngine._state.status = 'paused'; mockEngine._state.currentIndex = 5; const mockDoc = createMockElement(); const unbind = controller.bindKeyboardShortcuts(mockDoc); mockDoc.dispatchEvent({ type: 'keydown', code: 'ArrowLeft', preventDefault: vi.fn(), target: {} }); expect(mockEngine.seek).toHaveBeenCalledWith(4); unbind(); });
    it('Shift+arrows jump ±10 candles clamped to bounds', () => { mockEngine._state.status = 'paused'; mockEngine._state.currentIndex = 50; mockEngine.getTotalCandles = vi.fn(() => 100); const mockDoc = createMockElement(); const unbind = controller.bindKeyboardShortcuts(mockDoc); mockDoc.dispatchEvent({ type: 'keydown', code: 'ArrowRight', shiftKey: true, preventDefault: vi.fn(), target: {} }); expect(mockEngine.seek).toHaveBeenCalledWith(60); mockEngine._state.currentIndex = 3; mockDoc.dispatchEvent({ type: 'keydown', code: 'ArrowLeft', shiftKey: true, preventDefault: vi.fn(), target: {} }); expect(mockEngine.seek).toHaveBeenCalledWith(0); unbind(); });
    it('stepBackward is blocked while a position is open', () => { mockEngine._state.status = 'paused'; mockEngine._state.currentIndex = 5; mockTradingEngine.hasOpenPosition.mockReturnValue(true); expect(controller.stepBackward()).toBe(false); expect(mockEngine.seek).not.toHaveBeenCalled(); });
    it('KeyX/KeyZ cycle playback speed through notches', () => { mockEngine._state.speed = 1; mockEngine.setSpeed = vi.fn(function(s) { this._state.speed = s; }); const mockDoc = createMockElement(); const unbind = controller.bindKeyboardShortcuts(mockDoc); mockDoc.dispatchEvent({ type: 'keydown', code: 'KeyX', preventDefault: vi.fn(), target: {} }); expect(mockEngine.setSpeed).toHaveBeenCalledWith(2); mockDoc.dispatchEvent({ type: 'keydown', code: 'KeyZ', preventDefault: vi.fn(), target: {} }); expect(mockEngine.setSpeed).toHaveBeenCalledWith(1); unbind(); });
  });

  describe('4. ToastNotificationView', () => {
    it('shows message and hides after duration', () => {
      vi.useFakeTimers();
      const toastEl = createMockElement({ classes: ['hidden'] });
      const view = new ToastNotificationView(toastEl, 1000);
      view.show('Order executed');
      expect(toastEl.textContent).toBe('Order executed');
      expect(toastEl.classList.contains('hidden')).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(toastEl.classList.contains('hidden')).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('5. FloatingPositionView', () => {
    it('hides container when position is null', () => {
      const container = createMockElement();
      const view = new FloatingPositionView({ container });
      view.render(null);
      expect(container.classList.contains('hidden')).toBe(true);
    });
    it('renders position badge and PnL when position exists', () => {
      const container = createMockElement({ classes: ['hidden'] });
      const badgeEl = createMockElement(); const entryEl = createMockElement(); const pnlEl = createMockElement(); const closeBtn = createMockElement();
      const mockTrading = { closePosition: vi.fn(), getPositions: vi.fn(() => [{ symbol: 'BTCUSDT' }]) };
      const view = new FloatingPositionView({ trading: createTradingPresentation(mockTrading), container, badgeEl, entryEl, pnlEl, closeBtn });
      view.render({ symbol: 'BTCUSDT', side: 'LONG', quantity: 0.5, entryPrice: 65000, unrealizedPnL: 150.25 });
      expect(container.classList.contains('hidden')).toBe(false);
      expect(badgeEl.textContent).toBe('LONG 0.5');
      expect(badgeEl.className).toBe('chart-pos-badge pos-long');
      expect(entryEl.textContent).toBe('@ $65000.00');
      expect(pnlEl.textContent).toBe('+$150.25');
      expect(pnlEl.className).toBe('chart-pos-pnl pnl-pos');
      closeBtn.click();
      expect(mockTrading.closePosition).toHaveBeenCalledWith('BTCUSDT');
    });
  });

  describe('6. ReplayDateSelector', () => {
    it('sets preset and triggers the load capability (no coordinator reference)', () => {
      const chip1d = createMockElement({ dataset: { preset: '1d' } });
      const chip3d = createMockElement({ dataset: { preset: '3d' } });
      const onLoadReplay = vi.fn();
      const replayDateEl = createMockElement();
      const replayTimeEl = createMockElement();
      const replayPort = { getState: vi.fn(() => ({ currentIndex: 0, totalCandles: 0 })), getTotalCandles: vi.fn(() => 0) };
      const selector = new ReplayDateSelector({ dataset: { symbol: 'BTCUSDT', timeframe: '1m' }, candles: { getCount: () => 0, get: () => null, getAll: () => [], findIndexByTime: () => -1 }, replay: replayPort, onLoadReplay, presetChips: [chip1d, chip3d], replayDateEl, replayTimeEl });
      selector.selectPreset('3d');
      expect(chip3d.classList.contains('active')).toBe(true);
      expect(chip1d.classList.contains('active')).toBe(false);
      expect(onLoadReplay).toHaveBeenCalledWith(expect.objectContaining({ autoStart: false }));
      expect(selector).not.toHaveProperty('coordinator');
    });
  });

  describe('7. AppState Memory & O(1) Allocation Optimization', () => {
    it('totalCandles and snapshot() use store.getCount() without calling store.getAll()', () => {
      const appState = new AppState();
      const mockStore = { getCount: vi.fn(() => 50000), getAll: vi.fn(() => [{ time: 1 }]), get: vi.fn(idx => ({ time: idx * 60 })), sliceWindow: vi.fn((s, e) => [{ time: s }]) };
      appState.setCandleStore(mockStore);
      mockStore.getAll.mockClear();
      expect(appState.totalCandles).toBe(50000);
      expect(mockStore.getCount).toHaveBeenCalled();
      expect(mockStore.getAll).not.toHaveBeenCalled();
      const snap = appState.snapshot();
      expect(snap.total).toBe(50000);
      expect(mockStore.getAll).not.toHaveBeenCalled();
      const c = appState.getCandle(5);
      expect(c).toEqual({ time: 300 });
      expect(mockStore.get).toHaveBeenCalledWith(5);
      const win = appState.sliceWindow(0, 10);
      expect(win).toEqual([{ time: 0 }]);
      expect(mockStore.sliceWindow).toHaveBeenCalledWith(0, 10);
    });
  });

  describe('8. Order State Machine Transition Invariants', () => {
    it('fills pending order and updates fields correctly', () => {
      const order = new Order({ id: 1, symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: 1, status: ORDER_STATUSES.PENDING });
      order.fill({ filledPrice: 50000, filledAt: 1700000000, entryFee: 25 });
      expect(order.status).toBe(ORDER_STATUSES.FILLED);
      expect(order.filledPrice).toBe(50000);
      expect(order.filledAt).toBe(1700000000);
      expect(order.entryFee).toBe(25);
    });
    it('rejects pending order and sets rejection reason', () => {
      const order = new Order({ id: 2, symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 1 });
      order.reject('INSUFFICIENT_CASH');
      expect(order.status).toBe(ORDER_STATUSES.REJECTED);
      expect(order.rejectionReason).toBe('INSUFFICIENT_CASH');
    });
    it('cancels pending order and sets cancel reason', () => {
      const order = new Order({ id: 3, symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: 1 });
      order.cancel('USER_CANCEL');
      expect(order.status).toBe(ORDER_STATUSES.CANCELLED);
      expect(order.cancelReason).toBe('USER_CANCEL');
    });
    it('throws error when trying to fill an order that is not PENDING', () => {
      const order = new Order({ id: 4, symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: 1 });
      order.cancel('CANCELLED');
      expect(() => order.fill({ filledPrice: 50000, filledAt: 100 })).toThrow(/status is CANCELLED, expected PENDING/);
    });
  });

  describe('9. FundingManager Mark Price Interpolation', () => {
    it('interpolates linearly between previous and current candle closes', () => {
      const funding = new FundingManager();
      const pos = { symbol: 'BTCUSDT', side: 'LONG', quantity: 1, entryPrice: 50000, currentPrice: 50000 };
      const previousMarket = { timestamp: 1000, candle: { close: 50000 } };
      const currentCandle = { time: 2000, close: 60000 };
      const markMid = funding.interpolateMarkPrice({ position: pos, timestamp: 1500, previousMarket, currentCandle });
      expect(markMid).toBe(55000);
      const markQuarter = funding.interpolateMarkPrice({ position: pos, timestamp: 1250, previousMarket, currentCandle });
      expect(markQuarter).toBe(52500);
    });
    it('clamps to endpoints if timestamp is beyond interval range', () => {
      const funding = new FundingManager();
      const pos = { symbol: 'BTCUSDT', side: 'LONG', quantity: 1, entryPrice: 50000 };
      const previousMarket = { timestamp: 1000, candle: { close: 50000 } };
      const currentCandle = { time: 2000, close: 60000 };
      expect(funding.interpolateMarkPrice({ position: pos, timestamp: 900, previousMarket, currentCandle })).toBe(50000);
      expect(funding.interpolateMarkPrice({ position: pos, timestamp: 2500, previousMarket, currentCandle })).toBe(60000);
    });
    it('returns null if position is null', () => {
      const funding = new FundingManager();
      expect(funding.interpolateMarkPrice({ position: null, timestamp: 1000 })).toBeNull();
    });
  });
});
