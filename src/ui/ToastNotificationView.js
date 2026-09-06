/**
 * ToastNotificationView manages temporary floating notifications on the chart or viewport.
 */
export class ToastNotificationView {
  constructor(toastEl = null, defaultDuration = 2500) {
    this.toastEl = toastEl || (typeof document !== 'undefined' ? document.getElementById('chart-toast') : null);
    this.defaultDuration = defaultDuration;
    this._timeout = null;
  }

  show(msg, duration = this.defaultDuration) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.classList.remove('hidden');
    if (this._timeout) clearTimeout(this._timeout);
    this._timeout = setTimeout(() => {
      this.hide();
    }, duration);
  }

  hide() {
    if (!this.toastEl) return;
    this.toastEl.classList.add('hidden');
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
  }

  destroy() {
    this.hide();
    this.toastEl = null;
  }
}
