import { ErrorCategory, LoadingState, DataError } from '../data/DataError.js';

/**
 * ErrorPanel manages user-facing error notices, diagnostic technical details,
 * and retry triggers.
 */
export class ErrorPanel {
  constructor({
    container = document.getElementById('error-panel'),
    titleEl = document.getElementById('error-panel-title'),
    messageEl = document.getElementById('error-panel-message'),
    contextEl = document.getElementById('error-panel-context'),
    dismissBtn = document.getElementById('error-panel-dismiss'),
    retryBtn = document.getElementById('error-panel-retry'),
    detailsBtn = document.getElementById('error-panel-details'),
    onRetry = null,
  } = {}) {
    this.container = container;
    this.titleEl = titleEl;
    this.messageEl = messageEl;
    this.contextEl = contextEl;
    this.dismissBtn = dismissBtn;
    this.retryBtn = retryBtn;
    this.detailsBtn = detailsBtn;
    this.onRetry = onRetry;
    this.currentDataError = null;
    this._listeners = [];

    this._bindEvents();
  }

  _listen(el, type, handler) {
    if (!el?.addEventListener) return;
    el.addEventListener(type, handler);
    this._listeners.push([el, type, handler]);
  }

  _bindEvents() {
    this._listen(this.dismissBtn, 'click', () => this.hide());
    this._listen(this.detailsBtn, 'click', () => {
      if (!this.contextEl || !this.currentDataError) return;
      const isHidden = this.contextEl.classList.contains('hidden');
      if (isHidden) {
        this.contextEl.textContent = this.currentDataError.toTechnicalString ? this.currentDataError.toTechnicalString() : JSON.stringify(this.currentDataError, null, 2);
        this.contextEl.classList.remove('hidden');
        this.detailsBtn.textContent = 'Hide Details';
      } else {
        this.contextEl.classList.add('hidden');
        this.detailsBtn.textContent = 'Details';
      }
    });
    this._listen(this.retryBtn, 'click', () => {
      this.hide();
      if (typeof this.onRetry === 'function') this.onRetry();
    });
  }

  static isRetryableCategory(category) {
    return category === ErrorCategory.NETWORK || category === ErrorCategory.TIMEOUT || category === ErrorCategory.CORS;
  }

  show(dataError, { severity = null, inline = false, pauseReplay = false, onPause = null } = {}) {
    if (!this.container) return;
    if (!dataError) {
      this.hide();
      return;
    }
    this.currentDataError = dataError;
    const level = severity || ErrorPanel.inferSeverity(dataError) || 'error';
    this.container.dataset.severity = level;
    this.container.classList.toggle('severity-info', level === 'info');
    this.container.classList.toggle('severity-warn', level === 'warn');
    this.container.classList.toggle('severity-critical', level === 'critical');
    this.container.classList.toggle('is-inline', inline === true || (inline !== false && level === 'info'));
    if (this.titleEl) this.titleEl.textContent = 'Data Error';
    if (this.contextEl) {
      this.contextEl.classList.add('hidden');
      this.contextEl.textContent = '';
    }
    if (this.detailsBtn) this.detailsBtn.textContent = 'Details';
    const retryable = dataError.category ? ErrorPanel.isRetryableCategory(dataError.category) : false;
    if (this.retryBtn) this.retryBtn.classList.toggle('hidden', !retryable);
    let msg = dataError.userMessage || dataError.message || 'An error occurred loading historical data.';
    const ctx = dataError.context || {};
    const ctxParts = [];
    if (ctx.symbol && ctx.timeframe) ctxParts.push(`${ctx.symbol} · ${ctx.timeframe}`);
    if (ctx.start != null && ctx.end != null) {
      const fmt = (ts) => {
        try { return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }
        catch { return String(ts); }
      };
      ctxParts.push(`${fmt(ctx.start)} → ${fmt(ctx.end)}`);
    }
    if (ctxParts.length) msg += '\n' + ctxParts.join(' · ');
    if (this.messageEl) this.messageEl.textContent = msg;
    this.container.classList.remove('hidden');
    if ((level === 'critical' && pauseReplay !== false) || pauseReplay === true) {
      try { if (typeof onPause === 'function') onPause(); } catch (error) { console.warn('[ErrorPanel] pause callback failed', error); }
    }
  }

  static inferSeverity(dataError) {
    try {
      const hay = `${dataError?.title || ''} ${dataError?.userMessage || ''} ${dataError?.message || ''} ${dataError?.code || ''} ${dataError?.category || ''}`.toLowerCase();
      if (/liquidat|forced close|margin call|state corrupt|integrity failure/.test(hay)) return 'critical';
      if (/data gap|missing|hole|stale|partial|no_?data|empty/.test(hay)) return 'warn';
      if (/invalid order|insufficient|reject|order failed/.test(hay)) return 'error';
    } catch (error) { console.warn('[ErrorPanel] severity inference failed', error); }
    return 'error';
  }

  showGeneric(msg) {
    const dataErr = new DataError({ category: ErrorCategory.UNKNOWN, technicalMessage: msg, userMessage: msg });
    this.show(dataErr);
  }

  showInfo(msg) {
    const dataErr = new DataError({ category: ErrorCategory.UNKNOWN, technicalMessage: msg, userMessage: msg });
    this.show(dataErr, { severity: 'info', inline: true });
  }

  hide() {
    if (this.container) {
      this.container.classList.add('hidden');
      this.container.classList.remove('severity-info', 'severity-warn', 'severity-critical', 'is-inline');
      try { delete this.container.dataset.severity; } catch (error) { console.warn('[ErrorPanel] failed to clear severity state', error); }
    }
    this.currentDataError = null;
  }

  destroy() {
    this._listeners.forEach(([el, type, handler]) => el.removeEventListener?.(type, handler));
    this._listeners = [];
    this.onRetry = null;
    this.hide();
  }
}
