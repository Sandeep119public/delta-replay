/**
 * PositionView manages the active position card (symbol, side, size,
 * entry/current price, live unrealized PnL), risk stop/take profit inputs,
 * and position close triggers.
 */
export class PositionView {
  constructor({
    engine,
    posSymbolEl,
    posSideEl,
    posQtyEl,
    posEntryEl,
    posCurrentEl,
    posPnlEl,
    posSlEl = typeof document !== 'undefined' ? document.getElementById('pos-sl') : null,
    posTpEl = typeof document !== 'undefined' ? document.getElementById('pos-tp') : null,
    posSideBadge = typeof document !== 'undefined' ? document.getElementById('pos-side-badge') : null,
    positionPanel = typeof document !== 'undefined' && typeof document.querySelector === 'function' ? document.querySelector('.position-panel') : null,
    closeBtn,
    setRiskBtn = typeof document !== 'undefined' ? document.getElementById('btn-set-risk') : null,
    clearRiskBtn = typeof document !== 'undefined' ? document.getElementById('btn-clear-risk') : null,
    slInput = typeof document !== 'undefined' ? document.getElementById('sl-price') : null,
    tpInput = typeof document !== 'undefined' ? document.getElementById('tp-price') : null,
    onError = null,
    onSuccess = null,
    onRender = null,
  } = {}) {
    this.engine = engine;
    this.posSymbolEl = posSymbolEl;
    this.posSideEl = posSideEl;
    this.posQtyEl = posQtyEl;
    this.posEntryEl = posEntryEl;
    this.posCurrentEl = posCurrentEl;
    this.posPnlEl = posPnlEl;
    this.posSlEl = posSlEl;
    this.posTpEl = posTpEl;
    this.posSideBadge = posSideBadge;
    this.positionPanel = positionPanel;
    this.closeBtn = closeBtn;
    this.setRiskBtn = setRiskBtn;
    this.clearRiskBtn = clearRiskBtn;
    this.slInput = slInput;
    this.tpInput = tpInput;
    this.onError = onError;
    this.onSuccess = onSuccess;
    this.onRender = onRender;

    this._bindEvents();
  }

  _bindEvents() {
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.closePosition());
    }
    if (this.setRiskBtn) {
      this.setRiskBtn.addEventListener('click', () => this.setRisk());
    }
    if (this.clearRiskBtn) {
      this.clearRiskBtn.addEventListener('click', () => this.clearRisk());
    }
  }

  _fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    const sign = n >= 0 ? '' : '-';
    return `${sign}$${Math.abs(n).toFixed(2)}`;
  }

  closePosition() {
    const positions = this.engine.getPositions();
    if (!positions.length) {
      this.onError?.('No open position to close');
      return;
    }
    const symbol = positions[0].symbol;
    const res = this.engine.closePosition(symbol);
    if (!res.success) this.onError?.(res.message);
    else this.onSuccess?.();
    this.onRender?.();
    return res;
  }

  setRisk() {
    const positions = this.engine.getPositions();
    if (!positions.length) {
      this.onError?.('No open position for SL/TP');
      return;
    }
    const symbol = positions[0].symbol;
    const slVal = this.slInput?.value?.trim?.();
    const tpVal = this.tpInput?.value?.trim?.();

    let res;
    if (slVal && tpVal) {
      res = this.engine.setRisk({ symbol, stopLoss: parseFloat(slVal), takeProfit: parseFloat(tpVal) });
    } else if (slVal) {
      res = this.engine.setStopLoss(symbol, parseFloat(slVal));
    } else if (tpVal) {
      res = this.engine.setTakeProfit(symbol, parseFloat(tpVal));
    } else {
      this.onError?.('Enter SL or TP price');
      return;
    }

    if (!res.success) this.onError?.(res.message);
    else this.onSuccess?.();
    this.onRender?.();
    return res;
  }

  clearRisk() {
    const positions = this.engine.getPositions();
    if (!positions.length) {
      this.onError?.('No open position to clear');
      return;
    }
    const symbol = positions[0].symbol;
    if (this.slInput) this.slInput.value = '';
    if (this.tpInput) this.tpInput.value = '';
    this.engine.clearStopLoss(symbol);
    this.engine.clearTakeProfit(symbol);
    this.onRender?.();
  }

  render(positions = []) {
    const posSideBadge = this.posSideBadge || document.getElementById('pos-side-badge');
    const positionPanel = this.positionPanel || (typeof document?.querySelector === 'function' ? document.querySelector('.position-panel') : null);

    if (positionPanel) positionPanel.classList.toggle('is-empty', positions.length === 0);

    if (!positions || positions.length === 0) {
      if (this.posSymbolEl) this.posSymbolEl.textContent = '—';
      if (this.posSideEl) this.posSideEl.textContent = '—';
      if (this.posQtyEl) this.posQtyEl.textContent = '—';
      if (this.posEntryEl) this.posEntryEl.textContent = '—';
      if (this.posCurrentEl) this.posCurrentEl.textContent = '—';
      if (this.posPnlEl) {
        this.posPnlEl.textContent = '—';
        this.posPnlEl.className = '';
      }
      if (this.posSlEl) this.posSlEl.textContent = '—';
      if (this.posTpEl) this.posTpEl.textContent = '—';
      if (posSideBadge) {
        posSideBadge.textContent = 'NO POSITION';
        posSideBadge.className = 'pos-badge hidden';
      }
      if (this.closeBtn) this.closeBtn.disabled = true;
      if (this.setRiskBtn) this.setRiskBtn.disabled = true;
      if (this.clearRiskBtn) this.clearRiskBtn.disabled = true;
    } else {
      const p = positions[0];
      if (this.posSymbolEl) this.posSymbolEl.textContent = p.symbol;
      if (this.posSideEl) this.posSideEl.textContent = p.side;
      if (this.posQtyEl) this.posQtyEl.textContent = String(p.quantity);
      if (this.posEntryEl) this.posEntryEl.textContent = this._fmtMoney(p.entryPrice);
      if (this.posCurrentEl) this.posCurrentEl.textContent = this._fmtMoney(p.currentPrice);
      if (this.posPnlEl) {
        this.posPnlEl.textContent = this._fmtMoney(p.unrealizedPnL);
        this.posPnlEl.className = p.unrealizedPnL >= 0 ? 'pnl-pos' : 'pnl-neg';
      }
      if (posSideBadge) {
        posSideBadge.textContent = p.side;
        posSideBadge.className = `pos-badge ${p.side === 'LONG' ? 'pos-long' : 'pos-short'}`;
      }
      if (this.posSlEl) this.posSlEl.textContent = p.stopLossPrice != null ? this._fmtMoney(p.stopLossPrice) : '—';
      if (this.posTpEl) this.posTpEl.textContent = p.takeProfitPrice != null ? this._fmtMoney(p.takeProfitPrice) : '—';
      if (this.closeBtn) this.closeBtn.disabled = false;
      if (this.setRiskBtn) this.setRiskBtn.disabled = false;
      if (this.clearRiskBtn) this.clearRiskBtn.disabled = false;
    }
  }
}
