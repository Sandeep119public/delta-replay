import { assertTradingPresentation } from '../ports/TradingPresentationPort.js';

export class OrderFormView {
  constructor({ trading = null, qtyInput = null, buyBtn = null, sellBtn = null, orderTypeSelect = null, limitPriceInput = null, stopPriceInput = null, limitPriceRow = null, stopPriceRow = null, advancedToggle = null, getSymbol = () => 'BTCUSDT', onError = null, onSuccess = null, onRender = null } = {}) {
    this.trading = trading ? assertTradingPresentation(trading) : null;
    this.qtyInput = qtyInput; this.buyBtn = buyBtn; this.sellBtn = sellBtn; this.orderTypeSelect = orderTypeSelect;
    this.limitPriceInput = limitPriceInput; this.stopPriceInput = stopPriceInput; this.limitPriceRow = limitPriceRow; this.stopPriceRow = stopPriceRow; this.advancedToggle = advancedToggle;
    this.getSymbol = getSymbol; this.onError = onError; this.onSuccess = onSuccess; this.onRender = onRender; this.busy = false; this.advanced = false; this.listeners = [];
    this.listen(this.buyBtn, 'click', () => void this.placeOrder('BUY')); this.listen(this.sellBtn, 'click', () => void this.placeOrder('SELL'));
    this.listen(this.orderTypeSelect, 'change', () => this.updateOrderTypeUI()); this.listen(this.qtyInput, 'input', () => this.updateNotional());
    this.listen(this.advancedToggle, 'click', () => { this.advanced = !this.advanced; this.updateAdvancedUI(); this.updateOrderTypeUI(); });
    this.updateAdvancedUI(); this.updateOrderTypeUI();
  }
  listen(el, type, handler) { el?.addEventListener?.(type, handler); if (el?.removeEventListener) this.listeners.push([el, type, handler]); }
  destroy() { this.listeners.splice(0).forEach(([el, type, handler]) => el.removeEventListener?.(type, handler)); }
  getOrderType() { return this.orderTypeSelect?.value || 'MARKET'; }
  setQuantity(value) { if (this.qtyInput) { this.qtyInput.value = String(value); this.updateNotional(); } }
  setLimitPrice(value) { if (this.limitPriceInput) this.limitPriceInput.value = Number(value).toFixed(2); }
  setStopPrice(value) { if (this.stopPriceInput) this.stopPriceInput.value = Number(value).toFixed(2); }
  updateAdvancedUI() { this.advancedToggle?.classList?.toggle('active', this.advanced); this.advancedToggle?.setAttribute?.('aria-expanded', String(this.advanced)); }
  updateOrderTypeUI() { const type = this.getOrderType(); this.limitPriceRow?.classList?.toggle('hidden', !(type === 'LIMIT' && this.advanced)); this.stopPriceRow?.classList?.toggle('hidden', !(type === 'STOP_MARKET' && this.advanced)); }
  applyEquityPct(percent) { const snap = this.trading?.snapshot?.() || {}; const equity = Number(snap.account?.equity); const mark = Number(snap.markPrice); if (!Number.isFinite(percent) || percent <= 0 || !Number.isFinite(equity) || !Number.isFinite(mark) || mark <= 0) return; this.setQuantity(Math.floor((equity * percent / 100 / mark) * 10000) / 10000); }
  updateNotional() { const target = globalThis.document?.getElementById?.('qty-notional'); const qty = Number(this.qtyInput?.value); const mark = Number(this.trading?.snapshot?.().markPrice); if (!target || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(mark)) return; target.textContent = `≈ $${(qty * mark).toLocaleString(undefined, { maximumFractionDigits: 0 })}`; }
  async placeOrder(side) {
    if (this.busy || !this.trading) return { success: false, message: 'Order request already in progress' };
    const quantity = Number(this.qtyInput?.value); const type = this.getOrderType(); const symbol = this.getSymbol();
    if (!Number.isFinite(quantity) || quantity <= 0) { const message = 'Enter a valid quantity'; this.onError?.(message); return { success: false, message }; }
    let action;
    if (type === 'LIMIT') { const limitPrice = Number(this.limitPriceInput?.value); if (!Number.isFinite(limitPrice) || limitPrice <= 0) { const message = 'Enter a valid limit price'; this.onError?.(message); return { success: false, message }; } action = () => this.trading.actions.submitLimitOrder({ symbol, side, quantity, limitPrice }); }
    else if (type === 'STOP_MARKET') { const stopPrice = Number(this.stopPriceInput?.value); if (!Number.isFinite(stopPrice) || stopPrice <= 0) { const message = 'Enter a valid stop price'; this.onError?.(message); return { success: false, message }; } action = () => this.trading.actions.submitStopOrder({ symbol, side, quantity, stopPrice }); }
    else action = () => this.trading.actions.submitMarketOrder({ symbol, side, quantity });
    this.busy = true; this.render();
    try { const result = await action(); if (!result?.success) this.onError?.(result?.message || 'Order rejected'); else this.onSuccess?.(result); this.onRender?.(); return result; }
    catch (error) { const message = error?.message || 'Order request failed'; this.onError?.(message); return { success: false, message }; }
    finally { this.busy = false; this.render(); }
  }
  render() { const hasMarket = this.trading?.snapshot?.().hasMarket === true || this.trading?.snapshot?.().markPrice > 0; if (this.buyBtn) this.buyBtn.disabled = this.busy || !hasMarket; if (this.sellBtn) this.sellBtn.disabled = this.busy || !hasMarket; }
}
