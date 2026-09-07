import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { ChartTradingController } from '../src/ui/ChartTradingController.js';
import { OrderFormView } from '../src/ui/OrderFormView.js';
import { Timeline } from '../src/ui/Timeline.js';
import { ReplayControls } from '../src/ui/ReplayControls.js';
import { TradingEvents } from '../src/trading/TradingEvents.js';

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
        events: TradingEvents,
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
        snapshot: vi.fn(() => ({
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
        events: TradingEvents,
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
      mockTradingState.snapshot.mockReturnValue({
        account: null,
        positions: [{ symbol: 'BTCUSDT', side: 'LONG', entryPrice: 60000 }],
        pendingOrders: [], orders: [], trades: [], stats: {}, hasMarket: false, markPrice: null,
      });
      mockActions.resolveClick.mockReturnValue({
        action: 'SET_TP',
        price: 65000,
        isTP: true,
        symbol: 'BTCUSDT',
      });
      mockActions.execute.mockReturnValue({ success: true });

      const intent = controller.handleChartClick({ price: 65000 });
      expect(intent).toEqual({
        action: 'SET_TP',
        price: 65000,
        isTP: true,
        symbol: 'BTCUSDT',
      });
      expect(mockActions.resolveClick).toHaveBeenCalledWith(65000);
      expect(mockActions.execute).toHaveBeenCalledWith(intent);
      expect(tpInput.value).toBe('65000.00');
      expect(mockToastView.show).toHaveBeenCalledWith(expect.stringContaining('Take Profit set to $65000.00'));
      expect(mockTradingPanel.render).toHaveBeenCalled();
    });

    it('resolves and sets Stop Loss for active LONG position below entry', () => {
      mockTradingState.snapshot.mockReturnValue({
        account: null,
        positions: [{ symbol: 'BTCUSDT', side: 'LONG', entryPrice: 60000 }],
        pendingOrders: [], orders: [], trades: [], stats: {}, hasMarket: false, markPrice: null,
      });
      mockActions.resolveClick.mockReturnValue({
        action: 'SET_SL',
        price: 58000,
        isTP: false,
        symbol: 'BTCUSDT',
      });
      mockActions.execute.mockReturnValue({ success: true });

      const intent = controller.handleChartClick({ price: 58000 });
      expect(intent).toEqual({
        action: 'SET_SL',
        price: 58000,
        isTP: false,
        symbol: 'BTCUSDT',
      });
      expect(mockActions.resolveClick).toHaveBeenCalledWith(58000);
      expect(mockActions.execute).toHaveBeenCalledWith(intent);
      expect(slInput.value).toBe('58000.00');
      expect(mockToastView.show).toHaveBeenCalledWith(expect.stringContaining('Stop Loss set to $58000.00'));
      expect(mockTradingPanel.render).toHaveBeenCalled();
    });

    it('sets Limit Price on orderFormView when no active position and LIMIT order type selected', () => {
      mockTradingState.snapshot.mockReturnValue({
        account: null, positions: [], pendingOrders: [], orders: [],
        trades: [], stats: {}, hasMarket: false, markPrice: null,
      });
      mockOrderFormView.getOrderType.mockReturnValue('LIMIT');
      mockActions.resolveClick.mockReturnValue({ action: 'PRICE_SELECT', price: 62500 });

      const intent = controller.handleChartClick({ price: 62500 });
      expect(intent).toEqual({ action: 'PRICE_SELECT', price: 62500 });
      expect(mockOrderFormView.setLimitPrice).toHaveBeenCalledWith(62500);
      expect(mockToastView.show).toHaveBeenCalledWith('Limit Price set to $62500.00');
    });

    it('sets Stop Price on orderFormView when no active position and STOP_MARKET order type selected', () => {
      mockTradingState.snapshot.mockReturnValue({
        account: null, positions: [], pendingOrders: [], orders: [],
        trades: [], stats: {}, hasMarket: false, markPrice: null,
      });
      mockOrderFormView.getOrderType.mockReturnValue('STOP_MARKET');
      mockActions.resolveClick.mockReturnValue({ action: 'PRICE_SELECT', price: 67000 });

      const intent = controller.handleChartClick({ price: 67000 });
      expect(intent).toEqual({ action: 'PRICE_SELECT', price: 67000 });
      expect(mockOrderFormView.setStopPrice).toHaveBeenCalledWith(67000);
      expect(mockToastView.show).toHaveBeenCalledWith('Stop Price set to $67000.00');
    });

    it('handles toast notifications for execution events', () => {
      mockTradingEngine.emit(TradingEvents.ORDER_FILLED, {
        order: { type: 'LIMIT', side: 'BUY', filledPrice: 59000 },
      });
      expect(mockToastView.show).toHaveBeenCalledWith('✓ Limit BUY Filled @ $59000.00');

      mockTradingEngine.emit(TradingEvents.STOP_LOSS_TRIGGERED, { price: 58000 });
      expect(mockToastView.show).toHaveBeenCalledWith('🛑 Stop Loss Triggered @ $58000.00');

      mockTradingEngine.emit(TradingEvents.TAKE_PROFIT_TRIGGERED, { price: 66000 });
      expect(mockToastView.show).toHaveBeenCalledWith('🎯 Take Profit Triggered @ $66000.00');

      mockTradingEngine.emit(TradingEvents.POSITION_LIQUIDATED, { liquidationPrice: 50000 });
      expect(mockToastView.show).toHaveBeenCalledWith('⚠️ Position Liquidated @ $50000.00');
    });
  });

  describe('2. OrderFormView Encapsulation & Setters', () => {
    it('provides setQuantity, setLimitPrice, setStopPrice, and setOrderType', () => {
      const qtyInput = createMockElement({ value: '1' });
      const limitPriceInput = createMockElement({ value: '' });
      const stopPriceInput = createMockElement({ value: '' });
      const orderTypeSelect = createMockElement({ value: 'MARKET' });
      const buyBtn = createMockElement();
      const sellBtn = createMockElement();

      const view = new OrderFormView({
        qtyInput,
        limitPriceInput,
        stopPriceInput,
        orderTypeSelect,
        buyBtn,
        sellBtn,
      });

      view.setQuantity(0.25);
      expect(qtyInput.value).toBe('0.25');

      view.setLimitPrice(55000.5);
      expect(limitPriceInput.value).toBe('55000.50');

      view.setStopPrice(52000.75);
      expect(stopPriceInput.value).toBe('52000.75');

      view.setOrderType('LIMIT');
      expect(orderTypeSelect.value).toBe('LIMIT');
    });

    it('gates limit/stop rows behind the Advanced toggle (progressive disclosure)', () => {
      const limitRow = createMockElement({ classes: ['hidden'] });
      const stopRow = createMockElement({ classes: ['hidden'] });
      const toggle = createMockElement();
      const orderTypeSelect = createMockElement({ value: 'MARKET' });
      const view = new OrderFormView({
        qtyInput: createMockElement({ value: '1' }),
        limitPriceInput: createMockElement({ value: '' }),
        stopPriceInput: createMockElement({ value: '' }),
        orderTypeSelect,
        buyBtn: createMockElement(),
        sellBtn: createMockElement(),
        limitPriceRow: limitRow,
        stopPriceRow: stopRow,
        advancedToggle: toggle,
      });

      expect(view.advanced).toBe(false);
      orderTypeSelect.value = 'LIMIT';
      view.updateOrderTypeUI();
      expect(limitRow.classList.contains('hidden')).toBe(true);
      toggle.click();
      expect(view.advanced).toBe(true);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(limitRow.classList.contains('hidden')).toBe(false);
      orderTypeSelect.value = 'STOP_MARKET';
      view.updateOrderTypeUI();
      expect(stopRow.classList.contains('hidden')).toBe(false);
      expect(limitRow.classList.contains('hidden')).toBe(true);
    });
  });

  describe('3. Timeline onCommit Support', () => {
    it('fires onCommit callback when slider triggers change event', () => {
      const sliderEl = createMockElement({ value: '10' });
      const startLabelEl = createMockElement();
      const currentLabelEl = createMockElement();
      const endLabelEl = createMockElement();
      const indexLabelEl = createMockElement();
      const timeLabelEl = createMockElement();
      const startIndexLabelEl = createMockElement();

      const timeline = new Timeline({
        sliderEl,
        startLabelEl,
        currentLabelEl,
        endLabelEl,
        indexLabelEl,
        timeLabelEl,
        startIndexLabelEl,
      });

      const commitHandler = vi.fn();
      timeline.onCommit(commitHandler);

      sliderEl.value = '25';
      sliderEl.dispatchEvent({ type: 'change' });
      expect(commitHandler).toHaveBeenCalledWith(25);
    });
  });

  describe('4. ReplayControls Auto-Follow Support', () => {
    it('wires followBtn click and setAutoFollow visibility toggle', () => {
      const playBtn = createMockElement();
      const pauseBtn = createMockElement();
      const stepBtn = createMockElement();
      const resetBtn = createMockElement();
      const startReplayBtn = createMockElement();
      const speedSelect = createMockElement({ value: '1' });
      const statusEl = createMockElement();
      const followBtn = createMockElement({ classes: ['hidden'] });
      const onFollowClick = vi.fn();
      const mockReplayPort = {
        play: vi.fn(),
        pause: vi.fn(),
        stepForward: vi.fn(),
        reset: vi.fn(),
        start: vi.fn(),
        setSpeed: vi.fn(),
        getState: vi.fn(() => ({ status: 'ready', totalCandles: 100, speed: 1 })),
        getTotalCandles: vi.fn(() => 100),
        onStateChanged: vi.fn(() => () => {}),
        onSpeedChanged: vi.fn(() => () => {}),
      };

      const controls = new ReplayControls({
        playBtn,
        pauseBtn,
        stepBtn,
        resetBtn,
        startReplayBtn,
        speedSelect,
        statusEl,
        replayPort: mockReplayPort,
        followBtn,
        onFollowClick,
      });

      controls.setAutoFollow(false);
      expect(followBtn.classList.contains('hidden')).toBe(false);

      controls.setAutoFollow(true);
      expect(followBtn.classList.contains('hidden')).toBe(true);

      followBtn.click();
      expect(onFollowClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('5. Multi-Screen CSS Responsive Audit (Paper UI v1 single bundle)', () => {
    const paperCss = fs.readFileSync('src/ui/index.css', 'utf-8');
    const markup = fs.readFileSync('src/ui/paper/markup/Timeline.js', 'utf-8');

    it('owns the viewport grid: header / status / workspace / timeline / controls', () => {
      expect(paperCss).toMatch(/#page-replay\.active\s*\{[\s\S]*?display:\s*grid/);
      expect(paperCss).toMatch(/"header"/);
      expect(paperCss).toMatch(/"status"/);
      expect(paperCss).toMatch(/"workspace"/);
      expect(paperCss).toMatch(/"timeline"/);
      expect(paperCss).toMatch(/"controls"/);
    });

    it('lays out chart + trading side-by-side on desktop', () => {
      expect(paperCss).toMatch(/\.main-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)\s*var\(--sidebar\)/);
      expect(paperCss).toMatch(/\.trading-section/);
      expect(paperCss).toMatch(/\.pos-compact-grid/);
    });

    it('collapses to a single column with a bottom-sheet trading drawer at <= 1024px', () => {
      const tabletBlock = paperCss.match(/@media\s*\(\s*max-width:\s*1024px\s*\)[\s\S]*$/);
      expect(tabletBlock).not.toBeNull();
      expect(tabletBlock[0]).toMatch(/\.main-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
      expect(tabletBlock[0]).toMatch(/\.trading-section\s*\{[\s\S]*?position:\s*fixed/);
      expect(tabletBlock[0]).toMatch(/transform:\s*translateY/);
      expect(paperCss).toMatch(/drawer-open/);
    });

    it('keeps replay playback controls mounted and reachable on small screens', () => {
      expect(paperCss).toMatch(/\.controls-section\s*\{[\s\S]*?display:\s*flex/);
      expect(paperCss).not.toMatch(/\.controls-section\s*\{[^}]*display:\s*none/);
      expect(markup).toMatch(/controls-row/);
      expect(markup).toMatch(/speed-select/);
      expect(markup).toMatch(/btn-play/);
      expect(markup).toMatch(/timeline-slider/);
    });

    it('provides small-screen rules at <= 640px', () => {
      expect(paperCss).toMatch(/@media\s*\(\s*max-width:\s*640px\s*\)/);
    });

    it('guarantees 44px touch targets on the primary trade buttons', () => {
      expect(paperCss).toMatch(/\.btn-buy-main\s*\{[\s\S]*?min-height:\s*44px/);
      expect(paperCss).toMatch(/\.btn-sell-main\s*\{[\s\S]*?min-height:\s*44px/);
    });

    it('forbids raw width 100vw in the bundle to avoid horizontal scroll', () => {
      const raw100vw = paperCss.split('\n').some(l => l.trim().startsWith('width:') && l.includes('100vw'));
      expect(raw100vw, 'Raw width: 100vw found in src/ui/index.css').toBe(false);
    });
  });
});
