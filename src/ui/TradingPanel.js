import { formatTime } from '../utils/time.js';

export class TradingPanel {
  constructor({
    tradingEngine,
    balanceEl, equityEl, realizedEl, unrealizedEl, feesEl,
    posSymbolEl, posSideEl, posQtyEl, posEntryEl, posCurrentEl, posPnlEl,
    qtyInput, buyBtn, sellBtn, closeBtn, resetBtn,
    tradesListEl, errorEl,
    orderTypeSelect, limitPriceInput, stopPriceInput, pendingListEl,
    posSlEl, posTpEl, slInput, tpInput, setRiskBtn, clearRiskBtn
  }) {
    this.engine = tradingEngine;
    this.balanceEl = balanceEl;
    this.equityEl = equityEl;
    this.realizedEl = realizedEl;
    this.unrealizedEl = unrealizedEl;
    this.feesEl = feesEl;
    this.posSymbolEl = posSymbolEl;
    this.posSideEl = posSideEl;
    this.posQtyEl = posQtyEl;
    this.posEntryEl = posEntryEl;
    this.posCurrentEl = posCurrentEl;
    this.posPnlEl = posPnlEl;
    this.qtyInput = qtyInput;
    this.buyBtn = buyBtn;
    this.sellBtn = sellBtn;
    this.closeBtn = closeBtn;
    this.resetBtn = resetBtn;
    this.tradesListEl = tradesListEl;
    this.errorEl = errorEl;
    // order UI - fallback to DOM queries if not provided
    this.orderTypeSelect = orderTypeSelect || document.getElementById('order-type');
    this.limitPriceInput = limitPriceInput || document.getElementById('limit-price');
    this.stopPriceInput = stopPriceInput || document.getElementById('stop-price');
    this.limitPriceRow = document.getElementById('limit-price-row');
    this.stopPriceRow = document.getElementById('stop-price-row');
    this.pendingListEl = pendingListEl || document.getElementById('pending-orders-list');
    this.posSlEl = posSlEl || document.getElementById('pos-sl');
    this.posTpEl = posTpEl || document.getElementById('pos-tp');
    this.slInput = slInput || document.getElementById('sl-price');
    this.tpInput = tpInput || document.getElementById('tp-price');
    this.setRiskBtn = setRiskBtn || document.getElementById('btn-set-risk');
    this.clearRiskBtn = clearRiskBtn || document.getElementById('btn-clear-risk');

    this._bindEvents();
    this._bindTabs();
    this._bindSidebarTabs();
    this._bindAccountControls();
    this._updateOrderTypeUI();
    this.render();
  }

