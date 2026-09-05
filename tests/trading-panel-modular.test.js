import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AccountSummaryView } from '../src/ui/AccountSummaryView.js';
import { OrderFormView } from '../src/ui/OrderFormView.js';
import { PositionView } from '../src/ui/PositionView.js';
import { TradeLogView } from '../src/ui/TradeLogView.js';
import { TradingPanel } from '../src/ui/TradingPanel.js';

function createMockElement(initial = {}) {
  const listeners = {};
  const classes = new Set(initial.classes || []);
  return {
    textContent: initial.textContent ?? '',
    innerHTML: initial.innerHTML ?? '',
    value: initial.value ?? '',
    className: initial.className ?? '',
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

describe('Modular Trading Panel Sub-views & Coordinator', () => {
  let mockEngine;

  beforeEach(() => {
    global.document = {
      getElementById: () => null,
      querySelectorAll: () => [],
      querySelector: () => null,
    };

    mockEngine = {
      account: { startingBalance: 10000 },
      feeRate: 0.0005,
      getAccountSnapshot: vi.fn(() => ({
        cashBalance: 10000,
        equity: 10250,
        realizedPnL: 200,
        unrealizedPnL: 50,
        totalFees: 15,
      })),
      getTrades: vi.fn(() => [
        {
          symbol: 'BTCUSDT',
          side: 'BUY',
          quantity: 1,
          entryPrice: 50000,
          exitPrice: 50200,
          grossPnL: 200,
          totalFee: 10,
          netPnL: 190,
        },
      ]),
      getPositions: vi.fn(() => [
        {
          symbol: 'BTCUSDT',
          side: 'LONG',
          quantity: 0.5,
          entryPrice: 50000,
          currentPrice: 50100,
          unrealizedPnL: 50,
          stopLossPrice: 49500,
          takeProfitPrice: 51000,
        },
      ]),
      getPendingOrders: vi.fn(() => [
        {
          id: 'ord-1',
          type: 'LIMIT',
          side: 'BUY',
          quantity: 1,
          limitPrice: 48000,
          status: 'PENDING',
          createdReplayTime: 1700000000,
        },
      ]),
      getOrders: vi.fn(() => [
        {
          id: 'ord-1',
          type: 'LIMIT',
          side: 'BUY',
          quantity: 1,
          limitPrice: 48000,
          status: 'PENDING',
          createdReplayTime: 1700000000,
        },
      ]),
      getLatestCandle: vi.fn(() => ({ close: 50000 })),
      resetAccount: vi.fn(),
      placeOrder: vi.fn(() => ({ success: true })),
      placeLimitOrder: vi.fn(() => ({ success: true })),
      placeStopOrder: vi.fn(() => ({ success: true })),
      closePosition: vi.fn(() => ({ success: true })),
      setRisk: vi.fn(() => ({ success: true })),
      clearStopLoss: vi.fn(),
      clearTakeProfit: vi.fn(),
      cancelOrder: vi.fn(() => ({ success: true })),
      on: vi.fn(),
    };
  });

  afterEach(() => {
    delete global.document;
  });

  describe('AccountSummaryView', () => {
    it('renders balance, equity, and formatted PnL properly', () => {
      const balanceEl = createMockElement();
      const equityEl = createMockElement();
      const realizedEl = createMockElement();
      const unrealizedEl = createMockElement();
      const feesEl = createMockElement();
      const resetBtn = createMockElement();

      const view = new AccountSummaryView({
        engine: mockEngine,
        balanceEl,
        equityEl,
        realizedEl,
        unrealizedEl,
        feesEl,
        resetBtn,
      });

      view.render(mockEngine.getAccountSnapshot());

      expect(balanceEl.textContent).toBe('$10000.00');
      expect(equityEl.textContent).toBe('$10250.00');
      expect(realizedEl.textContent).toBe('$200.00');
      expect(realizedEl.className).toBe('pnl-pos');
      expect(unrealizedEl.textContent).toBe('$50.00');
      expect(feesEl.textContent).toBe('$15.00');
    });

    it('triggers resetAccount on reset button click', () => {
      const resetBtn = createMockElement();
      new AccountSummaryView({ engine: mockEngine, resetBtn });

      resetBtn.click();
      expect(mockEngine.resetAccount).toHaveBeenCalledTimes(1);
    });
  });

  describe('OrderFormView', () => {
    it('updates button labels and toggle limit/stop inputs on order type change', () => {
      const buyBtn = createMockElement();
      const sellBtn = createMockElement();
      const orderTypeSelect = createMockElement({ value: 'MARKET' });
      const limitPriceRow = createMockElement();
      const stopPriceRow = createMockElement();

      const view = new OrderFormView({
        engine: mockEngine,
        buyBtn,
        sellBtn,
        orderTypeSelect,
        limitPriceRow,
        stopPriceRow,
      });

      expect(buyBtn.textContent).toBe('BUY');
      expect(sellBtn.textContent).toBe('SELL');
      expect(limitPriceRow.classList.contains('hidden')).toBe(true);

      orderTypeSelect.value = 'LIMIT';
      view.updateOrderTypeUI();
      expect(buyBtn.textContent).toBe('BUY LIMIT');
      expect(sellBtn.textContent).toBe('SELL LIMIT');
      expect(limitPriceRow.classList.contains('hidden')).toBe(false);

      orderTypeSelect.value = 'STOP_MARKET';
      view.updateOrderTypeUI();
      expect(buyBtn.textContent).toBe('BUY STOP');
      expect(sellBtn.textContent).toBe('SELL STOP');
      expect(stopPriceRow.classList.contains('hidden')).toBe(false);
    });

    it('submits market order when placed', () => {
      const qtyInput = createMockElement({ value: '2' });
      const buyBtn = createMockElement();
      const orderTypeSelect = createMockElement({ value: 'MARKET' });

      const view = new OrderFormView({
        engine: mockEngine,
        qtyInput,
        buyBtn,
        orderTypeSelect,
        getSymbol: () => 'ETHUSDT',
      });

      const res = view.placeOrder('BUY');
      expect(res.success).toBe(true);
      expect(mockEngine.placeOrder).toHaveBeenCalledWith({
        symbol: 'ETHUSDT',
        side: 'BUY',
        quantity: 2,
      });
    });

    it('submits limit order when type is LIMIT', () => {
      const qtyInput = createMockElement({ value: '1.5' });
      const limitPriceInput = createMockElement({ value: '3000' });
      const orderTypeSelect = createMockElement({ value: 'LIMIT' });

      const view = new OrderFormView({
        engine: mockEngine,
        qtyInput,
        limitPriceInput,
        orderTypeSelect,
        getSymbol: () => 'ETHUSDT',
      });

      const res = view.placeOrder('BUY');
      expect(res.success).toBe(true);
      expect(mockEngine.placeLimitOrder).toHaveBeenCalledWith({
        symbol: 'ETHUSDT',
        side: 'BUY',
        quantity: 1.5,
        limitPrice: 3000,
      });
    });
  });

  describe('PositionView', () => {
    it('renders empty position state cleanly and disables action buttons', () => {
      const posSymbolEl = createMockElement();
      const closeBtn = createMockElement();
      const setRiskBtn = createMockElement();

      const view = new PositionView({
        engine: mockEngine,
        posSymbolEl,
        closeBtn,
        setRiskBtn,
      });

      view.render([]);
      expect(posSymbolEl.textContent).toBe('—');
      expect(closeBtn.disabled).toBe(true);
      expect(setRiskBtn.disabled).toBe(true);
    });

    it('renders active position state and enables action buttons', () => {
      const posSymbolEl = createMockElement();
      const posSideEl = createMockElement();
      const posQtyEl = createMockElement();
      const posEntryEl = createMockElement();
      const posPnlEl = createMockElement();
      const closeBtn = createMockElement();
      const setRiskBtn = createMockElement();

      const view = new PositionView({
        engine: mockEngine,
        posSymbolEl,
        posSideEl,
        posQtyEl,
        posEntryEl,
        posPnlEl,
        closeBtn,
        setRiskBtn,
      });

      view.render(mockEngine.getPositions());
      expect(posSymbolEl.textContent).toBe('BTCUSDT');
      expect(posSideEl.textContent).toBe('LONG');
      expect(posQtyEl.textContent).toBe('0.5');
      expect(posEntryEl.textContent).toBe('$50000.00');
      expect(posPnlEl.textContent).toBe('$50.00');
      expect(closeBtn.disabled).toBe(false);
      expect(setRiskBtn.disabled).toBe(false);
    });

    it('invokes closePosition on the engine', () => {
      const closeBtn = createMockElement();
      const view = new PositionView({
        engine: mockEngine,
        closeBtn,
      });

      view.closePosition();
      expect(mockEngine.closePosition).toHaveBeenCalledWith('BTCUSDT');
    });
  });

  describe('TradeLogView', () => {
    it('renders trade executions table and pending orders', () => {
      const tradesListEl = createMockElement();
      const pendingListEl = createMockElement();
      const activityBadge = createMockElement();

      const view = new TradeLogView({
        engine: mockEngine,
        tradesListEl,
        pendingListEl,
        activityBadge,
      });

      view.render(mockEngine.getTrades());
      expect(tradesListEl.innerHTML).toContain('BTCUSDT');
      expect(tradesListEl.innerHTML).toContain('50000.00→50200.00');
      expect(pendingListEl.innerHTML).toContain('ord-1');
      expect(pendingListEl.innerHTML).toContain('BUY');
      expect(activityBadge.textContent).toBe('2'); // 1 trade + 1 pending
    });
  });

  describe('TradingPanel Coordinator', () => {
    it('instantiates all four sub-views and routes render calls', () => {
      const mkEl = () => createMockElement();
      const panel = new TradingPanel({
        tradingEngine: mockEngine,
        balanceEl: mkEl(),
        equityEl: mkEl(),
        realizedEl: mkEl(),
        unrealizedEl: mkEl(),
        feesEl: mkEl(),
        posSymbolEl: mkEl(),
        posSideEl: mkEl(),
        posQtyEl: mkEl(),
        posEntryEl: mkEl(),
        posCurrentEl: mkEl(),
        posPnlEl: mkEl(),
        qtyInput: mkEl({ value: '1' }),
        buyBtn: mkEl(),
        sellBtn: mkEl(),
        closeBtn: mkEl(),
        resetBtn: mkEl(),
        tradesListEl: mkEl(),
        errorEl: mkEl(),
        orderTypeSelect: mkEl({ value: 'MARKET' }),
        limitPriceInput: mkEl({ value: '100' }),
        stopPriceInput: mkEl({ value: '105' }),
        pendingListEl: mkEl(),
        posSlEl: mkEl(),
        posTpEl: mkEl(),
        slInput: mkEl(),
        tpInput: mkEl(),
        setRiskBtn: mkEl(),
        clearRiskBtn: mkEl(),
      });

      expect(panel.accountSummaryView).toBeDefined();
      expect(panel.orderFormView).toBeDefined();
      expect(panel.positionView).toBeDefined();
      expect(panel.tradeLogView).toBeDefined();

      // Test backward-compatibility delegators
      panel._updateOrderTypeUI();
      panel._placeOrder('BUY');
      expect(mockEngine.placeOrder).toHaveBeenCalled();

      panel._closePosition();
      expect(mockEngine.closePosition).toHaveBeenCalled();

      panel._cancelOrder('ord-1');
      expect(mockEngine.cancelOrder).toHaveBeenCalledWith('ord-1');
    });
  });
});
