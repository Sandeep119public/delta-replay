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
    posSlEl, posTpEl, slInput, tpInput, setRiskBtn, clearRiskBtn
  }) {
    this.trading = assertTradingPresentation(trading);
    this.tradingEvents = tradingEvents;
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
    this.orderFormView = new OrderFormView({ ...common, qtyInput: this.qtyInput, buyBtn: this.buyBtn, sellBtn: this.sellBtn, orderTypeSelect: this.orderTypeSelect, limitPriceInput: this.limitPriceInput, stopPriceInput: this.stopPriceInput, limitPriceRow: this.limitPriceRow, stopPriceRow: this.stopPriceRow, advancedToggle: this.advancedToggle, onError: (msg) => this.showError(msg), onSuccess: () => this.clearError(), onRender: () => this.render() });
    this.positionView = new PositionView({ ...common, posSymbolEl: this.posSymbolEl, posSideEl: this.posSideEl, posQtyEl: this.posQtyEl, posEntryEl: this.posEntryEl, posCurrentEl: this.posCurrentEl, posPnlEl: this.posPnlEl, posSlEl: this.posSlEl, posTpEl: this.posTpEl, closeBtn: this.closeBtn, setRiskBtn: this.setRiskBtn, clearRiskBtn: this.clearRiskBtn, slInput: this.slInput, tpInput: this.tpInput, onError: (msg) => this.showError(msg), onSuccess: () => this.clearError(), onRender: () => this.render() });
    this.tradeLogView = new TradeLogView({ trading: this.trading, tradesListEl: this.tradesListEl, pendingListEl: this.pendingListEl, onError: (msg) => this.showError(msg), onRender: () => this.render() });

    this._bindSidebarTabs();
    this._bindEngineEvents();
    this.render();
  }

  _bindSidebarTabs() {
    try {
      const tabBtns = document.querySelectorAll('.panel-tab-btn');
      tabBtns.forEach(btn => {
        const handler = () => {
          tabBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
          btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
          const targetTab = btn.getAttribute('data-tab');
          document.querySelectorAll('.tab-panel').forEach(panel => { if (panel.id === `tab-view-${targetTab}`) panel.classList.add('active'); else panel.classList.remove('active'); });
        };
        btn.addEventListener('click', handler); this._tabBindings.push([btn, handler]);
      });
    } catch {}
  }

  _bindEngineEvents() {
    const trading = this.trading;
    const on = this.tradingEvents?.on || trading?.on?.bind(trading);
    if (!on) return;
    const events = this.tradingEvents?.events || TRADING_PRESENTATION_EVENTS;
    const rerender = () => this.render();
    [events.ACCOUNT_UPDATED, events.POSITION_OPENED, events.POSITION_CLOSED, events.POSITION_UPDATED, events.TRADE_EXECUTED, events.ACCOUNT_RESET, events.ORDER_PLACED, events.ORDER_TRIGGERED, events.ORDER_FILLED, events.ORDER_CANCELLED, events.STOP_LOSS_TRIGGERED, events.TAKE_PROFIT_TRIGGERED].forEach((event) => {
      const unsubscribe = on(event, rerender);
      if (typeof unsubscribe === 'function') this._engineSubscriptions.push(unsubscribe);
    });
    const unsubscribe = on(events.ORDER_REJECTED, (err) => this.showError(err?.message || err?.reason || 'Order rejected'));
    if (typeof unsubscribe === 'function') this._engineSubscriptions.push(unsubscribe);
  }

  destroy() {
    clearTimeout(this.errorTimeout); this.errorTimeout = null;
    this._tabBindings.forEach(([btn, handler]) => btn.removeEventListener?.('click', handler)); this._tabBindings = [];
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

  _renderTicketState(positions = [], trades = []) {
    try {
      const inPos = positions.length > 0, p = positions[0];
      const ticket = document.getElementById('order-ticket'), hint = document.getElementById('ticket-state-hint'), pill = document.getElementById('pos-state-pill');
      const flatSummary = document.getElementById('ticket-flatten-summary'), fEntry = document.getElementById('flatten-entry'), fMark = document.getElementById('flatten-mark'), fPnl = document.getElementById('flatten-pnl');
      if (ticket) { ticket.classList.toggle('is-flat', !inPos); ticket.classList.toggle('is-in-position', inPos); ticket.classList.remove('is-long', 'is-short'); if (inPos) ticket.classList.add(`is-${String(p.side || '').toLowerCase()}`); }
      if (document.body) { document.body.classList.toggle('has-position', inPos); document.body.classList.toggle('is-flat', !inPos); }
      if (pill) { pill.textContent = inPos ? p.side : 'FLAT'; pill.className = `pos-state-pill ${inPos ? (p.side === 'LONG' ? 'is-long' : 'is-short') : 'is-flat'}`; }
      if (hint) hint.textContent = inPos ? `${p.side} ${p.quantity} · uPnL ${Number(p.unrealizedPnL) >= 0 ? '+' : ''}$${Number(p.unrealizedPnL).toFixed(2)}` : 'FLAT • Pick a size';
      const fmt = (v) => { const n = Number(v); return Number.isFinite(n) ? `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}` : '—'; };
      if (flatSummary) flatSummary.classList.toggle('hidden', !inPos);
      if (inPos) { if (fEntry) fEntry.textContent = fmt(p.entryPrice); if (fMark) fMark.textContent = fmt(p.currentPrice); if (fPnl) { fPnl.textContent = `${Number(p.unrealizedPnL) >= 0 ? '+' : ''}${fmt(p.unrealizedPnL)}`; fPnl.className = `num ${Number(p.unrealizedPnL) >= 0 ? 'pnl-pos' : 'pnl-neg'}`; } }
      if (this.closeBtn) this.closeBtn.textContent = inPos ? `FLATTEN ${p.side} ${p.quantity}` : 'CLOSE POSITION';
      const fillsEl = document.getElementById('ticket-fills-list');
      if (fillsEl) fillsEl.innerHTML = trades.length ? trades.slice(-3).reverse().map(t => { const net = t.netPnL ?? t.realizedPnL ?? 0; const cls = net >= 0 ? 'pnl-pos' : 'pnl-neg'; return `<div class="trade-row"><span class="num">${t.symbol} ${t.side} ${t.quantity}</span><span class="num ${cls}">${net >= 0 ? '+' : '-'}$${Math.abs(net).toFixed(2)}</span></div>`; }).join('') : '<span class="empty-hint">No fills yet</span>';
    } catch {}
  }
}
