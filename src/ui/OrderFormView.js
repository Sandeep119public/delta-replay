import { assertTradingPresentation } from '../ports/TradingPresentationPort.js';

export class OrderFormView {
  constructor({
    trading = null,
    qtyInput,
    buyBtn,
    sellBtn,
    orderTypeSelect = null,
    limitPriceInput = null,
    stopPriceInput = null,
    limitPriceRow = null,
    stopPriceRow = null,
    advancedToggle = null,
    getSymbol = () => document.getElementById('symbol-select')?.value || 'BTCUSDT',
    onError = null,
    onSuccess = null,
    onRender = null,
  } = {}) {
    this.trading = trading ? assertTradingPresentation(trading) : null;
    this.qtyInput = qtyInput;
    this.buyBtn = buyBtn;
    this.sellBtn = sellBtn;
    this.orderTypeSelect = orderTypeSelect || document.getElementById('order-type');
    this.limitPriceInput = limitPriceInput || document.getElementById('limit-price');
    this.stopPriceInput = stopPriceInput || document.getElementById('stop-price');
    this.limitPriceRow = limitPriceRow || document.getElementById('limit-price-row');
    this.stopPriceRow = stopPriceRow || document.getElementById('stop-price-row');
    this.advancedToggle = advancedToggle || document.getElementById('btn-advanced-order');
    this.getSymbol = getSymbol;
    this.onError = onError;
    this.onSuccess = onSuccess;
    this.onRender = onRender;
    this.advanced = false;
    this.busy = false;
    this._listeners = [];

    this._listen(this.buyBtn, 'click', () => void this.placeOrder('BUY'));
    this._listen(this.sellBtn, 'click', () => void this.placeOrder('SELL'));
    this._listen(this.orderTypeSelect, 'change', () => this.updateOrderTypeUI());
    this._listen(this.qtyInput, 'input', () => this.updateNotional());
    this._listen(this.advancedToggle, 'click', () => {
      this.advanced = !this.advanced;
      this.updateAdvancedUI();
      this.updateOrderTypeUI();
    });
    this.updateAdvancedUI();
    this.updateOrderTypeUI();
  }

  _listen(element, type, handler) {
    element?.addEventListener?.(type, handler);
    if (element?.removeEventListener) this._listeners.push([element, type, handler]);
  }

  destroy() {
    this._listeners.splice(0).forEach(([element, type, handler]) => element.removeEventListener?.(type, handler));
  }

  getOrderType() { return this.orderTypeSelect?.value || 'MARKET'; }

  setQuantity(value) {
    if (!this.qtyInput) return;
    this.qtyInput.value = String(value);
    this.updateNotional();
  }

  setLimitPrice(value) {
    if (!this.limitPriceInput) return;
    const number = Number(value);
    this.limitPriceInput.value = Number.isFinite(number) ? number.toFixed(2) : String(value);
  }

  setStopPrice(value) {
    if (!this.stopPriceInput) return;
    const number = Number(value);
    this.stopPriceInput.value = Number.isFinite(number) ? number.toFixed(2) : String(value);
  }

  setAdvanced(enabled) {
    this.advanced = Boolean(enabled);
    this.updateAdvancedUI();
    this.updateOrderTypeUI();
  }

  updateAdvancedUI() {
    if (!this.advancedToggle) return;
    this.advancedToggle.setAttribute('aria-expanded', String(this.advanced));
    this.advancedToggle.classList.toggle('active', this.advanced);
    this.advancedToggle.textContent = this.advanced ? 'Advanced Order ▾' : 'Advanced Order ▸';
  }

  updateOrderTypeUI() {
    const type = this.getOrderType();
    if (this.limitPriceRow) this.limitPriceRow.classList.toggle('hidden', !(type === 'LIMIT' && this.advanced));
    if (this.stopPriceRow) this.stopPriceRow.classList.toggle('hidden', !(type === 'STOP_MARKET' && this.advanced));
    if (this.buyBtn && this.sellBtn) {
      const label = type === 'LIMIT' ? 'LIMIT' : type === 'STOP_MARKET' ? 'STOP' : '';
      this.buyBtn.textContent = label ? `BUY ${label}` : 'BUY';
      this.sellBtn.textContent = label ? `SELL ${label}` : 'SELL';
    }
  }

  _markPrice() { return Number(this.trading?.snapshot().markPrice ?? NaN); }
  _equity() { return Number(this.trading?.snapshot().account?.equity ?? NaN); }

  applyEquityPct(pct) {
    const equity = this._equity();
    const mark = this._markPrice();
    if (!Number.isFinite(pct) || pct <= 0) return;
    if (!Number.isFinite(equity) || !Number.isFinite(mark) || mark <= 0) {
      this.onError?.('Load market data before sizing the order');
      return;
    }
    this.setQuantity(Math.max(0.0001, Math.floor((equity * pct / 100 / mark) * 10000) / 10000));
  }

  updateNotional() {
    const target = document.getElementById('qty-notional');
    if (!target) return;
    const qty = Number(this.qtyInput?.value);
    const mark = this._markPrice();
    const equity = this._equity();
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(mark) || mark <= 0) {
      target.textContent = '';
      return;
    }
    const notional = qty * mark;
    const pct = Number.isFinite(equity) && equity > 0 ? ` · ${(notional / equity * 100).toFixed(1)}% eq` : '';
    target.textContent = `≈ $${notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}${pct}`;
  }

  async placeOrder(side) {
    if (this.busy || !this.trading) return { success: false, message: 'Order request already in progress' };
    const quantity = Number(this.qtyInput?.value);
    const type = this.getOrderType();
    const symbol = this.getSymbol();
    if (!Number.isFinite(quantity) || quantity <= 0) {
      const result = { success: false, message: 'Enter a valid quantity' };
      this.onError?.(result.message);
      return result;
    }

    let action;
    if (type === 'LIMIT') {
      const limitPrice = Number(this.limitPriceInput?.value);
      if (!Number.isFinite(limitPrice) || limitPrice <= 0) { const message = 'Enter a valid limit price'; this.onError?.(message); return { success: false, message }; }
      action = () => this.trading.actions.submitLimitOrder({ symbol, side, quantity, limitPrice });
    } else if (type === 'STOP_MARKET') {
      const stopPrice = Number(this.stopPriceInput?.value);
      if (!Number.isFinite(stopPrice) || stopPrice <= 0) { const message = 'Enter a valid stop price'; this.onError?.(message); return { success: false, message }; }
      action = () => this.trading.actions.submitStopOrder({ symbol, side, quantity, stopPrice });
    } else {
      action = () => this.trading.actions.submitMarketOrder({ symbol, side, quantity });
    }

    this.busy = true;
    this.render();
    try {
      const result = await action();
      if (!result?.success) this.onError?.(result?.message || 'Order rejected');
      else this.onSuccess?.();
      this.onRender?.();
      return result;
    } catch (error) {
      this.onError?.(error?.message || 'Order request failed');
      return { success: false, message: error?.message || 'Order request failed' };
    } finally {
      this.busy = false;
      this.render();
    }
  }

  render() {
    const hasMarket = this.trading?.snapshot().hasMarket === true;
    if (this.buyBtn) this.buyBtn.disabled = this.busy || !hasMarket;
    if (this.sellBtn) this.sellBtn.disabled = this.busy || !hasMarket;
    this.updateNotional();
  }
}
