import { AccountSummaryView } from './AccountSummaryView.js';
import { OrderFormView } from './OrderFormView.js';
import { PositionView } from './PositionView.js';
import { TradeLogView } from './TradeLogView.js';

/**
 * TradingPanel coordinates the paper trading user interface.
 * Composed of four focused sub-views:
 * - AccountSummaryView: balance, equity, capital presets, fee tier, stats
 * - OrderFormView: order submission form, tabs, quantities, trigger prices
 * - PositionView: active position card, live PnL, SL/TP risk controls
 * - TradeLogView: closed trade execution log, pending order list, activity badge
 */
export class TradingPanel {
  constructor({
    tradingEngine,
    balanceEl, equityEl, realizedEl, unrealizedEl, feesEl,
    posSymbolEl, posSideEl, posQtyEl, posEntryEl, posCurrentEl, posPnlEl,
    qtyInput, buyBtn, sellBtn, closeBtn, resetBtn,
    tradesListEl, errorEl,
    orderTypeSelect, limitPriceInput, stopPriceInput, pendingListEl,
    posSlEl, posTpEl, slInput, tpInput, setRiskBtn, clearRiskBtn
  }) {
    this.engine = tradingEngine;
    const getEl = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
    this.errorEl = errorEl || getEl('trading-error');

    // Keep legacy element properties for backward compatibility
    this.balanceEl = balanceEl;
    this.equityEl = equityEl;
    this.realizedEl = realizedEl;
    this.unrealizedEl = unrealizedEl;
    this.feesEl = feesEl;
    this.posSymbolEl = posSymbolEl;
    this.posSideEl = posSideEl;
    this.posQtyEl = posQtyEl;
    this.posEntryEl = posEntryEl;
    this.posCurrentEl = posCurrentEl;
    this.posPnlEl = posPnlEl;
    this.qtyInput = qtyInput;
    this.buyBtn = buyBtn;
    this.sellBtn = sellBtn;
    this.closeBtn = closeBtn;
    this.resetBtn = resetBtn;
    this.tradesListEl = tradesListEl;
    this.orderTypeSelect = orderTypeSelect || getEl('order-type');
    this.limitPriceInput = limitPriceInput || getEl('limit-price');
    this.stopPriceInput = stopPriceInput || getEl('stop-price');
    this.pendingListEl = pendingListEl || getEl('pending-orders-list');
    this.posSlEl = posSlEl || getEl('pos-sl');
    this.posTpEl = posTpEl || getEl('pos-tp');
    this.slInput = slInput || getEl('sl-price');
    this.tpInput = tpInput || getEl('tp-price');
    this.setRiskBtn = setRiskBtn || getEl('btn-set-risk');
    this.clearRiskBtn = clearRiskBtn || getEl('btn-clear-risk');

    // Sub-view 1: Account Summary & Capital Controls
    this.accountSummaryView = new AccountSummaryView({
      engine: this.engine,
      balanceEl: this.balanceEl,
      equityEl: this.equityEl,
      realizedEl: this.realizedEl,
      unrealizedEl: this.unrealizedEl,
      feesEl: this.feesEl,
      resetBtn: this.resetBtn,
      onError: (msg) => this.showError(msg),
      onRender: () => this.render(),
    });

    // Sub-view 2: Order Entry Form
    this.orderFormView = new OrderFormView({
      engine: this.engine,
      qtyInput: this.qtyInput,
      buyBtn: this.buyBtn,
      sellBtn: this.sellBtn,
      orderTypeSelect: this.orderTypeSelect,
      limitPriceInput: this.limitPriceInput,
      stopPriceInput: this.stopPriceInput,
      onError: (msg) => this.showError(msg),
      onSuccess: () => this.clearError(),
      onRender: () => this.render(),
    });

    // Sub-view 3: Active Position & Risk Controls
    this.positionView = new PositionView({
      engine: this.engine,
      posSymbolEl: this.posSymbolEl,
      posSideEl: this.posSideEl,
      posQtyEl: this.posQtyEl,
      posEntryEl: this.posEntryEl,
      posCurrentEl: this.posCurrentEl,
      posPnlEl: this.posPnlEl,
      posSlEl: this.posSlEl,
      posTpEl: this.posTpEl,
      closeBtn: this.closeBtn,
      setRiskBtn: this.setRiskBtn,
      clearRiskBtn: this.clearRiskBtn,
      slInput: this.slInput,
      tpInput: this.tpInput,
      onError: (msg) => this.showError(msg),
      onSuccess: () => this.clearError(),
      onRender: () => this.render(),
    });

    // Sub-view 4: Execution Log & Pending Orders
    this.tradeLogView = new TradeLogView({
      engine: this.engine,
      tradesListEl: this.tradesListEl,
      pendingListEl: this.pendingListEl,
      onError: (msg) => this.showError(msg),
      onRender: () => this.render(),
    });

    this._bindSidebarTabs();
    this._bindEngineEvents();
    this.render();
  }

  _bindSidebarTabs() {
    try {
      const tabBtns = document.querySelectorAll('.panel-tab-btn');
      tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          tabBtns.forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
          });
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
          const targetTab = btn.getAttribute('data-tab');
          document.querySelectorAll('.tab-panel').forEach(panel => {
            if (panel.id === `tab-view-${targetTab}`) panel.classList.add('active');
            else panel.classList.remove('active');
          });
        });
      });
    } catch {}
  }

  _bindEngineEvents() {
    const rerender = () => this.render();
    this.engine.on('accountUpdated', rerender);
    this.engine.on('positionOpened', rerender);
    this.engine.on('positionClosed', rerender);
    this.engine.on('positionUpdated', rerender);
    this.engine.on('tradeExecuted', rerender);
    this.engine.on('accountReset', rerender);
    this.engine.on('orderPlaced', rerender);
    this.engine.on('orderTriggered', rerender);
    this.engine.on('orderFilled', rerender);
    this.engine.on('orderCancelled', rerender);
    this.engine.on('stopLossTriggered', rerender);
    this.engine.on('takeProfitTriggered', rerender);
    this.engine.on('orderRejected', (err) => this.showError(err?.message || err?.reason || 'Order rejected'));
  }

  showError(msg) {
    if (!this.errorEl) return;
    this.errorEl.textContent = msg;
    this.errorEl.classList.remove('hidden');
    setTimeout(() => this.clearError(), 3500);
  }

  clearError() {
    if (!this.errorEl) return;
    this.errorEl.textContent = '';
    this.errorEl.classList.add('hidden');
  }

  _updateOrderTypeUI() {
    this.orderFormView.updateOrderTypeUI();
  }

  _placeOrder(side) {
    return this.orderFormView.placeOrder(side);
  }

  _closePosition() {
    return this.positionView.closePosition();
  }

  _setRisk() {
    return this.positionView.setRisk();
  }

  _clearRisk() {
    return this.positionView.clearRisk();
  }

  _cancelOrder(orderId) {
    return this.tradeLogView.cancelOrder(orderId);
  }

  _renderPending() {
    const pendingOrders = this.engine.getPendingOrders ? this.engine.getPendingOrders() : [];
    const allOrders = this.engine.getOrders ? this.engine.getOrders() : [];
    this.tradeLogView.renderPending(pendingOrders, allOrders);
  }

  render() {
    const acct = this.engine.getAccountSnapshot();
    const trades = this.engine.getTrades();
    const positions = this.engine.getPositions();

    this.accountSummaryView.render(acct, trades);
    this.orderFormView.render();
    this.positionView.render(positions);
    this.tradeLogView.render(trades);
  }
}
