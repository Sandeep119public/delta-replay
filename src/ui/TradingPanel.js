import { AccountSummaryView } from './AccountSummaryView.js';
import { OrderFormView } from './OrderFormView.js';
import { PositionView } from './PositionView.js';
import { TradeLogView } from './TradeLogView.js';
import { TradingEvents } from '../trading/TradingEvents.js';

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
    this.errorTimeout = null;

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
    this.engine.on(TradingEvents.ACCOUNT_UPDATED, rerender);
    this.engine.on(TradingEvents.POSITION_OPENED, rerender);
    this.engine.on(TradingEvents.POSITION_CLOSED, rerender);
    this.engine.on(TradingEvents.POSITION_UPDATED, rerender);
    this.engine.on(TradingEvents.TRADE_EXECUTED, rerender);
    this.engine.on(TradingEvents.ACCOUNT_RESET, rerender);
    this.engine.on(TradingEvents.ORDER_PLACED, rerender);
    this.engine.on(TradingEvents.ORDER_TRIGGERED, rerender);
    this.engine.on(TradingEvents.ORDER_FILLED, rerender);
    this.engine.on(TradingEvents.ORDER_CANCELLED, rerender);
    this.engine.on(TradingEvents.STOP_LOSS_TRIGGERED, rerender);
    this.engine.on(TradingEvents.TAKE_PROFIT_TRIGGERED, rerender);
    this.engine.on(TradingEvents.ORDER_REJECTED, (err) => this.showError(err?.message || err?.reason || 'Order rejected'));
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
    this._renderTicketState(positions, trades);
  }

  /** State-aware order ticket: FLAT shows entry buttons, LONG/SHORT shows FLATTEN hero. */
  _renderTicketState(positions = [], trades = []) {
    try {
      const inPos = positions.length > 0;
      const p = positions[0];
      const ticket = document.getElementById('order-ticket');
      const hint = document.getElementById('ticket-state-hint');
      const pill = document.getElementById('pos-state-pill');
      const flatSummary = document.getElementById('ticket-flatten-summary');
      const fEntry = document.getElementById('flatten-entry');
      const fMark = document.getElementById('flatten-mark');
      const fPnl = document.getElementById('flatten-pnl');
      const actionsGrid = ticket?.querySelector('.order-actions-grid');

      if (ticket) {
        ticket.classList.toggle('is-flat', !inPos);
        ticket.classList.toggle('is-in-position', inPos);
        ticket.classList.toggle(`is-${String(p?.side || 'flat').toLowerCase()}`, true);
      }
      if (document.body) {
        document.body.classList.toggle('has-position', inPos);
        document.body.classList.toggle('is-flat', !inPos);
      }
      if (pill) {
        pill.textContent = inPos ? p.side : 'FLAT';
        pill.className = `pos-state-pill ${inPos ? (p.side === 'LONG' ? 'is-long' : 'is-short') : 'is-flat'}`;
      }
      if (hint) {
        hint.textContent = inPos
          ? `${p.side} ${p.quantity} · uPnL ${Number(p.unrealizedPnL) >= 0 ? '+' : ''}$${Number(p.unrealizedPnL).toFixed(2)}`
          : 'FLAT — pick a size';
      }
      const fmt = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return '—';
        return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
      };
      if (flatSummary) flatSummary.classList.toggle('hidden', !inPos);
      if (inPos) {
        if (fEntry) fEntry.textContent = fmt(p.entryPrice);
        if (fMark) fMark.textContent = fmt(p.currentPrice);
        if (fPnl) {
          fPnl.textContent = `${Number(p.unrealizedPnL) >= 0 ? '+' : ''}${fmt(p.unrealizedPnL).replace('$', '$')}`;
          fPnl.className = `num ${Number(p.unrealizedPnL) >= 0 ? 'pnl-pos' : 'pnl-neg'}`;
        }
      }
      if (this.closeBtn) {
        this.closeBtn.textContent = inPos ? `FLATTEN ${p.side} ${p.quantity}` : 'CLOSE POSITION';
      }

      // Recent fills strip inside the trade tab so position + ticket + fills are visible together.
      const fillsEl = document.getElementById('ticket-fills-list');
      if (fillsEl) {
        if (!trades.length) {
          fillsEl.innerHTML = '<span class="empty-hint">No fills yet</span>';
        } else {
          fillsEl.innerHTML = trades.slice(-3).reverse().map(t => {
            const net = t.netPnL ?? t.realizedPnL ?? 0;
            const cls = net >= 0 ? 'pnl-pos' : 'pnl-neg';
            return `<div class="trade-row"><span class="num">${t.symbol} ${t.side} ${t.quantity}</span><span class="num ${cls}">${net >= 0 ? '+' : '-'}$${Math.abs(net).toFixed(2)}</span></div>`;
          }).join('');
        }
      }
    } catch {}
  }
}
