import { AccountSummaryView } from './AccountSummaryView.js';
import { OrderFormView } from './OrderFormView.js';
import { PositionView } from './PositionView.js';
import { TradeLogView } from './TradeLogView.js';
import { TRADING_PRESENTATION_EVENTS, assertTradingPresentation } from '../ports/TradingPresentationPort.js';

export class TradingPanel {
  constructor({
    trading,
    tradingEvents = null,
    balanceEl, equityEl, realizedEl, unrealizedEl, feesEl,
    posSymbolEl, posSideEl, posQtyEl, posEntryEl, posCurrentEl, posPnlEl,
    qtyInput, buyBtn, sellBtn, closeBtn, resetBtn,
    tradesListEl, errorEl,
    orderTypeSelect, limitPriceInput, stopPriceInput, limitPriceRow, stopPriceRow, advancedToggle, pendingListEl,
    posSlEl, posTpEl, slInput, tpInput, setRiskBtn, clearRiskBtn,
    getSymbol = () => 'BTCUSDT',
  }) {
    this.trading = assertTradingPresentation(trading);
    this.tradingEvents = tradingEvents;
    this.getSymbol = getSymbol;
    const getEl = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
    this.errorEl = errorEl || getEl('trading-error');
    this.errorTimeout = null;
    this._tabBindings = [];
    this._engineSubscriptions = [];

    this.balanceEl = balanceEl; this.equityEl = equityEl; this.realizedEl = realizedEl; this.unrealizedEl = unrealizedEl; this.feesEl = feesEl;
    this.posSymbolEl = posSymbolEl; this.posSideEl = posSideEl; this.posQtyEl = posQtyEl; this.posEntryEl = posEntryEl; this.posCurrentEl = posCurrentEl; this.posPnlEl = posPnlEl;
    this.qtyInput = qtyInput; this.buyBtn = buyBtn; this.sellBtn = sellBtn; this.closeBtn = closeBtn; this.resetBtn = resetBtn; this.tradesListEl = tradesListEl;
    this.orderTypeSelect = orderTypeSelect || getEl('order-type'); this.limitPriceInput = limitPriceInput || getEl('limit-price'); this.stopPriceInput = stopPriceInput || getEl('stop-price');
    this.limitPriceRow = limitPriceRow || getEl('limit-price-row'); this.stopPriceRow = stopPriceRow || getEl('stop-price-row'); this.advancedToggle = advancedToggle || getEl('advanced-toggle');
    this.pendingListEl = pendingListEl || getEl('pending-orders-list'); this.posSlEl = posSlEl || getEl('pos-sl'); this.posTpEl = posTpEl || getEl('pos-tp');
    this.slInput = slInput || getEl('sl-price'); this.tpInput = tpInput || getEl('tp-price'); this.setRiskBtn = setRiskBtn || getEl('btn-set-risk'); this.clearRiskBtn = clearRiskBtn || getEl('btn-clear-risk');

    const common = { trading: this.trading };
    this.accountSummaryView = new AccountSummaryView({ ...common, balanceEl: this.balanceEl, equityEl: this.equityEl, realizedEl: this.realizedEl, unrealizedEl: this.unrealizedEl, feesEl: this.feesEl, resetBtn: this.resetBtn, onError: (msg) => this.showError(msg), onRender: () => this.render() });
    this.orderFormView = new OrderFormView({ ...common, qtyInput: this.qtyInput, buyBtn: this.buyBtn, sellBtn: this.sellBtn, orderTypeSelect: this.orderTypeSelect, limitPriceInput: this.limitPriceInput, stopPriceInput: this.stopPriceInput, limitPriceRow: this.limitPriceRow, stopPriceRow: this.stopPriceRow, advancedToggle: this.advancedToggle, getSymbol, onError: (msg) => this.showError(msg), onSuccess: () => this.clearError(), onRender: () => this.render() });
    this.positionView = new PositionView({ ...common, posSymbolEl: this.posSymbolEl, posSideEl: this.posSideEl, posQtyEl: this.posQtyEl, posEntryEl: this.posEntryEl, posCurrentEl: this.posCurrentEl, posPnlEl: this.posPnlEl, posSlEl: this.posSlEl, posTpEl: this.posTpEl, closeBtn: this.closeBtn, setRiskBtn: this.setRiskBtn, clearRiskBtn: this.clearRiskBtn, slInput: this.slInput, tpInput: this.tpInput, getSymbol, onError: (msg) => this.showError(msg), onSuccess: () => this.clearError(), onRender: () => this.render() });
    this.tradeLogView = new TradeLogView({ trading: this.trading, tradesListEl: this.tradesListEl, pendingListEl: this.pendingListEl, onError: (msg) => this.showError(msg), onRender: () => this.render() });

    this._bindSidebarTabs();
    this._bindEngineEvents();
    this.render();
  }

