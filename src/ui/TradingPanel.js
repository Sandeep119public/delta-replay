import { formatTime } from '../utils/time.js';

export class TradingPanel {
  constructor({
    tradingEngine,
    balanceEl, equityEl, realizedEl, unrealizedEl, feesEl,
    posSymbolEl, posSideEl, posQtyEl, posEntryEl, posCurrentEl, posPnlEl,
    qtyInput, buyBtn, sellBtn, closeBtn, resetBtn,
    tradesListEl, errorEl
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

    this._bindEvents();
    this.render();
  }

  _bindEvents() {
    this.buyBtn.addEventListener('click', () => this._place('BUY'));
    this.sellBtn.addEventListener('click', () => this._place('SELL'));
    this.closeBtn.addEventListener('click', () => this._close());
    this.resetBtn.addEventListener('click', () => {
      this.engine.resetAccount();
    });

    this.engine.on('accountUpdated', () => this.render());
    this.engine.on('positionOpened', () => this.render());
    this.engine.on('positionClosed', () => this.render());
    this.engine.on('positionUpdated', () => this.render());
    this.engine.on('tradeExecuted', () => this.render());
    this.engine.on('accountReset', () => this.render());
    this.engine.on('orderRejected', (err) => this.showError(err.message));
  }

  _getSymbol() {
    // Use engine's last position symbol or appState fallback via document select
    const select = document.getElementById('symbol-select');
    return select ? select.value : 'BTCUSD';
  }

  _place(side) {
    this.clearError();
    const symbol = this._getSymbol();
    const qty = parseFloat(this.qtyInput.value);
    const res = this.engine.placeOrder({ symbol, side, quantity: qty });
    if (!res.success) this.showError(res.message);
    else this.clearError();
    this.render();
  }

  _close() {
    this.clearError();
    const positions = this.engine.getPositions();
    if (!positions.length) {
      this.showError('No open position to close');
      return;
    }
    // close first (single per symbol model, but allow any)
    const symbol = positions[0].symbol;
    const res = this.engine.closePosition(symbol);
    if (!res.success) this.showError(res.message);
    else this.clearError();
    this.render();
  }

  showError(msg) {
    this.errorEl.textContent = msg;
    this.errorEl.classList.remove('hidden');
    setTimeout(() => this.clearError(), 3000);
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

  render() {
    const acct = this.engine.getAccountSnapshot();
    this.balanceEl.textContent = this._fmtMoney(acct.cashBalance);
    this.equityEl.textContent = this._fmtMoney(acct.equity);
    this.realizedEl.textContent = this._fmtMoney(acct.realizedPnL);
    this.unrealizedEl.textContent = this._fmtMoney(acct.unrealizedPnL);
    if (this.feesEl) this.feesEl.textContent = this._fmtMoney(acct.totalFees);
    this.unrealizedEl.className = acct.unrealizedPnL >= 0 ? 'pnl-pos' : 'pnl-neg';
    this.realizedEl.className = acct.realizedPnL >= 0 ? 'pnl-pos' : 'pnl-neg';

    const positions = this.engine.getPositions();
    if (positions.length === 0) {
      this.posSymbolEl.textContent = '—';
      this.posSideEl.textContent = '—';
      this.posQtyEl.textContent = '—';
      this.posEntryEl.textContent = '—';
      this.posCurrentEl.textContent = '—';
      this.posPnlEl.textContent = '—';
      this.posPnlEl.className = '';
      this.closeBtn.disabled = true;
    } else {
      const p = positions[0];
      this.posSymbolEl.textContent = p.symbol;
      this.posSideEl.textContent = p.side;
      this.posQtyEl.textContent = String(p.quantity);
      this.posEntryEl.textContent = this._fmtMoney(p.entryPrice);
      this.posCurrentEl.textContent = this._fmtMoney(p.currentPrice);
      this.posPnlEl.textContent = this._fmtMoney(p.unrealizedPnL);
      this.posPnlEl.className = p.unrealizedPnL >= 0 ? 'pnl-pos' : 'pnl-neg';
      this.closeBtn.disabled = false;
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

    // Disable buy/sell if no market price
    const hasMarket = !!this.engine.getLatestCandle();
    this.buyBtn.disabled = !hasMarket;
    this.sellBtn.disabled = !hasMarket;
  }
}
