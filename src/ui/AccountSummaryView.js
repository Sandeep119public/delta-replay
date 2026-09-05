/**
 * AccountSummaryView manages the account metrics header (balance, equity,
 * realized/unrealized PnL, fees), capital preset chips, custom capital inputs,
 * fee tier selection, and performance statistics.
 */
export class AccountSummaryView {
  constructor({
    engine,
    balanceEl,
    equityEl,
    realizedEl,
    unrealizedEl,
    feesEl,
    resetBtn,
    statWinEl = typeof document !== 'undefined' ? document.getElementById('stat-winrate') : null,
    statPfEl = typeof document !== 'undefined' ? document.getElementById('stat-pf') : null,
    statTrEl = typeof document !== 'undefined' ? document.getElementById('stat-trades') : null,
    statRetEl = typeof document !== 'undefined' ? document.getElementById('stat-return') : null,
    onError = null,
    onRender = null,
  } = {}) {
    this.engine = engine;
    this.balanceEl = balanceEl;
    this.equityEl = equityEl;
    this.realizedEl = realizedEl;
    this.unrealizedEl = unrealizedEl;
    this.feesEl = feesEl;
    this.resetBtn = resetBtn;
    this.statWinEl = statWinEl;
    this.statPfEl = statPfEl;
    this.statTrEl = statTrEl;
    this.statRetEl = statRetEl;
    this.onError = onError;
    this.onRender = onRender;

    this._bindControls();
  }

  _bindControls() {
    if (this.resetBtn) {
      this.resetBtn.addEventListener('click', () => {
        this.engine.resetAccount();
      });
    }

    try {
      // Capital preset chips
      const chips = document.querySelectorAll('.capital-chip');
      chips.forEach(chip => {
        chip.addEventListener('click', () => {
          const balance = Number(chip.getAttribute('data-balance'));
          if (this.engine.hasOpenPosition && this.engine.hasOpenPosition()) {
            this.onError?.('Close position before changing starting balance');
            return;
          }
          if (typeof this.engine.setStartingBalance === 'function') {
            this.engine.setStartingBalance(balance);
          } else {
            this.engine.account.startingBalance = balance;
            this.engine.resetAccount();
          }
          chips.forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          this.onRender?.();
        });
      });

      // Custom capital input
      const customInput = document.getElementById('custom-capital-input');
      const setCapitalBtn = document.getElementById('btn-set-capital');
      if (setCapitalBtn && customInput) {
        setCapitalBtn.addEventListener('click', () => {
          const val = parseFloat(customInput.value);
          if (!Number.isFinite(val) || val <= 0) {
            this.onError?.('Enter a valid capital amount (> 0)');
            return;
          }
          if (this.engine.hasOpenPosition && this.engine.hasOpenPosition()) {
            this.onError?.('Close position before changing starting balance');
            return;
          }
          if (typeof this.engine.setStartingBalance === 'function') {
            this.engine.setStartingBalance(val);
          } else {
            this.engine.account.startingBalance = val;
            this.engine.resetAccount();
          }
          chips.forEach(c => c.classList.remove('active'));
          customInput.value = '';
          this.onRender?.();
        });
      }

      // Fee tier selector
      const feeSelect = document.getElementById('fee-tier-select');
      if (feeSelect) {
        feeSelect.addEventListener('change', () => {
          const rate = parseFloat(feeSelect.value);
          if (typeof this.engine.setFeeRate === 'function') {
            this.engine.setFeeRate(rate);
          } else {
            this.engine.feeRate = rate;
          }
        });
      }
    } catch {}
  }

  _fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    const sign = n >= 0 ? '' : '-';
    return `${sign}$${Math.abs(n).toFixed(2)}`;
  }

  render(acct, trades = []) {
    if (!acct) return;

    if (this.balanceEl) this.balanceEl.textContent = this._fmtMoney(acct.cashBalance);
    if (this.equityEl) this.equityEl.textContent = this._fmtMoney(acct.equity);
    if (this.realizedEl) {
      this.realizedEl.textContent = this._fmtMoney(acct.realizedPnL);
      this.realizedEl.className = acct.realizedPnL >= 0 ? 'pnl-pos' : 'pnl-neg';
    }
    if (this.unrealizedEl) {
      this.unrealizedEl.textContent = this._fmtMoney(acct.unrealizedPnL);
      this.unrealizedEl.className = acct.unrealizedPnL >= 0 ? 'pnl-pos' : 'pnl-neg';
    }
    if (this.feesEl) {
      this.feesEl.textContent = this._fmtMoney(acct.totalFees);
    }

    // Render Performance Metrics
    try {
      const stats = typeof this.engine.getPerformanceStats === 'function'
        ? this.engine.getPerformanceStats()
        : { totalTrades: trades.length, winRate: 0, profitFactor: 1, netReturn: 0 };

      const winEl = this.statWinEl || document.getElementById('stat-winrate');
      const pfEl = this.statPfEl || document.getElementById('stat-pf');
      const trEl = this.statTrEl || document.getElementById('stat-trades');
      const retEl = this.statRetEl || document.getElementById('stat-return');

      if (winEl) winEl.textContent = `${stats.winRate.toFixed(1)}%`;
      if (pfEl) pfEl.textContent = Number.isFinite(stats.profitFactor) ? `${stats.profitFactor.toFixed(2)}x` : '—';
      if (trEl) trEl.textContent = String(stats.totalTrades);
      if (retEl) {
        retEl.textContent = `${stats.netReturn >= 0 ? '+' : ''}${stats.netReturn.toFixed(2)}%`;
        retEl.className = `stat-val ${stats.netReturn >= 0 ? 'pnl-pos' : 'pnl-neg'}`;
      }

      // Sync active capital chip
      const startingBal = this.engine.account.startingBalance;
      document.querySelectorAll('.capital-chip').forEach(chip => {
        if (Number(chip.getAttribute('data-balance')) === startingBal) chip.classList.add('active');
        else chip.classList.remove('active');
      });
    } catch {}
  }
}
