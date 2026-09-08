import { assertTradingPresentation } from '../ports/TradingPresentationPort.js';

export class AccountSummaryView {
  constructor({ trading = null, balanceEl, equityEl, realizedEl, unrealizedEl, feesEl, resetBtn,
    statWinEl = document.getElementById('stat-winrate'), statPfEl = document.getElementById('stat-pf'),
    statTrEl = document.getElementById('stat-trades'), statRetEl = document.getElementById('stat-return'),
    onError = null, onRender = null } = {}) {
    this.trading = trading ? assertTradingPresentation(trading) : null;
    Object.assign(this, { balanceEl, equityEl, realizedEl, unrealizedEl, feesEl, resetBtn, statWinEl, statPfEl, statTrEl, statRetEl, onError, onRender });
    this.busy = false;
    this._listeners = [];
    this._listen(this.resetBtn, 'click', () => void this.resetAccount());
    this._bindCapitalControls();
  }

  _listen(element, type, handler) {
    element?.addEventListener?.(type, handler);
    if (element?.removeEventListener) this._listeners.push([element, type, handler]);
  }

  _bindCapitalControls() {
    const setBalance = (balance) => void this.setCapital(Number(balance));
    document.querySelectorAll('.capital-chip').forEach((chip) => {
      this._listen(chip, 'click', () => setBalance(chip.getAttribute('data-balance')));
    });
    const customInput = document.getElementById('custom-capital-input');
    const customButton = document.getElementById('btn-set-capital');
    this._listen(customButton, 'click', () => void this.setCapital(Number(customInput?.value)));
    const feeSelect = document.getElementById('fee-tier-select');
    this._listen(feeSelect, 'change', () => void this.setFeeRate(Number(feeSelect.value)));
  }

  async _run(action) {
    if (this.busy) return { success: false, message: 'Account request already in progress' };
    this.busy = true;
    try {
      const result = await action();
      if (!result?.success) this.onError?.(result?.message || 'Account request failed');
      else this.onRender?.();
      return result;
    } catch (error) {
      this.onError?.(error?.message || 'Account request failed');
      return { success: false, message: error?.message || 'Account request failed' };
    } finally {
      this.busy = false;
      this.onRender?.();
    }
  }

  resetAccount() {
    return this._run(() => this.trading.actions.resetAccount());
  }

  setCapital(balance) {
    if (!Number.isFinite(balance) || balance <= 0) { const message = 'Enter a valid capital amount (> 0)'; this.onError?.(message); return Promise.resolve({ success: false, message }); }
    if (this.trading.actions.hasOpenPosition?.()) { const message = 'Close the position before changing starting balance'; this.onError?.(message); return Promise.resolve({ success: false, message }); }
    return this._run(() => this.trading.actions.setCapital(balance));
  }

  setFeeRate(rate) {
    if (!Number.isFinite(rate) || rate < 0) { const message = 'Enter a valid fee rate'; this.onError?.(message); return Promise.resolve({ success: false, message }); }
    return this._run(() => this.trading.actions.setFeeRate(rate));
  }

  destroy() { this._listeners.splice(0).forEach(([el, type, handler]) => el.removeEventListener?.(type, handler)); }

  _fmtMoney(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}` : '—';
  }

  render(account, trades = []) {
    if (!account) return;
    if (this.balanceEl) this.balanceEl.textContent = this._fmtMoney(account.cashBalance);
    if (this.equityEl) this.equityEl.textContent = this._fmtMoney(account.equity);
    if (this.realizedEl) { this.realizedEl.textContent = this._fmtMoney(account.realizedPnL); this.realizedEl.className = account.realizedPnL >= 0 ? 'pnl-pos' : 'pnl-neg'; }
    if (this.unrealizedEl) { this.unrealizedEl.textContent = this._fmtMoney(account.unrealizedPnL); this.unrealizedEl.className = account.unrealizedPnL >= 0 ? 'pnl-pos' : 'pnl-neg'; }
    if (this.feesEl) this.feesEl.textContent = this._fmtMoney(account.totalFees);

    const stats = this.trading?.snapshot().stats || { totalTrades: trades.length, winRate: 0, profitFactor: 0, netReturn: 0 };
    if (this.statWinEl) this.statWinEl.textContent = `${Number(stats.winRate).toFixed(1)}%`;
    if (this.statPfEl) this.statPfEl.textContent = Number.isFinite(stats.profitFactor) ? `${Number(stats.profitFactor).toFixed(2)}x` : '—';
    if (this.statTrEl) this.statTrEl.textContent = String(stats.totalTrades);
    if (this.statRetEl) this.statRetEl.textContent = `${stats.netReturn >= 0 ? '+' : ''}${Number(stats.netReturn).toFixed(2)}%`;
    const starting = Number(account.startingBalance);
    if (Number.isFinite(starting)) document.querySelectorAll('.capital-chip').forEach((chip) => chip.classList.toggle('active', Number(chip.getAttribute('data-balance')) === starting));
  }
}
