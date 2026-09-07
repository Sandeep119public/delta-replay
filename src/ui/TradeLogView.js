import { formatTime } from '../utils/time.js';

import { assertTradingPresentation } from '../ports/TradingPresentationPort.js';

/**
 * TradeLogView manages trade execution history tables, pending order lists,
 * order cancellation triggers, and the sidebar activity badge.
 *
 * Trading capabilities arrive only as the narrow presentation contract
 * ({ snapshot, actions, events, on }); engine-shaped objects are rejected.
 */
export class TradeLogView {
  constructor({
    trading = null,
    tradesListEl,
    pendingListEl = typeof document !== 'undefined' ? document.getElementById('pending-orders-list') : null,
    activityBadge = typeof document !== 'undefined' ? document.getElementById('activity-badge') : null,
    onError = null,
    onRender = null,
  } = {}) {
    this.trading = trading ? assertTradingPresentation(trading) : null;
    this.tradesListEl = tradesListEl;
    this.pendingListEl = pendingListEl;
    this.activityBadge = activityBadge;
    this.onError = onError;
    this.onRender = onRender;
    this._pendingBindings = [];
  }

  destroy() { this._pendingBindings.forEach(([btn, handler]) => btn.removeEventListener?.('click', handler)); this._pendingBindings = []; }

  _fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    const sign = n >= 0 ? '' : '-';
    return `${sign}$${Math.abs(n).toFixed(2)}`;
  }

  _fmtTime(ts) {
    if (!ts) return '—';
    try { return formatTime(ts); } catch { return String(ts); }
  }

  cancelOrder(orderId) {
    if (!this.trading) throw new Error('TradeLogView requires a trading presentation to cancel orders');
    const res = this.trading.actions.cancelOrder(orderId);
    if (!res.success) this.onError?.(res.message);
    this.onRender?.();
    return res;
  }

  renderPending(pendingOrders = [], allOrders = []) {
    if (!this.pendingListEl) return;

    if (allOrders.length === 0) {
      this.pendingListEl.innerHTML = '<span class="empty-hint">No pending orders</span>';
      return;
    }

    const pendings = pendingOrders;
    const nonPending = allOrders.filter(o => o.status !== 'PENDING').slice().reverse().slice(0, 5);

    let html = '';
    if (pendings.length === 0) {
      html += '<div class="empty-hint">No pending orders</div>';
    } else {
      html += pendings.map(o => {
        const statusCls = o.status === 'PENDING' ? 'pnl-pos' : (o.status === 'FILLED' ? 'pnl-pos' : 'pnl-neg');
        const price = o.type === 'STOP_MARKET' ? o.stopPrice : o.limitPrice;
        const typeLabel = o.type === 'STOP_MARKET' ? 'STOP' : (o.type || 'LIMIT');
        const borderColor = o.side === 'BUY' ? 'var(--jade, #266b47)' : 'var(--cinnabar, #a83324)';
        return `<div class="trade-row" style="border-left:3px solid ${borderColor}; padding-left:6px;">
          <span><b>${o.id}</b> ${typeLabel} ${o.side} ${o.quantity} @ ${price != null ? Number(price).toFixed(2) : '—'} <span class="${statusCls}">[${o.status}]</span><br/><small>${this._fmtTime(o.createdReplayTime)}</small></span>
          <span><button class="btn btn-secondary" data-cancel-id="${o.id}" style="padding:2px 6px; min-height:24px; font-size:10px;">Cancel</button></span>
        </div>`;
      }).join('');
    }

    if (nonPending.length > 0) {
      html += '<div style="margin-top:6px; font-size:10px; color:var(--text-muted); border-top:1px solid var(--border); padding-top:4px;">Recent</div>';
      html += nonPending.map(o => {
        let color = 'var(--ink-muted, #726453)';
        if (o.status === 'FILLED') color = 'var(--jade, #266b47)';
        else if (o.status === 'CANCELLED') color = 'var(--bamboo-gold, #b38232)';
        else if (o.status === 'REJECTED') color = 'var(--cinnabar, #a83324)';
        const price = o.stopPrice ?? o.limitPrice;
        const typeLabel = o.type === 'STOP_MARKET' ? 'STOP ' : (o.type === 'LIMIT' ? 'LIMIT ' : '');
        return `<div class="trade-row" style="opacity:0.85;">
          <span><b>${o.id}</b> ${typeLabel}${o.side} ${o.quantity} @ ${price != null ? Number(price).toFixed(2) : '—'} <span style="color:${color}">[${o.status}]</span></span>
          <span style="font-size:10px;">${o.filledPrice != null ? '@' + Number(o.filledPrice).toFixed(2) : ''} ${o.rejectionReason || o.cancelReason || ''}</span>
        </div>`;
      }).join('');
    }

    this.pendingListEl.innerHTML = html;
    this._pendingBindings.forEach(([btn, handler]) => btn.removeEventListener?.('click', handler));
    this._pendingBindings = [];
    this.pendingListEl.querySelectorAll('[data-cancel-id]').forEach(btn => { const handler = () => this.cancelOrder(btn.getAttribute('data-cancel-id')); btn.addEventListener('click', handler); this._pendingBindings.push([btn, handler]); });
  }

  render(trades = []) {
    // Trades List
    if (this.tradesListEl) {
      if (trades.length === 0) {
        this.tradesListEl.innerHTML = '<span class="empty-hint">No trades yet</span>';
      } else {
        this.tradesListEl.innerHTML = trades.slice().reverse().map(t => {
          const cls = (t.netPnL ?? t.realizedPnL) >= 0 ? 'pnl-pos' : 'pnl-neg';
          const gross = t.grossPnL ?? t.realizedPnL;
          const fee = t.totalFee ?? ((t.entryFee ?? 0) + (t.exitFee ?? 0));
          const net = t.netPnL ?? t.realizedPnL;
          return `<div class="trade-row"><span>${t.symbol} ${t.side} ${t.quantity} @ ${t.entryPrice.toFixed(2)}→${t.exitPrice.toFixed(2)}</span><span>${this._fmtMoney(gross)} / <span class="pnl-neg">${this._fmtMoney(fee)}</span> / <span class="${cls}">${this._fmtMoney(net)}</span></span></div>`;
        }).join('');
      }
    }

    // Pending Orders
    const snap = this.trading?.snapshot() || { pendingOrders: [], orders: [] };
    const pendingOrders = snap.pendingOrders || [];
    const allOrders = snap.orders || [];
    this.renderPending(pendingOrders, allOrders);

    // Activity Badge
    const activityBadge = this.activityBadge || document.getElementById('activity-badge');
    if (activityBadge) {
      const totalActivity = pendingOrders.length + trades.length;
      activityBadge.textContent = String(totalActivity);
      activityBadge.classList.toggle('has-pending', pendingOrders.length > 0);
    }
  }
}
