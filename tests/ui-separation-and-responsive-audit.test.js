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
    let mockChartManager;
    let mockTradingEngine;
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
      mockChartManager = {
        onChartClick: vi.fn(),
        updatePositionLines: vi.fn(),
        updateOrderLines: vi.fn(),
        clearTradingLines: vi.fn(),
      };
      mockTradingEngine = {
        getPositions: vi.fn(() => []),
        getPendingOrders: vi.fn(() => []),
        setTakeProfit: vi.fn(() => ({ success: true })),
        setStopLoss: vi.fn(() => ({ success: true })),
        on: vi.fn((event, handler) => {
          if (!engineListeners[event]) engineListeners[event] = [];
          engineListeners[event].push(handler);
        }),
        emit: (event, payload) => {
          (engineListeners[event] || []).forEach(fn => fn(payload));
        },
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
      slInput = createMockElement();
      tpInput = createMockElement();
      limitPriceInput = createMockElement();
      stopPriceInput = createMockElement();

      controller = new ChartTradingController({
        chartManager: mockChartManager,
        tradingEngine: mockTradingEngine,
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
      mockTradingEngine.getPositions.mockReturnValue([
        { symbol: 'BTCUSDT', side: 'LONG', entryPrice: 60000 },
      ]);

      const intent = controller.handleChartClick({ price: 65000 });
      expect(intent).toEqual({
        action: 'SET_TP',
        price: 65000,
        isTP: true,
        symbol: 'BTCUSDT',
      });
      expect(mockTradingEngine.setTakeProfit).toHaveBeenCalledWith('BTCUSDT', 65000);
      expect(tpInput.value).toBe('65000.00');
      expect(mockToastView.show).toHaveBeenCalledWith(expect.stringContaining('Take Profit set to $65000.00'));
      expect(mockTradingPanel.render).toHaveBeenCalled();
    });

    it('resolves and sets Stop Loss for active LONG position below entry', () => {
      mockTradingEngine.getPositions.mockReturnValue([
        { symbol: 'BTCUSDT', side: 'LONG', entryPrice: 60000 },
      ]);

      const intent = controller.handleChartClick({ price: 58000 });
      expect(intent).toEqual({
        action: 'SET_SL',
        price: 58000,
        isTP: false,
        symbol: 'BTCUSDT',
      });
      expect(mockTradingEngine.setStopLoss).toHaveBeenCalledWith('BTCUSDT', 58000);
      expect(slInput.value).toBe('58000.00');
      expect(mockToastView.show).toHaveBeenCalledWith(expect.stringContaining('Stop Loss set to $58000.00'));
      expect(mockTradingPanel.render).toHaveBeenCalled();
    });

    it('sets Limit Price on orderFormView when no active position and LIMIT order type selected', () => {
      mockTradingEngine.getPositions.mockReturnValue([]);
      mockOrderFormView.getOrderType.mockReturnValue('LIMIT');

      const intent = controller.handleChartClick({ price: 62500 });
      expect(intent).toEqual({ action: 'PRICE_SELECT', price: 62500 });
      expect(mockOrderFormView.setLimitPrice).toHaveBeenCalledWith(62500);
      expect(mockToastView.show).toHaveBeenCalledWith('Limit Price set to $62500.00');
    });

    it('sets Stop Price on orderFormView when no active position and STOP_MARKET order type selected', () => {
      mockTradingEngine.getPositions.mockReturnValue([]);
      mockOrderFormView.getOrderType.mockReturnValue('STOP_MARKET');

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
      // LIMIT selected but advanced off -> row stays hidden
      orderTypeSelect.value = 'LIMIT';
      view.updateOrderTypeUI();
      expect(limitRow.classList.contains('hidden')).toBe(true);
      // Toggle reveals it and flips accessibility state
      toggle.click();
      expect(view.advanced).toBe(true);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(limitRow.classList.contains('hidden')).toBe(false);
      // STOP type swaps the visible row
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
      const mockEngine = {
        getState: vi.fn(() => ({ status: 'ready', totalCandles: 100, speed: 1 })),
        getTotalCandles: vi.fn(() => 100),
        on: vi.fn(),
      };

      const controls = new ReplayControls({
        playBtn,
        pauseBtn,
        stepBtn,
        resetBtn,
        startReplayBtn,
        speedSelect,
        statusEl,
        engine: mockEngine,
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

  describe('5. Multi-Screen CSS Responsive Audit', () => {
    const paperCss = fs.readFileSync('src/paper-theme.css', 'utf-8');
    const viewportCss = fs.readFileSync('src/viewport-fit.css', 'utf-8');
    const polishCss = fs.readFileSync('src/ui-polish.css', 'utf-8');
    const baseCss = fs.readFileSync('src/styles.css', 'utf-8');

    it('harmonizes desktop viewport fit at min-width 1025px across CSS files', () => {
      expect(viewportCss).toMatch(/@media\s*\(\s*min-width:\s*1025px\s*\)/);
      expect(polishCss).toMatch(/@media\s*\(\s*min-width:\s*1025px\s*\)/);
    });

    it('contains fluid tablet layout for 701px-1024px in paper-theme.css', () => {
      expect(paperCss).toMatch(/min-width:\s*701px/);
      expect(paperCss).toMatch(/max-width:\s*1024px/);
      expect(paperCss).toMatch(/flex-direction:\s*column/);
      expect(paperCss).toMatch(/\.trading-section/);
      expect(paperCss).toMatch(/\.pos-compact-grid/);
    });

    it('preserves mobile replay playback controls in controls-section on <= 700px', () => {
      expect(paperCss).toMatch(/@media\s*\(\s*max-width:\s*700px\s*\)/);
      // The controls-section must NOT be display: none !important
      const mobileBlockMatch = paperCss.match(/@media\s*\(\s*max-width:\s*700px\s*\)[\s\S]*$/);
      expect(mobileBlockMatch).not.toBeNull();
      const mobileCss = mobileBlockMatch[0];
      expect(mobileCss).toMatch(/\.controls-section\s*\{[\s\S]*?display:\s*flex/);
      expect(mobileCss).toMatch(/\.controls-row/);
      expect(mobileCss).toMatch(/#speed-select/);
    });

    it('preserves mobile CLOSE POSITION button accessibility on <= 700px', () => {
      const mobileBlockMatch = paperCss.match(/@media\s*\(\s*max-width:\s*700px\s*\)[\s\S]*$/);
      const mobileCss = mobileBlockMatch[0];
      expect(mobileCss).toMatch(/\.order-secondary-grid\s*\{[\s\S]*?display:\s*block/);
      expect(mobileCss).toMatch(/\.btn-close-pos/);
    });

    it('provides small mobile optimizations for <= 360px', () => {
      expect(paperCss).toMatch(/@media\s*\(\s*max-width:\s*360px\s*\)/);
      expect(baseCss).toMatch(/@media\s*\(\s*max-width:\s*320px\s*\)/);
    });

    it('guarantees touch targets min-height 44px for coarse pointer', () => {
      expect(baseCss).toMatch(/pointer:\s*coarse/);
      expect(baseCss).toMatch(/min-height:\s*44px/);
    });

    it('forbids raw width 100vw across all stylesheets to avoid horizontal scroll', () => {
      for (const [name, css] of [
        ['styles.css', baseCss],
        ['paper-theme.css', paperCss],
        ['ui-polish.css', polishCss],
        ['viewport-fit.css', viewportCss],
      ]) {
        const raw100vw = css.split('\n').some(l => l.trim().startsWith('width:') && l.includes('100vw'));
        expect(raw100vw, `Raw width: 100vw found in ${name}`).toBe(false);
      }
    });
  });
});
