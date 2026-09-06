/**
 * Thin DOM view for transient trading/replay errors.
 * Business logic should call the injected view instead of querying document IDs.
 */
export class TradingErrorView {
  constructor({ element = null, durationMs = 3000 } = {}) {
    this.element = element;
    this.durationMs = durationMs;
    this._hideTimer = null;
  }

  show(message) {
    if (!this.element) return;
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
    this.element.textContent = String(message ?? '');
    this.element.classList.remove('hidden');
    if (this.durationMs > 0) {
      this._hideTimer = setTimeout(() => this.hide(), this.durationMs);
    }
  }

  hide() {
    if (!this.element) return;
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
    this.element.textContent = '';
    this.element.classList.add('hidden');
  }

  destroy() {
    this.hide();
    this.element = null;
  }
}
