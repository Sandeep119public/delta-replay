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
    this.getSymbol = getSymbol;
    this.onError = onError;
    this.onSuccess = onSuccess;
    this.onRender = onRender;

    this._bindEvents();
    this._bindTabs();
    this.updateOrderTypeUI();
  }

  _updateOrderTypeUI() {
    this.updateOrderTypeUI();
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
      if (type === 'LIMIT') this.limitPriceRow.classList.remove('hidden');
      else this.limitPriceRow.classList.add('hidden');
    }
    if (this.stopPriceRow) {
      if (type === 'STOP_MARKET') this.stopPriceRow.classList.remove('hidden');
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
