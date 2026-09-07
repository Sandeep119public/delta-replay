import { normalizeTradingSource } from './presentationCompat.js';

/**
 * OrderFormView manages order entry inputs (order types, quantities,
 * limit and stop trigger prices) and dispatching buy/sell order submissions.
 *
 * Trading capabilities arrive as the narrow presentation contract
 * ({ snapshot, actions }); the deprecated `engine` alias is normalized
 * through presentationCompat and must not be used by new callers.
 */
export class OrderFormView {
  constructor({
    trading,
    engine = null,
    qtyInput,
    buyBtn,
    sellBtn,
    orderTypeSelect = typeof document !== 'undefined' ? document.getElementById('order-type') : null,
    limitPriceInput = typeof document !== 'undefined' ? document.getElementById('limit-price') : null,
    stopPriceInput = typeof document !== 'undefined' ? document.getElementById('stop-price') : null,
    limitPriceRow = typeof document !== 'undefined' ? document.getElementById('limit-price-row') : null,
    stopPriceRow = typeof document !== 'undefined' ? document.getElementById('stop-price-row') : null,
    advancedToggle = typeof document !== 'undefined' ? document.getElementById('btn-advanced-order') : null,
    getSymbol = () => (typeof document !== 'undefined' ? document.getElementById('symbol-select')?.value : null) || 'BTCUSDT',
    onError = null,
    onSuccess = null,
    onRender = null,
  } = {}) {
    const tradingSource = trading ?? engine;
    this.trading = tradingSource ? normalizeTradingSource(tradingSource) : null;
    this.qtyInput = qtyInput;
    this.buyBtn = buyBtn;
    this.sellBtn = sellBtn;
    this.orderTypeSelect = orderTypeSelect;
    this.limitPriceInput = limitPriceInput;
    this.stopPriceInput = stopPriceInput;
    this.limitPriceRow = limitPriceRow;
    this.stopPriceRow = stopPriceRow;
    this.advancedToggle = advancedToggle;
    // Progressive disclosure: advanced price rows stay hidden until requested.
    this.advanced = false;
    this.getSymbol = getSymbol;
    this.onError = onError;
    this.onSuccess = onSuccess;
    this.onRender = onRender;

    this._listeners = [];
    this._listen = (el, type, handler) => { el?.addEventListener?.(type, handler); if (el?.removeEventListener) this._listeners.push([el, type, handler]); };
    this._bindEvents();
    this._bindTabs();
    this._bindPresets();
    this._bindAdvanced();
    this.updateAdvancedUI();
    this.updateOrderTypeUI();
  }

  _bindAdvanced() {
    if (this.advancedToggle && typeof this.advancedToggle.addEventListener === 'function') {
      this._listen(this.advancedToggle, 'click', () => this.setAdvanced(!this.advanced));
    }
  }

  setAdvanced(on) {
    this.advanced = !!on;
    this.updateAdvancedUI();
    this.updateOrderTypeUI();
  }

  updateAdvancedUI() {
    if (!this.advancedToggle) return;
    try {
      this.advancedToggle.setAttribute('aria-expanded', this.advanced ? 'true' : 'false');
      this.advancedToggle.classList.toggle('active', this.advanced);
      this.advancedToggle.textContent = this.advanced ? 'Advanced Order ▾' : 'Advanced Order ▸';
    } catch {}
  }

  _updateOrderTypeUI() {
    this.updateOrderTypeUI();
  }

  _bindPresets() {
    try {
      // Legacy fixed-qty chips (kept for compat) + % of equity chips.
      const chips = document.querySelectorAll('.qty-chip');
      chips.forEach(chip => {
        this._listen(chip, 'click', () => {
          if (chip.dataset?.sizePct) {
            this.applyEquityPct(Number(chip.dataset.sizePct));
          } else if (chip.dataset?.qty) {
            this.setQuantity(chip.dataset.qty);
          }
        });
      });
      this._listen(this.qtyInput, 'input', () => this.updateNotional());
    } catch {}
  }

  /** Current mark price for sizing math (latest candle close). */
  _markPrice() {
    try {
      return this.trading?.snapshot().markPrice ?? null;
    } catch { return null; }
  }

  _equity() {
    try {
      const snap = this.trading?.snapshot().account;
      const eq = Number(snap?.equity);
      return Number.isFinite(eq) && eq > 0 ? eq : null;
    } catch { return null; }
  }

  /** Size an order as % of equity at the current mark price. */
  applyEquityPct(pct) {
    const equity = this._equity();
    const mark = this._markPrice();
    if (!Number.isFinite(pct) || pct <= 0) return;
    if (equity == null || mark == null) {
      this.onError?.('Load data first — no mark price for sizing');
      return;
    }
    const notional = equity * (pct / 100);
    const qty = notional / mark;
    // Round down to 4dp so MAX never exceeds equity on quantized venues.
    const rounded = Math.max(0.0001, Math.floor(qty * 10000) / 10000);
    this.setQuantity(String(rounded));
    this.updateNotional();
  }

