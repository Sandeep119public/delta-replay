import { formatTime } from '../utils/time.js';
import { assertTradingPresentation } from '../ports/TradingPresentationPort.js';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const fmtNumber = (value, digits = 2) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
};

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

    if (!allOrders.length) {
      this.pendingListEl.innerHTML = '<span class="empty-hint">No pending orders</span>';
      return;
    }

    const pendings = Array.isArray(pendingOrders) ? pendingOrders : [];
    const orders = Array.isArray(allOrders) ? allOrders : [];
    const nonPending = orders.filter((o) => o.status !== 'PENDING').slice().reverse().slice(0, 5);

    let html = '';
    if (!pendings.length) {
      html += '<div class="empty-hint">No pending orders</div>';
    } else {
      html += pendings.map((o) => {
        const status = escapeHtml(o.status || 'PENDING');
        const statusCls = o.status === 'PENDING' ? 'pnl-pos' : (o.status === 'FILLED' ? 'pnl-pos' : 'pnl-neg');
        const price = o.type === 'STOP_MARKET' ? o.stopPrice : o.limitPrice;
        const typeLabel = o.type === 'STOP_MARKET' ? 'STOP' : (o.type || 'LIMIT');
        const side = o.side || '—';
        const borderColor = side === 'BUY' ? 'var(--jade, #266b47)' : 'var(--cinnabar, #a83324)';
        const id = escapeHtml(o.id);
        return `<div class="trade-row" style="border-left:3px solid ${borderColor}; padding-left:6px;">
          <span><b>${id}</b> ${escapeHtml(typeLabel)} ${escapeHtml(side)} ${escapeHtml(o.quantity)} @ ${fmtNumber(price)} <span class="${statusCls}">[${status}]</span><br/><small>${escapeHtml(this._fmtTime(o.createdReplayTime))}</small></span>
          <span><button class="btn btn-secondary" data-cancel-id="${id}" style="padding:2px 6px; min-height:24px; font-size:10px;">Cancel</button></span>
        </div>`;
      }).join('');
    }

    if (nonPending.length) {
      html += '<div style="margin-top:6px; font-size:10px; color:var(--text-muted); border-top:1px solid var(--border); padding-top:4px;">Recent</div>';
      html += nonPending.map((o) => {
        const status = o.status || '—';
        const color = status === 'FILLED' ? 'var(--jade, #266b47)' : status === 'CANCELLED' ? 'var(--bamboo-gold, #b38232)' : status === 'REJECTED' ? 'var(--cinnabar, #a83324)' : 'var(--ink-muted, #726453)';
        const price = o.stopPrice ?? o.limitPrice;
        const typeLabel = o.type === 'STOP_MARKET' ? 'STOP ' : (o.type === 'LIMIT' ? 'LIMIT ' : '');
        return `<div class="trade-row" style="opacity:0.85;">
          <span><b>${escapeHtml(o.id)}</b> ${escapeHtml(typeLabel)}${escapeHtml(o.side)} ${escapeHtml(o.quantity)} @ ${fmtNumber(price)} <span style="color:${color}">[${escapeHtml(status)}]</span></span>
          <span style="font-size:10px;">${o.filledPrice != null ? '@' + fmtNumber(o.filledPrice) : ''} ${escapeHtml(o.rejectionReason || o.cancelReason || '')}</span>
        </div>`;
      }).join('');
    }

    this.pendingListEl.innerHTML = html;
    this._pendingBindings.forEach(([btn, handler]) => btn.removeEventListener?.('click', handler));
    this._pendingBindings = [];
    this.pendingListEl.querySelectorAll('[data-cancel-id]').forEach((btn) => {
      const handler = () => this.cancelOrder(btn.getAttribute('data-cancel-id'));
      btn.addEventListener('click', handler);
      this._pendingBindings.push([btn, handler]);
    });
  }

  render(trades = []) {
    if (this.tradesListEl) {
      const list = Array.isArray(trades) ? trades : [];
      if (!list.length) {
        this.tradesListEl.innerHTML = '<span class="empty-hint">No trades yet</span>';
      } else {
        this.tradesListEl.innerHTML = list.slice().reverse().map((t) => {
          const net = Number(t.netPnL ?? t.realizedPnL);
          const cls = Number.isFinite(net) && net >= 0 ? 'pnl-pos' : 'pnl-neg';
          const gross = t.grossPnL ?? t.realizedPnL;
          const fee = t.totalFee ?? ((t.entryFee ?? 0) + (t.exitFee ?? 0));
          return `<div class="trade-row"><span>${escapeHtml(t.symbol)} ${escapeHtml(t.side)} ${escapeHtml(t.quantity)} @ ${fmtNumber(t.entryPrice)}→${fmtNumber(t.exitPrice)}</span><span>${this._fmtMoney(gross)} / <span class="pnl-neg">${this._fmtMoney(fee)}</span> / <span class="${cls}">${this._fmtMoney(net)}</span></span></div>`;
        }).join('');
      }
    }

    const snap = this.trading?.snapshot() || { pendingOrders: [], orders: [] };
    const pendingOrders = snap.pendingOrders || [];
    const allOrders = snap.orders || [];
    this.renderPending(pendingOrders, allOrders);

    const activityBadge = this.activityBadge || document.getElementById('activity-badge');
    if (activityBadge) {
      activityBadge.textContent = String(pendingOrders.length + (Array.isArray(trades) ? trades.length : 0));
      activityBadge.classList.toggle('has-pending', pendingOrders.length > 0);
    }
  }
}
