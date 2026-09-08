import { assertTradingPresentation } from '../ports/TradingPresentationPort.js';

export class PositionView {
  constructor({
    trading = null,
    posSymbolEl, posSideEl, posQtyEl, posEntryEl, posCurrentEl, posPnlEl,
    posSlEl = document.getElementById('pos-sl'),
    posTpEl = document.getElementById('pos-tp'),
    closeBtn, setRiskBtn = document.getElementById('btn-set-risk'),
    clearRiskBtn = document.getElementById('btn-clear-risk'),
    slInput = document.getElementById('sl-price'), tpInput = document.getElementById('tp-price'),
    onError = null, onSuccess = null, onRender = null,
  } = {}) {
    this.trading = trading ? assertTradingPresentation(trading) : null;
    Object.assign(this, { posSymbolEl, posSideEl, posQtyEl, posEntryEl, posCurrentEl, posPnlEl,
      posSlEl, posTpEl, closeBtn, setRiskBtn, clearRiskBtn, slInput, tpInput, onError, onSuccess, onRender });
    this.busy = false;
    this._listeners = [];
    this._listen(this.closeBtn, 'click', () => void this.closePosition());
    this._listen(this.setRiskBtn, 'click', () => void this.setRisk());
    this._listen(this.clearRiskBtn, 'click', () => void this.clearRisk());
  }

  _listen(element, type, handler) {
    element?.addEventListener?.(type, handler);
    if (element?.removeEventListener) this._listeners.push([element, type, handler]);
  }

  destroy() { this._listeners.splice(0).forEach(([el, type, handler]) => el.removeEventListener?.(type, handler)); }
  _fmt(v) { const n = Number(v); return Number.isFinite(n) ? `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}` : '—'; }

  async _run(action) {
    if (this.busy) return { success: false, message: 'Trading request already in progress' };
    this.busy = true;
    this.render(this.trading?.snapshot().positions || []);
    try {
      const result = await action();
      if (!result?.success) this.onError?.(result?.message || 'Trading request failed');
      else this.onSuccess?.();
      this.onRender?.();
      return result;
    } catch (error) {
      this.onError?.(error?.message || 'Trading request failed');
      return { success: false, message: error?.message || 'Trading request failed' };
    } finally {
      this.busy = false;
      this.render(this.trading?.snapshot().positions || []);
    }
  }

  closePosition() {
    const position = this.trading?.snapshot().positions?.[0];
    if (!position) { const message = 'No open position to close'; this.onError?.(message); return Promise.resolve({ success: false, message }); }
    return this._run(() => this.trading.actions.flattenPosition(position.symbol));
  }

  setRisk() {
    const position = this.trading?.snapshot().positions?.[0];
    if (!position) { const message = 'No open position for SL/TP'; this.onError?.(message); return Promise.resolve({ success: false, message }); }
    const sl = this.slInput?.value?.trim();
    const tp = this.tpInput?.value?.trim();
    if (!sl && !tp) { const message = 'Enter SL or TP price'; this.onError?.(message); return Promise.resolve({ success: false, message }); }
    const symbol = position.symbol;
    if (sl && tp) return this._run(() => this.trading.actions.updateRisk({ symbol, stopLoss: Number(sl), takeProfit: Number(tp) }));
    if (sl) return this._run(() => this.trading.actions.setStopLoss(symbol, Number(sl)));
    return this._run(() => this.trading.actions.setTakeProfit(symbol, Number(tp)));
  }

  clearRisk() {
    const position = this.trading?.snapshot().positions?.[0];
    if (!position) { const message = 'No open position to clear'; this.onError?.(message); return Promise.resolve({ success: false, message }); }
    if (this.slInput) this.slInput.value = '';
    if (this.tpInput) this.tpInput.value = '';
    return this._run(() => this.trading.actions.clearRisk(position.symbol));
  }

  render(positions = []) {
    const position = positions[0] || null;
    if (!position) {
      [this.posSymbolEl, this.posSideEl, this.posQtyEl, this.posEntryEl, this.posCurrentEl, this.posPnlEl, this.posSlEl, this.posTpEl]
        .forEach((el) => { if (el) el.textContent = '—'; });
      if (this.closeBtn) this.closeBtn.disabled = true;
      if (this.setRiskBtn) this.setRiskBtn.disabled = true;
      if (this.clearRiskBtn) this.clearRiskBtn.disabled = true;
      return;
    }
    if (this.posSymbolEl) this.posSymbolEl.textContent = position.symbol;
    if (this.posSideEl) this.posSideEl.textContent = position.side;
    if (this.posQtyEl) this.posQtyEl.textContent = String(position.quantity);
    if (this.posEntryEl) this.posEntryEl.textContent = this._fmt(position.entryPrice);
    if (this.posCurrentEl) this.posCurrentEl.textContent = this._fmt(position.currentPrice);
    if (this.posPnlEl) {
      this.posPnlEl.textContent = this._fmt(position.unrealizedPnL);
      this.posPnlEl.className = Number(position.unrealizedPnL) >= 0 ? 'pnl-pos' : 'pnl-neg';
    }
    if (this.posSlEl) this.posSlEl.textContent = position.stopLossPrice != null ? this._fmt(position.stopLossPrice) : '—';
    if (this.posTpEl) this.posTpEl.textContent = position.takeProfitPrice != null ? this._fmt(position.takeProfitPrice) : '—';
    if (this.closeBtn) this.closeBtn.disabled = this.busy;
    if (this.setRiskBtn) this.setRiskBtn.disabled = this.busy;
    if (this.clearRiskBtn) this.clearRiskBtn.disabled = this.busy;
  }
}
