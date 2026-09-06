/**
 * OrderFormView manages order entry inputs (order types, quantities,
 * limit and stop trigger prices) and dispatching buy/sell order submissions.
 */
export class OrderFormView {
  constructor({
    engine,
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
    this.engine = engine;
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

    this._bindEvents();
    this._bindTabs();
    this._bindPresets();
    this._bindAdvanced();
    this.updateAdvancedUI();
    this.updateOrderTypeUI();
  }

  _bindAdvanced() {
    if (this.advancedToggle && typeof this.advancedToggle.addEventListener === 'function') {
      this.advancedToggle.addEventListener('click', () => this.setAdvanced(!this.advanced));
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
      const chips = document.querySelectorAll('.qty-chip');
      chips.forEach(chip => {
        chip.addEventListener('click', () => {
          if (chip.dataset?.qty) {
            this.setQuantity(chip.dataset.qty);
          }
        });
      });
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
        tab.addEventListener('click', () => {
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
      this.buyBtn.addEventListener('click', () => this.placeOrder('BUY'));
    }
    if (this.sellBtn) {
      this.sellBtn.addEventListener('click', () => this.placeOrder('SELL'));
    }
    if (this.orderTypeSelect) {
      this.orderTypeSelect.addEventListener('change', () => this.updateOrderTypeUI());
    }
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

    let res;
    if (orderType === 'LIMIT') {
      const lp = parseFloat(this.limitPriceInput?.value || '0');
      res = this.engine.placeLimitOrder({ symbol, side, quantity: qty, limitPrice: lp });
    } else if (orderType === 'STOP_MARKET') {
      const sp = parseFloat(this.stopPriceInput?.value || '0');
      res = this.engine.placeStopOrder({ symbol, side, quantity: qty, stopPrice: sp });
    } else {
      res = this.engine.placeOrder({ symbol, side, quantity: qty });
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
    const hasMarket = !!this.engine.getLatestCandle?.();
    if (this.buyBtn) this.buyBtn.disabled = !hasMarket;
    if (this.sellBtn) this.sellBtn.disabled = !hasMarket;
  }
}
