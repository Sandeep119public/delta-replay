/**
 * Account summary presentation view. Trading capabilities arrive through the
 * application-provided facade, never through the trading domain module.
 */
export class AccountSummaryView {
  constructor({ engine, balanceEl, equityEl, realizedEl, unrealizedEl, feesEl, resetBtn,
    statWinEl = typeof document !== 'undefined' ? document.getElementById('stat-winrate') : null,
    statPfEl = typeof document !== 'undefined' ? document.getElementById('stat-pf') : null,
    statTrEl = typeof document !== 'undefined' ? document.getElementById('stat-trades') : null,
    statRetEl = typeof document !== 'undefined' ? document.getElementById('stat-return') : null,
    onError = null, onRender = null } = {}) {
    this.engine = engine; this.balanceEl = balanceEl; this.equityEl = equityEl; this.realizedEl = realizedEl; this.unrealizedEl = unrealizedEl; this.feesEl = feesEl;
    this.resetBtn = resetBtn; this.statWinEl = statWinEl; this.statPfEl = statPfEl; this.statTrEl = statTrEl; this.statRetEl = statRetEl; this.onError = onError; this.onRender = onRender; this._listeners = [];
    this._bindControls();
  }

  _bindControls() {
    if (this.resetBtn) { const handler = () => this.engine.resetAccount(); this.resetBtn.addEventListener('click', handler); this._listeners.push([this.resetBtn, 'click', handler]); }
    try {
      const chips = document.querySelectorAll('.capital-chip');
      const setBalance = (balance) => {
        if (this.engine.hasOpenPosition?.()) { this.onError?.('Close position before changing starting balance'); return; }
        const res = this.engine.setStartingBalance?.(balance);
        if (res?.success === false) this.onError?.(res.message);
        else this.onRender?.();
      };
      chips.forEach(chip => chip.addEventListener('click', () => {
        const balance = Number(chip.getAttribute('data-balance'));
        setBalance(balance);
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      }));
      const customInput = document.getElementById('custom-capital-input');
      const setCapitalBtn = document.getElementById('btn-set-capital');
      if (setCapitalBtn && customInput) setCapitalBtn.addEventListener('click', () => {
        const val = parseFloat(customInput.value);
        if (!Number.isFinite(val) || val <= 0) { this.onError?.('Enter a valid capital amount (> 0)'); return; }
        if (this.engine.hasOpenPosition?.()) { this.onError?.('Close position before changing starting balance'); return; }
        const res = this.engine.setStartingBalance?.(val);
        if (res?.success === false) { this.onError?.(res.message); return; }
        chips.forEach(c => c.classList.remove('active')); customInput.value = ''; this.onRender?.();
      });
      const feeSelect = document.getElementById('fee-tier-select');
      if (feeSelect) feeSelect.addEventListener('change', () => this.engine.setFeeRate?.(parseFloat(feeSelect.value)));
    } catch {}
  }

  destroy() { this._listeners.forEach(([el, type, handler]) => el.removeEventListener?.(type, handler)); this._listeners = []; }
  _fmtMoney(v) { const n = Number(v); if (!Number.isFinite(n)) return '—'; return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`; }

  render(acct, trades = []) {
    if (!acct) return;
    if (this.balanceEl) this.balanceEl.textContent = this._fmtMoney(acct.cashBalance);
    if (this.equityEl) this.equityEl.textContent = this._fmtMoney(acct.equity);
    if (this.realizedEl) { this.realizedEl.textContent = this._fmtMoney(acct.realizedPnL); this.realizedEl.className = acct.realizedPnL >= 0 ? 'pnl-pos' : 'pnl-neg'; }
    if (this.unrealizedEl) { this.unrealizedEl.textContent = this._fmtMoney(acct.unrealizedPnL); this.unrealizedEl.className = acct.unrealizedPnL >= 0 ? 'pnl-pos' : 'pnl-neg'; }
    if (this.feesEl) this.feesEl.textContent = this._fmtMoney(acct.totalFees);
    try {
      const stats = this.engine.getPerformanceStats?.() || { totalTrades: trades.length, winRate: 0, profitFactor: 1, netReturn: 0 };
      const winEl = this.statWinEl || document.getElementById('stat-winrate'); const pfEl = this.statPfEl || document.getElementById('stat-pf');
      const trEl = this.statTrEl || document.getElementById('stat-trades'); const retEl = this.statRetEl || document.getElementById('stat-return');
      if (winEl) winEl.textContent = `${stats.winRate.toFixed(1)}%`;
      if (pfEl) pfEl.textContent = Number.isFinite(stats.profitFactor) ? `${stats.profitFactor.toFixed(2)}x` : '—';
      if (trEl) trEl.textContent = String(stats.totalTrades);
      if (retEl) { retEl.textContent = `${stats.netReturn >= 0 ? '+' : ''}${stats.netReturn.toFixed(2)}%`; retEl.className = `stat-val ${stats.netReturn >= 0 ? 'pnl-pos' : 'pnl-neg'}`; }
      const startingBal = Number(acct.startingBalance);
      if (Number.isFinite(startingBal)) document.querySelectorAll('.capital-chip').forEach(chip => chip.classList.toggle('active', Number(chip.getAttribute('data-balance')) === startingBal));
    } catch {}
  }
}
