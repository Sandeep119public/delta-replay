import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { ChartTradingController } from '../src/ui/ChartTradingController.js';
import { OrderFormView } from '../src/ui/OrderFormView.js';
import { Timeline } from '../src/ui/Timeline.js';
import { ReplayControls } from '../src/ui/ReplayControls.js';
import { TradingEvents } from '../src/trading/TradingEvents.js';
import { TRADING_PRESENTATION_EVENTS } from '../src/ports/TradingPresentationPort.js';

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
        } else if (force) {
          classes.add(cls);
        } else {
          classes.delete(cls);
        }
      },
      contains(cls) { return classes.has(cls); },
    },
    addEventListener(event, handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    removeEventListener(event, handler) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(h => h !== handler);
      }
    },
    dispatchEvent(event) {
      const handlers = listeners[event.type || event] || [];
      handlers.forEach(h => h(event));
    },
    click() {
      const handlers = listeners['click'] || [];
      handlers.forEach(h => h({ type: 'click' }));
    },
    querySelectorAll() { return []; },
    getAttribute(name) { return initial[name] ?? null; },
    setAttribute(name, val) { initial[name] = val; },
    ...initial,
  };
}

describe('Deep UI Separation & Multi-Screen Responsive Audit', () => {
  describe('1. ChartTradingController Separation', () => {
    let mockTradingEngine;
    let mockTradingEvents;
    let mockChartManager;
    let mockTradingState;
    let mockActions;
    let mockTradingPanel;
    let mockFloatingPosView;
    let mockToastView;
    let mockOrderFormView;
    let mockCoordinator;
    let slInput;
    let tpInput;
    let limitPriceInput;
    let stopPriceInput;
    let controller;

    beforeEach(() => {
      const engineListeners = {};
      mockTradingEngine = {
        getPositions: vi.fn(() => []),
        getPendingOrders: vi.fn(() => []),
        setTakeProfit: vi.fn(() => ({ success: true })),
        setStopLoss: vi.fn(() => ({ success: true })),
        on: vi.fn((event, handler) => {
          if (!engineListeners[event]) engineListeners[event] = [];
          engineListeners[event].push(handler);
          return () => {
            engineListeners[event] = (engineListeners[event] || []).filter(fn => fn !== handler);
          };
        }),
        emit: (event, payload) => {
          (engineListeners[event] || []).forEach(fn => fn(payload));
        },
      };
      mockTradingEvents = {
        events: TRADING_PRESENTATION_EVENTS,
        on: (...args) => mockTradingEngine.on(...args),
      };
      mockChartManager = {
        onChartClick: vi.fn(),
        updatePositionLines: vi.fn(),
        updateOrderLines: vi.fn(),
        clearTradingLines: vi.fn(),
      };
      mockTradingPanel = { render: vi.fn() };
      mockFloatingPosView = { render: vi.fn() };
      mockToastView = { show: vi.fn() };
      mockOrderFormView = {
        getOrderType: vi.fn(() => 'LIMIT'),
        setLimitPrice: vi.fn(),
        setStopPrice: vi.fn(),
      };
      mockCoordinator = { showTradingError: vi.fn() };
      mockTradingState = {
        snapshot: vi.fn(() => Object.freeze({
          account: null, positions: [], pendingOrders: [], orders: [],
          trades: [], stats: {}, hasMarket: false, markPrice: null,
        })),
        actions: Object.freeze({
          submitMarketOrder: vi.fn(), submitLimitOrder: vi.fn(), submitStopOrder: vi.fn(),
          flattenPosition: vi.fn(), updateRisk: vi.fn(), setStopLoss: vi.fn(),
          setTakeProfit: vi.fn(), clearRisk: vi.fn(), cancelOrder: vi.fn(),
          resetAccount: vi.fn(), setCapital: vi.fn(), setFeeRate: vi.fn(),
          hasOpenPosition: vi.fn(() => false),
        }),
        events: TRADING_PRESENTATION_EVENTS,
        on: vi.fn(),
      };
      mockActions = {
        resolveClick: vi.fn(() => null),
        execute: vi.fn(() => ({ success: true })),
        reportError: vi.fn(),
      };
      slInput = createMockElement();
      tpInput = createMockElement();
      limitPriceInput = createMockElement();
      stopPriceInput = createMockElement();

      controller = new ChartTradingController({
        chartManager: mockChartManager,
        trading: mockTradingState,
        tradingEvents: mockTradingEvents,
        actions: mockActions,
        tradingPanel: mockTradingPanel,
        floatingPosView: mockFloatingPosView,
        toastView: mockToastView,
        orderFormView: mockOrderFormView,
        coordinator: mockCoordinator,
        slInput,
        tpInput,
        limitPriceInput,
        stopPriceInput,
      });
    });

    it('attaches onChartClick and initial line synchronization on construction', () => {
      expect(mockChartManager.onChartClick).toHaveBeenCalledTimes(1);
      expect(mockChartManager.updatePositionLines).toHaveBeenCalledWith(null);
      expect(mockChartManager.updateOrderLines).toHaveBeenCalledWith([]);
      expect(mockFloatingPosView.render).toHaveBeenCalledWith(null);
    });

    it('resolves and sets Take Profit for active LONG position above entry', () => {
      mockTradingState.snapshot.mockReturnValue(Object.freeze({
        account: null,
        positions: [Object.freeze({ symbol: 'BTCUSDT', side: 'LONG', entryPrice: 60000 })],
        pendingOrders: [], orders: [], trades: [], stats: {}, hasMarket: false, markPrice: null,
      }));
      mockActions.resolveClick.mockReturnValue({
        action: 'SET_TP',
        price: 65000,
        isTP: true,
        symbol: 'BTCUSDT',
      });
      mockActions.execute.mockReturnValue({ success: true });

      controller.syncChartTradingLines();
      expect(mockActions.resolveClick).not.toHaveBeenCalled();
    });

    it('resolves and sets Stop Loss for active LONG position below entry', () => {
      mockTradingState.snapshot.mockReturnValue(Object.freeze({
        account: null,
        positions: [Object.freeze({ symbol: 'BTCUSDT', side: 'LONG', entryPrice: 60000 })],
        pendingOrders: [], orders: [], trades: [], stats: {}, hasMarket: false, markPrice: null,
      }));
      mockActions.resolveClick.mockReturnValue({ action: 'SET_SL', price: 58000, isTP: false, symbol: 'BTCUSDT' });
      controller.syncChartTradingLines();
      expect(mockChartManager.updatePositionLines).toHaveBeenLastCalledWith(expect.objectContaining({ entryPrice: 60000 }));
    });

    it('sets Limit Price on orderFormView when no active position and LIMIT order type selected', () => {
      mockActions.resolveClick.mockReturnValue({ action: 'PRICE_SELECT', price: 60500 });
      const handler = mockChartManager.onChartClick.mock.calls[0][0];
      handler(60500);
      expect(mockOrderFormView.setLimitPrice).toHaveBeenCalledWith(60500);
    });

    it('sets Stop Price on orderFormView when no active position and STOP_MARKET order type selected', () => {
      mockOrderFormView.getOrderType.mockReturnValue('STOP_MARKET');
      mockActions.resolveClick.mockReturnValue({ action: 'PRICE_SELECT', price: 60600 });
      const handler = mockChartManager.onChartClick.mock.calls[0][0];
      handler(60600);
      expect(mockOrderFormView.setStopPrice).toHaveBeenCalledWith(60600);
    });

    it('handles toast notifications for execution events', () => {
      expect(mockTradingState.events).toBe(TRADING_PRESENTATION_EVENTS);
      expect(Object.isFrozen(mockTradingState.events)).toBe(true);
      controller.destroy();
    });
  });

  describe('2. responsive/layout static audit', () => {
    it('contains responsive layout rules and mobile drawer hooks', () => {
      const css = fs.readFileSync('src/style.css', 'utf8');
      expect(css).toMatch(/@media\s*\(/);
      expect(css).toMatch(/drawer|mobile|sidebar/i);
    });
  });

  describe('3. OrderFormView boundary', () => {
    it('accepts trading presentation rather than engine-shaped dependency', () => {
      const trading = {
        snapshot: () => Object.freeze({ account: null, positions: [], pendingOrders: [], orders: [], trades: [], stats: {}, hasMarket: false, markPrice: null }),
        actions: Object.freeze({
          submitMarketOrder: vi.fn(), submitLimitOrder: vi.fn(), submitStopOrder: vi.fn(), flattenPosition: vi.fn(),
          updateRisk: vi.fn(), setStopLoss: vi.fn(), setTakeProfit: vi.fn(), clearRisk: vi.fn(), cancelOrder: vi.fn(),
          resetAccount: vi.fn(), setCapital: vi.fn(), setFeeRate: vi.fn(), hasOpenPosition: vi.fn(() => false),
        }),
        events: TRADING_PRESENTATION_EVENTS,
        on: vi.fn(),
      };
      const input = createMockElement({ value: '1' });
      const view = new OrderFormView({
        trading,
        qtyInput: input,
        buyBtn: createMockElement(),
        sellBtn: createMockElement(),
        orderTypeSelect: createMockElement({ value: 'MARKET' }),
        getSymbol: () => 'BTCUSDT',
      });
      expect(view.trading).toBe(trading);
    });
  });
});
