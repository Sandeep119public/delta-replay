import { assertTradingPresentation } from '../ports/TradingPresentationPort.js';

/**
 * FloatingPositionView manages the professional "Live Position Capsule"
 * overlaid directly on the chart viewport.
 *
 * Trading capabilities arrive only as the narrow presentation contract
 * ({ snapshot, actions, events, on }); engine-shaped objects are rejected.
 */
export class FloatingPositionView {
  constructor({
    trading = null,
    container = (typeof document !== 'undefined' ? document.getElementById('chart-floating-bar') : null),
    symbolEl = (typeof document !== 'undefined' ? document.getElementById('chart-pos-symbol') : null),
    sideTextEl = (typeof document !== 'undefined' ? document.getElementById('chart-pos-side-text') : null),
    qtyEl = (typeof document !== 'undefined' ? document.getElementById('chart-pos-qty') : null),
    entryEl = (typeof document !== 'undefined' ? document.getElementById('chart-pos-entry') : null),
    markEl = (typeof document !== 'undefined' ? document.getElementById('chart-pos-mark') : null),
    pnlEl = (typeof document !== 'undefined' ? document.getElementById('chart-pos-pnl') : null),
    iconEl = (typeof document !== 'undefined' ? document.getElementById('chart-pos-icon') : null),
    closeBtn = (typeof document !== 'undefined' ? document.getElementById('btn-chart-close') : null),
    // Legacy badge element (pre-capsule layout) — kept for backwards compatibility.
    badgeEl = (typeof document !== 'undefined' ? document.getElementById('chart-pos-badge') : null),
  } = {}) {
    this.trading = trading ? assertTradingPresentation(trading) : null;
    this.container = container;
    this.symbolEl = symbolEl;
    this.sideTextEl = sideTextEl;
    this.qtyEl = qtyEl;
    this.entryEl = entryEl;
    this.markEl = markEl;
    this.pnlEl = pnlEl;
    this.iconEl = iconEl;
    this.closeBtn = closeBtn;
    this.badgeEl = badgeEl;

    this._lastPnl = 0;
    this._boundClose = () => {
      const positions = this.trading?.snapshot()?.positions || [];
      if (positions.length > 0) this.trading.actions.flattenPosition(positions[0].symbol);
    };
    this._bindCloseBtn();
  }

  _bindCloseBtn() {
    if (!this.closeBtn) return;
    // Guard against double-binding when view is re-instantiated on the same DOM node.
    if (this.closeBtn.__floatingPosBound) return;
    this.closeBtn.addEventListener('click', this._boundClose);
    this.closeBtn.__floatingPosBound = true;
  }

  destroy() {
    if (this.closeBtn?.__floatingPosBound) {
      this.closeBtn.removeEventListener?.('click', this._boundClose);
      delete this.closeBtn.__floatingPosBound;
    }
  }

  _renderIcon(side) {
    if (!this.iconEl) return;
    if (side === 'LONG') {
      this.iconEl.className = 'capsule-side-indicator long';
      this.iconEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`;
    } else {
      this.iconEl.className = 'capsule-side-indicator short';
      this.iconEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
    }
  }

  render(position) {
    if (!this.container) return;

    if (!position) {
      this.container.classList.add('hidden');
      return;
    }

    this.container.classList.remove('hidden');

    if (this.symbolEl) this.symbolEl.textContent = position.symbol || '';
    if (this.sideTextEl) {
      this.sideTextEl.textContent = position.side || '';
      this.sideTextEl.className = `capsule-side ${position.side === 'LONG' ? 'long-bg' : 'short-bg'}`;
    }

    if (this.qtyEl) this.qtyEl.textContent = `${Number(position.quantity).toFixed(3)} ${position.symbol?.replace('USDT', '') || ''}`;

    this._renderIcon(position.side);

    const entry = Number(position.entryPrice);
    const mark = Number(position.currentPrice || entry);
    const pnl = Number(position.unrealizedPnL || 0);

    const fmt = (v) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    if (this.entryEl) {
      // Legacy badge layout expects the exact "@ $..." + toFixed(2) format
      // (no thousands separator) — preserve it when badgeEl is in use.
      // New capsule layout uses locale-aware formatting with commas.
      this.entryEl.textContent = this.badgeEl ? `@ $${entry.toFixed(2)}` : fmt(entry);
    }
    if (this.markEl) this.markEl.textContent = fmt(mark);

    // Legacy badge support (pre-capsule HTML): "LONG 0.5" + pos-long/pos-short.
    if (this.badgeEl) {
      this.badgeEl.textContent = `${position.side} ${position.quantity}`;
      this.badgeEl.className = `chart-pos-badge ${position.side === 'LONG' ? 'pos-long' : 'pos-short'}`;
    }

    if (this.pnlEl) {
      const isPos = pnl >= 0;
      this.pnlEl.textContent = this.badgeEl
        ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`
        : `${isPos ? '+' : '-'}$${Math.abs(pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      // Preserve legacy class hooks when rendering into the legacy layout so
      // existing tests/selectors keep working; use capsule classes otherwise.
      const baseClass = this.badgeEl ? 'chart-pos-pnl' : 'capsule-pnl';
      const modifier = this.badgeEl ? (isPos ? 'pnl-pos' : 'pnl-neg') : (isPos ? 'pos' : 'neg');
      this.pnlEl.className = `${baseClass} ${modifier}`;

      // Visual flash effect on PnL change to indicate live updates.
      // Skipped for mock elements without offsetWidth/classList token support.
      const diff = pnl - this._lastPnl;
      if (Math.abs(diff) > 0.01 && typeof this.pnlEl.offsetWidth !== 'undefined') {
        try {
          const flashClass = diff >= 0 ? 'flash-up' : 'flash-down';
          this.pnlEl.classList.remove('flash-up', 'flash-down');
          // Trigger reflow to restart animation
          void this.pnlEl.offsetWidth;
          this.pnlEl.classList.add(flashClass);
        } catch {}
      }
      this._lastPnl = pnl;
    }
  }
}
