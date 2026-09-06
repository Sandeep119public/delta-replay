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

    this._bindEvents();
  }

  _bindEvents() {
    if (this.dismissBtn) {
      this.dismissBtn.addEventListener('click', () => this.hide());
    }

    if (this.detailsBtn) {
      this.detailsBtn.addEventListener('click', () => {
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
    }

    if (this.retryBtn) {
      this.retryBtn.addEventListener('click', () => {
        this.hide();
        if (typeof this.onRetry === 'function') {
          this.onRetry();
        }
      });
    }
  }

  static isRetryableCategory(category) {
    return category === ErrorCategory.NETWORK || category === ErrorCategory.TIMEOUT || category === ErrorCategory.CORS;
  }

  show(dataError, { severity = null, pauseReplay = false, onPause = null } = {}) {
    if (!this.container) return;
    if (!dataError) {
      this.hide();
      return;
    }

    this.currentDataError = dataError;
    // Severity: warn (data gap) vs critical (liquidation / invalid order / margin).
    const inferred = ErrorPanel.inferSeverity(dataError);
    const level = severity || inferred || 'error';
    this.container.dataset.severity = level;
    this.container.classList.toggle('severity-warn', level === 'warn');
    this.container.classList.toggle('severity-critical', level === 'critical');
    if (this.titleEl) this.titleEl.textContent = 'Data Error';
    if (this.contextEl) {
      this.contextEl.classList.add('hidden');
      this.contextEl.textContent = '';
    }
    if (this.detailsBtn) this.detailsBtn.textContent = 'Details';

    const retryable = dataError.category ? ErrorPanel.isRetryableCategory(dataError.category) : false;
    if (this.retryBtn) {
      this.retryBtn.classList.toggle('hidden', !retryable);
    }

    let msg = dataError.userMessage || dataError.message || 'An error occurred loading historical data.';
    const ctx = dataError.context || {};
    const ctxParts = [];
    if (ctx.symbol && ctx.timeframe) {
      ctxParts.push(`${ctx.symbol} · ${ctx.timeframe}`);
    }
    if (ctx.start != null && ctx.end != null) {
      const fmt = (ts) => {
        try { return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }
        catch { return String(ts); }
      };
      ctxParts.push(`${fmt(ctx.start)} → ${fmt(ctx.end)}`);
    }
    if (ctxParts.length) {
      msg += '\n' + ctxParts.join(' · ');
    }

    if (this.messageEl) this.messageEl.textContent = msg;
    this.container.classList.remove('hidden');

    if ((level === 'critical' && pauseReplay !== false) || pauseReplay === true) {
      try { if (typeof onPause === 'function') onPause(); } catch {}
    }
  }

  /** Map error content to a financial severity level. */
  static inferSeverity(dataError) {
    try {
      const hay = `${dataError?.title || ''} ${dataError?.userMessage || ''} ${dataError?.message || ''} ${dataError?.code || ''} ${dataError?.category || ''}`.toLowerCase();
      if (/liquidat|margin|invalid order|insufficient|reject/.test(hay)) return 'critical';
      if (/gap|missing|hole|stale|partial|no_?data|empty/.test(hay)) return 'warn';
    } catch {}
    return 'error';
  }

  showGeneric(msg) {
    const dataErr = new DataError({
      category: ErrorCategory.UNKNOWN,
      technicalMessage: msg,
      userMessage: msg,
    });
    this.show(dataErr);
  }

  hide() {
    if (this.container) {
      this.container.classList.add('hidden');
      this.container.classList.remove('severity-warn', 'severity-critical');
      try { delete this.container.dataset.severity; } catch {}
    }
    this.currentDataError = null;
  }
}