  updateNotional() {
    try {
      const el = typeof document !== 'undefined' ? document.getElementById('qty-notional') : null;
      if (!el) return;
      const qty = Number(this.qtyInput?.value);
      const mark = this._markPrice();
      if (!Number.isFinite(qty) || qty <= 0 || mark == null) { el.textContent = ''; return; }
      const notional = qty * mark;
      const equity = this._equity();
      const pct = equity ? ` · ${((notional / equity) * 100).toFixed(1)}% eq` : '';
      el.textContent = `≈ $${notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}${pct}`;
    } catch {}
  }

  setQuantity(qty) {
    if (this.qtyInput) {
      this.qtyInput.value = String(qty);
      try {
        this.qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
      } catch {}
    }
  }

  setLimitPrice(price) {
    if (this.limitPriceInput) {
      const num = Number(price);
      this.limitPriceInput.value = Number.isFinite(num) ? num.toFixed(2) : String(price);
      try {
        this.limitPriceInput.dispatchEvent(new Event('input', { bubbles: true }));
      } catch {}
    }
  }

  setStopPrice(price) {
    if (this.stopPriceInput) {
      const num = Number(price);
      this.stopPriceInput.value = Number.isFinite(num) ? num.toFixed(2) : String(price);
      try {
        this.stopPriceInput.dispatchEvent(new Event('input', { bubbles: true }));
      } catch {}
    }
  }

  setOrderType(type) {
    if (this.orderTypeSelect) {
      this.orderTypeSelect.value = type;
      try {
        this.orderTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      } catch {}
    } else {
      this.updateOrderTypeUI();
    }
  }

  _bindTabs() {
    try {
      const tabs = document.querySelectorAll('.order-tab');
      tabs.forEach(tab => {
        this._listen(tab, 'click', () => {
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const type = tab.getAttribute('data-type');
          if (this.orderTypeSelect) {
            this.orderTypeSelect.value = type;
            this.orderTypeSelect.dispatchEvent(new Event('change'));
          } else {
            this.updateOrderTypeUI();
          }
        });
      });
    } catch {}
  }

  _bindEvents() {
    if (this.buyBtn) {
      this._listen(this.buyBtn, 'click', () => this.placeOrder('BUY'));
    }
    if (this.sellBtn) {
      this._listen(this.sellBtn, 'click', () => this.placeOrder('SELL'));
    }
    if (this.orderTypeSelect) {
      this._listen(this.orderTypeSelect, 'change', () => this.updateOrderTypeUI());
    }
  }

  destroy() {
    this._listeners.forEach(([el, type, handler]) => el.removeEventListener?.(type, handler));
    this._listeners = [];
    this._listen = null;
  }

  getOrderType() {
    if (this.orderTypeSelect) return this.orderTypeSelect.value;
    return 'MARKET';
  }

  updateOrderTypeUI() {
    const type = this.getOrderType();
    try {
      document.querySelectorAll('.order-tab').forEach(t => {
        if (t.getAttribute('data-type') === type) t.classList.add('active');
        else t.classList.remove('active');
      });
    } catch {}

    if (this.limitPriceRow) {
      if (type === 'LIMIT' && this.advanced) this.limitPriceRow.classList.remove('hidden');
      else this.limitPriceRow.classList.add('hidden');
    }
    if (this.stopPriceRow) {
      if (type === 'STOP_MARKET' && this.advanced) this.stopPriceRow.classList.remove('hidden');
      else this.stopPriceRow.classList.add('hidden');
    }

    if (this.buyBtn && this.sellBtn) {
      if (type === 'LIMIT') {
        this.buyBtn.textContent = 'BUY LIMIT';
        this.sellBtn.textContent = 'SELL LIMIT';
      } else if (type === 'STOP_MARKET') {
        this.buyBtn.textContent = 'BUY STOP';
        this.sellBtn.textContent = 'SELL STOP';
      } else {
        this.buyBtn.textContent = 'BUY';
        this.sellBtn.textContent = 'SELL';
      }
    }
  }

  placeOrder(side) {
    const symbol = this.getSymbol();
    const qty = parseFloat(this.qtyInput?.value || '0');
    const orderType = this.getOrderType();

    if (!this.trading) throw new Error('OrderFormView requires a trading presentation to place orders');
    const { actions } = this.trading;
    let res;
    if (orderType === 'LIMIT') {
      const lp = parseFloat(this.limitPriceInput?.value || '0');
      res = actions.submitLimitOrder({ symbol, side, quantity: qty, limitPrice: lp });
    } else if (orderType === 'STOP_MARKET') {
      const sp = parseFloat(this.stopPriceInput?.value || '0');
      res = actions.submitStopOrder({ symbol, side, quantity: qty, stopPrice: sp });
    } else {
      res = actions.submitMarketOrder({ symbol, side, quantity: qty });
    }

    if (!res.success) {
      this.onError?.(res.message);
    } else {
      this.onSuccess?.();
    }
    this.onRender?.();
    return res;
  }

  render() {
    let hasMarket = false;
    try {
      hasMarket = this.trading?.snapshot().hasMarket === true;
    } catch { hasMarket = false; }
    if (this.buyBtn) this.buyBtn.disabled = !hasMarket;
    if (this.sellBtn) this.sellBtn.disabled = !hasMarket;
    this.updateNotional();
  }
}
