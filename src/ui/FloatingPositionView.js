/**
 * FloatingPositionView manages the floating badge and quick-close button
 * overlaid directly on the chart viewport.
 */
export class FloatingPositionView {
  constructor({
    tradingEngine,
    container = (typeof document !== 'undefined' ? document.getElementById('chart-floating-bar') : null),
    badgeEl = (typeof document !== 'undefined' ? document.getElementById('chart-pos-badge') : null),
    entryEl = (typeof document !== 'undefined' ? document.getElementById('chart-pos-entry') : null),
    pnlEl = (typeof document !== 'undefined' ? document.getElementById('chart-pos-pnl') : null),
    closeBtn = (typeof document !== 'undefined' ? document.getElementById('btn-chart-close') : null),
  } = {}) {
    this.tradingEngine = tradingEngine;
    this.container = container;
    this.badgeEl = badgeEl;
    this.entryEl = entryEl;
    this.pnlEl = pnlEl;
    this.closeBtn = closeBtn;

    this._bindCloseBtn();
  }

  _bindCloseBtn() {
    if (!this.closeBtn) return;
    this.closeBtn.addEventListener('click', () => {
      const positions = this.tradingEngine?.getPositions?.() || [];
      if (positions.length > 0) {
        this.tradingEngine.closePosition(positions[0].symbol);
      }
    });
  }

  render(position) {
    if (!this.container) return;

    if (!position) {
      this.container.classList.add('hidden');
      return;
    }

    this.container.classList.remove('hidden');

    if (this.badgeEl) {
      this.badgeEl.textContent = `${position.side} ${position.quantity}`;
      this.badgeEl.className = `chart-pos-badge ${position.side === 'LONG' ? 'pos-long' : 'pos-short'}`;
    }

    if (this.entryEl) {
      this.entryEl.textContent = `@ $${Number(position.entryPrice).toFixed(2)}`;
    }

    if (this.pnlEl) {
      const pnl = Number(position.unrealizedPnL || 0);
      this.pnlEl.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
      this.pnlEl.className = `chart-pos-pnl ${pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`;
    }
  }
}