  _bindSidebarTabs() {
    try {
      const tabBtns = document.querySelectorAll('.panel-tab-btn');
      tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          tabBtns.forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
          });
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
          const targetTab = btn.getAttribute('data-tab');
          document.querySelectorAll('.tab-panel').forEach(panel => {
            if (panel.id === `tab-view-${targetTab}`) panel.classList.add('active');
            else panel.classList.remove('active');
          });
        });
      });
    } catch {}
  }

  _bindAccountControls() {
    try {
      // Capital preset chips
      const chips = document.querySelectorAll('.capital-chip');
      chips.forEach(chip => {
        chip.addEventListener('click', () => {
          const balance = Number(chip.getAttribute('data-balance'));
          if (this.engine.hasOpenPosition && this.engine.hasOpenPosition()) {
            this.showError('Close position before changing starting balance');
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
          this.render();
        });
      });

      // Custom capital input
      const customInput = document.getElementById('custom-capital-input');
      const setCapitalBtn = document.getElementById('btn-set-capital');
      if (setCapitalBtn && customInput) {
        setCapitalBtn.addEventListener('click', () => {
          const val = parseFloat(customInput.value);
          if (!Number.isFinite(val) || val <= 0) {
            this.showError('Enter a valid capital amount (> 0)');
            return;
          }
          if (this.engine.hasOpenPosition && this.engine.hasOpenPosition()) {
            this.showError('Close position before changing starting balance');
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
          this.render();
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
            this._updateOrderTypeUI();
          }
        });
      });
    } catch {}
  }

  _bindEvents() {
    this.buyBtn.addEventListener('click', () => this._place('BUY'));
    this.sellBtn.addEventListener('click', () => this._place('SELL'));
    this.closeBtn.addEventListener('click', () => this._close());
    this.resetBtn.addEventListener('click', () => {
      this.engine.resetAccount();
    });
    if (this.orderTypeSelect) {
      this.orderTypeSelect.addEventListener('change', () => this._updateOrderTypeUI());
    }
    if (this.setRiskBtn) {
      this.setRiskBtn.addEventListener('click', () => this._setRisk());
    }
    if (this.clearRiskBtn) {
      this.clearRiskBtn.addEventListener('click', () => this._clearRisk());
    }

    this.engine.on('accountUpdated', () => this.render());
    this.engine.on('positionOpened', () => this.render());
    this.engine.on('positionClosed', () => this.render());
    this.engine.on('positionUpdated', () => this.render());
    this.engine.on('tradeExecuted', () => this.render());
    this.engine.on('accountReset', () => this.render());
    this.engine.on('orderPlaced', () => this.render());
    this.engine.on('orderTriggered', () => this.render());
    this.engine.on('orderFilled', () => this.render());
    this.engine.on('orderCancelled', () => this.render());
    this.engine.on('stopLossTriggered', () => this.render());
    this.engine.on('takeProfitTriggered', () => this.render());
    this.engine.on('orderRejected', (err) => this.showError(err.message || err.reason || 'Order rejected'));
  }

  _getSymbol() {
    const select = document.getElementById('symbol-select');
    return select ? select.value : 'BTCUSDT';
  }

  _getOrderType() {
    if (this.orderTypeSelect) return this.orderTypeSelect.value;
    return 'MARKET';
  }

  _updateOrderTypeUI() {
    const type = this._getOrderType();
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
    // Update button labels
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

  _place(side) {
    this.clearError();
    const symbol = this._getSymbol();
    const qty = parseFloat(this.qtyInput.value);
    const orderType = this._getOrderType();
    let res;
    if (orderType === 'LIMIT') {
      const lp = parseFloat(this.limitPriceInput.value);
      res = this.engine.placeLimitOrder({ symbol, side, quantity: qty, limitPrice: lp });
    } else if (orderType === 'STOP_MARKET') {
      const sp = parseFloat(this.stopPriceInput.value);
      res = this.engine.placeStopOrder({ symbol, side, quantity: qty, stopPrice: sp });
    } else {
      res = this.engine.placeOrder({ symbol, side, quantity: qty });
    }
    if (!res.success) this.showError(res.message);
    else this.clearError();
    this.render();
  }

  _setRisk() {
    this.clearError();
    const positions = this.engine.getPositions();
    if (!positions.length) {
      this.showError('No open position for SL/TP');
      return;
    }
    const symbol = positions[0].symbol;
    const slVal = this.slInput.value.trim();
    const tpVal = this.tpInput.value.trim();
    let res;
    if (slVal && tpVal) {
      res = this.engine.setRisk({ symbol, stopLoss: parseFloat(slVal), takeProfit: parseFloat(tpVal) });
    } else if (slVal) {
      res = this.engine.setStopLoss(symbol, parseFloat(slVal));
    } else if (tpVal) {
      res = this.engine.setTakeProfit(symbol, parseFloat(tpVal));
    } else {
      this.showError('Enter SL or TP price');
      return;
    }
    if (!res.success) this.showError(res.message);
    else this.clearError();
    this.render();
  }

  _clearRisk() {
    this.clearError();
    const positions = this.engine.getPositions();
    if (!positions.length) {
      this.showError('No open position to clear');
      return;
    }
    const symbol = positions[0].symbol;
    if (this.slInput) this.slInput.value = '';
    if (this.tpInput) this.tpInput.value = '';
    // clear both if set
    this.engine.clearStopLoss(symbol);
    this.engine.clearTakeProfit(symbol);
    this.render();
  }

  _close() {
    this.clearError();
    const positions = this.engine.getPositions();
    if (!positions.length) {
      this.showError('No open position to close');
      return;
    }
    const symbol = positions[0].symbol;
    const res = this.engine.closePosition(symbol);
    if (!res.success) this.showError(res.message);
    else this.clearError();
    this.render();
  }

  _cancelOrder(orderId) {
    this.clearError();
    const res = this.engine.cancelOrder(orderId);
    if (!res.success) this.showError(res.message);
    this.render();
  }

  showError(msg) {
    this.errorEl.textContent = msg;
    this.errorEl.classList.remove('hidden');
    setTimeout(() => this.clearError(), 3500);
  }

  clearError() {
    this.errorEl.textContent = '';
    this.errorEl.classList.add('hidden');
  }

  _fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    const sign = n >= 0 ? '' : '-';
    return `${sign}$${Math.abs(n).toFixed(2)}`;
  }

  _fmtTime(ts) {
    if (!ts) return '—';
    try { return formatTime(ts); } catch { return String(ts); }
  }

  _renderPending() {
    if (!this.pendingListEl) return;
    const pending = this.engine.getPendingOrders ? this.engine.getPendingOrders() : [];
    const allOrders = this.engine.getOrders ? this.engine.getOrders() : [];
    // Show pending prominently, plus recently filled/cancelled/rejected for visibility
    if (allOrders.length === 0) {
      this.pendingListEl.innerHTML = '<span class="empty-hint">No pending orders</span>';
      return;
    }
    // Split pending vs history
    const pendings = pending;
    const nonPending = allOrders.filter(o => o.status !== 'PENDING').slice().reverse().slice(0, 5);
    let html = '';
    if (pendings.length === 0) {
      html += '<div class="empty-hint">No pending orders</div>';
    } else {
      html += pendings.map(o => {
        const statusCls = o.status === 'PENDING' ? 'pnl-pos' : o.status === 'FILLED' ? 'pnl-pos' : 'pnl-neg';
        const price = o.type === 'STOP_MARKET' ? o.stopPrice : o.limitPrice;
        const typeLabel = o.type === 'STOP_MARKET' ? 'STOP' : (o.type || 'LIMIT');
        return `<div class="trade-row" style="border-left:3px solid ${o.side==='BUY' ? '#22c55e' : '#ef4444'}; padding-left:6px;">
          <span><b>${o.id}</b> ${typeLabel} ${o.side} ${o.quantity} @ ${price != null ? Number(price).toFixed(2) : '—'} <span class="${statusCls}">[${o.status}]</span><br/><small>${this._fmtTime(o.createdReplayTime)}</small></span>
          <span><button class="btn btn-secondary" data-cancel-id="${o.id}" style="padding:2px 6px; min-height:24px; font-size:10px;">Cancel</button></span>
        </div>`;
      }).join('');
    }
    if (nonPending.length > 0) {
      html += '<div style="margin-top:6px; font-size:10px; color:var(--text-muted); border-top:1px solid var(--border); padding-top:4px;">Recent</div>';
      html += nonPending.map(o => {
        let color = '#8a93a6';
        if (o.status === 'FILLED') color = '#22c55e';
        else if (o.status === 'CANCELLED') color = '#eab308';
        else if (o.status === 'REJECTED') color = '#ef4444';
        const price = o.stopPrice ?? o.limitPrice;
        const typeLabel = o.type === 'STOP_MARKET' ? 'STOP ' : (o.type === 'LIMIT' ? 'LIMIT ' : '');
        return `<div class="trade-row" style="opacity:0.85;">
          <span><b>${o.id}</b> ${typeLabel}${o.side} ${o.quantity} @ ${price != null ? Number(price).toFixed(2) : '—'} <span style="color:${color}">[${o.status}]</span></span>
          <span style="font-size:10px;">${o.filledPrice != null ? '@'+Number(o.filledPrice).toFixed(2) : ''} ${o.rejectionReason || o.cancelReason || ''}</span>
        </div>`;
      }).join('');
    }
    this.pendingListEl.innerHTML = html;
    // Bind cancel buttons
    this.pendingListEl.querySelectorAll('[data-cancel-id]').forEach(btn => {
      btn.addEventListener('click', () => this._cancelOrder(btn.getAttribute('data-cancel-id')));
    });
  }

  render() {
    const acct = this.engine.getAccountSnapshot();
    this.balanceEl.textContent = this._fmtMoney(acct.cashBalance);
    this.equityEl.textContent = this._fmtMoney(acct.equity);
    this.realizedEl.textContent = this._fmtMoney(acct.realizedPnL);
    this.unrealizedEl.textContent = this._fmtMoney(acct.unrealizedPnL);
    if (this.feesEl) this.feesEl.textContent = this._fmtMoney(acct.totalFees);
    this.unrealizedEl.className = acct.unrealizedPnL >= 0 ? 'pnl-pos' : 'pnl-neg';
    this.realizedEl.className = acct.realizedPnL >= 0 ? 'pnl-pos' : 'pnl-neg';

    const posSideBadge = document.getElementById('pos-side-badge');
    const positionPanel = document.querySelector('.position-panel');
    const positions = this.engine.getPositions();
    if (positionPanel) positionPanel.classList.toggle('is-empty', positions.length === 0);
    if (positions.length === 0) {
      this.posSymbolEl.textContent = '—';
      this.posSideEl.textContent = '—';
      this.posQtyEl.textContent = '—';
      this.posEntryEl.textContent = '—';
      this.posCurrentEl.textContent = '—';
      this.posPnlEl.textContent = '—';
      this.posPnlEl.className = '';
      if (this.posSlEl) this.posSlEl.textContent = '—';
      if (this.posTpEl) this.posTpEl.textContent = '—';
      if (posSideBadge) { posSideBadge.textContent = 'NO POSITION'; posSideBadge.className = 'pos-badge hidden'; }
      this.closeBtn.disabled = true;
      if (this.setRiskBtn) this.setRiskBtn.disabled = true;
      if (this.clearRiskBtn) this.clearRiskBtn.disabled = true;
    } else {
      const p = positions[0];
      this.posSymbolEl.textContent = p.symbol;
      this.posSideEl.textContent = p.side;
      this.posQtyEl.textContent = String(p.quantity);
      this.posEntryEl.textContent = this._fmtMoney(p.entryPrice);
      this.posCurrentEl.textContent = this._fmtMoney(p.currentPrice);
      this.posPnlEl.textContent = this._fmtMoney(p.unrealizedPnL);
      this.posPnlEl.className = p.unrealizedPnL >= 0 ? 'pnl-pos' : 'pnl-neg';
      if (posSideBadge) {
        posSideBadge.textContent = p.side;
        posSideBadge.className = `pos-badge ${p.side === 'LONG' ? 'pos-long' : 'pos-short'}`;
      }
      if (this.posSlEl) this.posSlEl.textContent = p.stopLossPrice != null ? this._fmtMoney(p.stopLossPrice) : '—';
      if (this.posTpEl) this.posTpEl.textContent = p.takeProfitPrice != null ? this._fmtMoney(p.takeProfitPrice) : '—';
      this.closeBtn.disabled = false;
      if (this.setRiskBtn) this.setRiskBtn.disabled = false;
      if (this.clearRiskBtn) this.clearRiskBtn.disabled = false;
    }

    // Trades list with gross/fees/net
    const trades = this.engine.getTrades();
    if (trades.length === 0) {
      this.tradesListEl.innerHTML = '<span class="empty-hint">No trades yet</span>';
    } else {
      this.tradesListEl.innerHTML = trades.slice().reverse().map(t => {
        const cls = (t.netPnL ?? t.realizedPnL) >= 0 ? 'pnl-pos' : 'pnl-neg';
        const gross = t.grossPnL ?? t.realizedPnL;
        const fee = t.totalFee ?? ((t.entryFee ?? 0) + (t.exitFee ?? 0));
        const net = t.netPnL ?? t.realizedPnL;
        return `<div class="trade-row"><span>${t.symbol} ${t.side} ${t.quantity} @ ${t.entryPrice.toFixed(2)}→${t.exitPrice.toFixed(2)}</span><span>${this._fmtMoney(gross)} / <span class="pnl-neg">${this._fmtMoney(fee)}</span> / <span class="${cls}">${this._fmtMoney(net)}</span></span></div>`;
      }).join('');
    }

    this._renderPending();

    // Render Performance Metrics
    try {
      const stats = typeof this.engine.getPerformanceStats === 'function'
        ? this.engine.getPerformanceStats()
        : { totalTrades: trades.length, winRate: 0, profitFactor: 1, netReturn: 0 };
      const winEl = document.getElementById('stat-winrate');
      const pfEl = document.getElementById('stat-pf');
      const trEl = document.getElementById('stat-trades');
      const retEl = document.getElementById('stat-return');
      if (winEl) winEl.textContent = `${stats.winRate.toFixed(1)}%`;
      if (pfEl) pfEl.textContent = Number.isFinite(stats.profitFactor) ? `${stats.profitFactor.toFixed(2)}x` : '—';
      if (trEl) trEl.textContent = String(stats.totalTrades);
      if (retEl) {
        retEl.textContent = `${stats.netReturn >= 0 ? '+' : ''}${stats.netReturn.toFixed(2)}%`;
        retEl.className = `stat-val ${stats.netReturn >= 0 ? 'pnl-pos' : 'pnl-neg'}`;
      }

      // Update Activity Badge
      const pendingCount = (this.engine.getPendingOrders ? this.engine.getPendingOrders().length : 0);
      const activityBadge = document.getElementById('activity-badge');
      if (activityBadge) {
        const totalActivity = pendingCount + trades.length;
        activityBadge.textContent = String(totalActivity);
        activityBadge.classList.toggle('has-pending', pendingCount > 0);
      }

      // Sync active capital chip
      const startingBal = this.engine.account.startingBalance;
      document.querySelectorAll('.capital-chip').forEach(chip => {
        if (Number(chip.getAttribute('data-balance')) === startingBal) chip.classList.add('active');
        else chip.classList.remove('active');
      });
    } catch {}

    // Disable buy/sell if no market price
    const hasMarket = !!this.engine.getLatestCandle();
    this.buyBtn.disabled = !hasMarket;
    this.sellBtn.disabled = !hasMarket;
  }
}