  _bindSidebarTabs() {
    const tabBtns = [...document.querySelectorAll('.panel-tab-btn')];
    const activate = (btn, focus = false) => {
      const targetTab = btn.getAttribute('data-tab');
      tabBtns.forEach((tab) => {
        const selected = tab === btn;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        const selected = panel.id === `tab-view-${targetTab}`;
        panel.classList.toggle('active', selected);
        panel.hidden = !selected;
      });
      if (focus) btn.focus();
    };
    tabBtns.forEach((btn, index) => {
      const onClick = () => activate(btn);
      const onKeyDown = (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabBtns.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabBtns.length) % tabBtns.length;
        activate(tabBtns[nextIndex], true);
      };
      btn.addEventListener('click', onClick);
      btn.addEventListener('keydown', onKeyDown);
      this._tabBindings.push([btn, onClick, onKeyDown]);
    });
    const selected = tabBtns.find((btn) => btn.getAttribute('aria-selected') === 'true') || tabBtns[0];
    if (selected) activate(selected);
  }
  _bindEngineEvents() {
    const trading = this.trading;
    const on = this.tradingEvents?.on || trading?.on?.bind(trading);
    if (!on) return;
    const events = this.tradingEvents?.events || TRADING_PRESENTATION_EVENTS;
    const rerender = () => this.render();
    [events.ACCOUNT_UPDATED, events.POSITION_OPENED, events.POSITION_CLOSED, events.POSITION_UPDATED, events.TRADE_EXECUTED, events.ACCOUNT_RESET, events.ORDER_PLACED, events.ORDER_TRIGGERED, events.ORDER_FILLED, events.ORDER_CANCELLED, events.STOP_LOSS_TRIGGERED, events.TAKE_PROFIT_TRIGGERED].forEach((event) => {
      if (!event) return;
      const unsubscribe = on(event, rerender);
      if (typeof unsubscribe === 'function') this._engineSubscriptions.push(unsubscribe);
    });
    if (events.ORDER_REJECTED) {
      const unsubscribe = on(events.ORDER_REJECTED, (err) => this.showError(err?.message || err?.reason || 'Order rejected'));
      if (typeof unsubscribe === 'function') this._engineSubscriptions.push(unsubscribe);
    }
  }

  destroy() {
    clearTimeout(this.errorTimeout); this.errorTimeout = null;
    this._tabBindings.forEach(([btn, clickHandler, keyHandler]) => { btn.removeEventListener?.('click', clickHandler); btn.removeEventListener?.('keydown', keyHandler); }); this._tabBindings = [];
    this._engineSubscriptions.forEach((unsubscribe) => { try { unsubscribe?.(); } catch (error) { console.warn('[TradingPanel] unsubscribe failed', error); } });
    this._engineSubscriptions = [];
    this.accountSummaryView?.destroy?.(); this.orderFormView?.destroy?.(); this.positionView?.destroy?.(); this.tradeLogView?.destroy?.();
  }

  showError(msg) {
    if (!this.errorEl) return; this.errorEl.textContent = msg; this.errorEl.classList.remove('hidden'); clearTimeout(this.errorTimeout);
    this.errorTimeout = setTimeout(() => { this.errorTimeout = null; this.clearError(); }, 3500);
  }
  clearError() { if (this.errorTimeout) { clearTimeout(this.errorTimeout); this.errorTimeout = null; } if (!this.errorEl) return; this.errorEl.textContent = ''; this.errorEl.classList.add('hidden'); }
  _updateOrderTypeUI() { this.orderFormView.updateOrderTypeUI(); }
  _placeOrder(side) { return this.orderFormView.placeOrder(side); }
  _closePosition() { return this.positionView.closePosition(); }
  _setRisk() { return this.positionView.setRisk(); }
  _clearRisk() { return this.positionView.clearRisk(); }
  _cancelOrder(orderId) { return this.tradeLogView.cancelOrder(orderId); }
  _renderPending() {
    const snap = this.trading.snapshot();
    this.tradeLogView.renderPending(snap.pendingOrders || [], snap.orders || []);
  }

  render() {
    const snap = this.trading.snapshot();
    const acct = snap.account;
    const trades = snap.trades;
    const positions = snap.positions;
    this.accountSummaryView.render(acct, trades);
    this.orderFormView.render();
    this.positionView.render(positions);
    this.tradeLogView.render(trades);
    this._renderTicketState(positions, trades);
  }

  _activePosition(positions = []) {
    if (!Array.isArray(positions) || positions.length === 0) return null;
    const symbol = String(this.getSymbol?.() || '').trim().toUpperCase();
    return positions.find((position) => String(position?.symbol || '').toUpperCase() === symbol) || positions[0];
  }

  _renderTicketState(positions = [], trades = []) {
    const position = this._activePosition(positions);
    this._renderTicketPositionState(position);
    this._renderFlattenSummary(position);
    this._renderRecentFills(trades);
  }

  _renderTicketPositionState(position) {
    const inPos = Boolean(position);
    const ticket = document.getElementById('order-ticket');
    const hint = document.getElementById('ticket-state-hint');
    const pill = document.getElementById('pos-state-pill');
    if (ticket) {
      ticket.classList.toggle('is-flat', !inPos);
      ticket.classList.toggle('is-in-position', inPos);
      ticket.classList.remove('is-long', 'is-short');
      if (inPos) ticket.classList.add(`is-${String(position.side || '').toLowerCase()}`);
    }
    document.body?.classList.toggle('has-position', inPos);
    document.body?.classList.toggle('is-flat', !inPos);
    if (pill) {
      pill.textContent = inPos ? position.side : 'FLAT';
      pill.className = `pos-state-pill ${inPos ? (position.side === 'LONG' ? 'is-long' : 'is-short') : 'is-flat'}`;
    }
    if (hint) {
      hint.textContent = inPos
        ? `${position.side} ${position.quantity} · uPnL ${Number(position.unrealizedPnL) >= 0 ? '+' : ''}$${Number(position.unrealizedPnL).toFixed(2)}`
        : 'FLAT • Pick a size';
    }
    document.querySelector('.risk-details')?.open = inPos;
    if (this.closeBtn) this.closeBtn.textContent = inPos ? `FLATTEN ${position.side} ${position.quantity}` : 'CLOSE POSITION';
  }

  _renderFlattenSummary(position) {
    const summary = document.getElementById('ticket-flatten-summary');
    summary?.classList.toggle('hidden', !position);
    if (!position) return;
    const fmt = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}` : '—';
    };
    const entry = document.getElementById('flatten-entry');
    const mark = document.getElementById('flatten-mark');
    const pnl = document.getElementById('flatten-pnl');
    if (entry) entry.textContent = fmt(position.entryPrice);
    if (mark) mark.textContent = fmt(position.currentPrice);
    if (pnl) {
      const value = Number(position.unrealizedPnL);
      pnl.textContent = `${value >= 0 ? '+' : ''}${fmt(value)}`;
      pnl.className = `num ${value >= 0 ? 'pnl-pos' : 'pnl-neg'}`;
    }
  }

  _renderRecentFills(trades = []) {
    const fillsEl = document.getElementById('ticket-fills-list');
    if (!fillsEl) return;
    const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    fillsEl.innerHTML = trades.length
      ? trades.slice(-3).reverse().map((trade) => {
        const net = Number(trade.netPnL ?? trade.realizedPnL ?? 0);
        const safeNet = Number.isFinite(net) ? net : 0;
        const quantity = Number(trade.quantity);
        const cls = safeNet >= 0 ? 'pnl-pos' : 'pnl-neg';
        return `<div class="trade-row"><span class="num">${escape(trade.symbol)} ${escape(trade.side)} ${Number.isFinite(quantity) ? quantity : '—'}</span><span class="num ${cls}">${safeNet >= 0 ? '+' : '-'}$${Math.abs(safeNet).toFixed(2)}</span></div>`;
      }).join('')
      : '<span class="empty-hint">No fills yet</span>';
  }}
