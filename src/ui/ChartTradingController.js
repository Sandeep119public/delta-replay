import { TradingIntentResolver } from '../trading/TradingIntentResolver.js';
import { TradingEvents } from '../trading/TradingEvents.js';

/**
 * ChartTradingController coordinates chart-click trading interactions,
 * visual order/position price overlays, and trading toast notifications.
 *
 * Decouples chart trading interaction logic from the main application bootstrap.
 */
export class ChartTradingController {
  constructor({
    chartManager,
    tradingEngine,
    tradingPanel = null,
    floatingPosView = null,
    toastView = null,
    orderFormView = null,
    coordinator = null,
    slInput = null,
    tpInput = null,
    limitPriceInput = null,
    stopPriceInput = null,
    orderTypeSelect = null,
  }) {
    this.chartManager = chartManager;
    this.tradingEngine = tradingEngine;
    this.tradingPanel = tradingPanel;
    this.floatingPosView = floatingPosView;
    this.toastView = toastView;
    this.orderFormView = orderFormView;
    this.coordinator = coordinator;

    this.slInput = slInput;
    this.tpInput = tpInput;
    this.limitPriceInput = limitPriceInput;
    this.stopPriceInput = stopPriceInput;
    this.orderTypeSelect = orderTypeSelect;

    this._boundOnChartClick = (e) => this.handleChartClick(e);
    this._subscriptions = [];
    this._init();
  }

  _init() {
    if (this.chartManager?.onChartClick) {
      const unsubscribe = this.chartManager.onChartClick(this._boundOnChartClick);
      if (typeof unsubscribe === 'function') this._subscriptions.push(unsubscribe);
    }
    this._bindTradingEvents();
    this.syncChartTradingLines();
  }

  _bindTradingEvents() {
    if (!this.tradingEngine?.on) return;

    const sync = () => this.syncChartTradingLines();

    this._subscriptions.push(this.tradingEngine.on(TradingEvents.POSITION_OPENED, sync));
    this._subscriptions.push(this.tradingEngine.on(TradingEvents.POSITION_UPDATED, sync));
    this._subscriptions.push(this.tradingEngine.on(TradingEvents.POSITION_CLOSED, () => {
      this.chartManager?.updatePositionLines?.(null);
      this.floatingPosView?.render?.(null);
      this.syncChartTradingLines();
    }));

    this._subscriptions.push(this.tradingEngine.on(TradingEvents.ACCOUNT_RESET, () => {
      this.chartManager?.clearTradingLines?.();
      this.floatingPosView?.render?.(null);
    }));

    this._subscriptions.push(this.tradingEngine.on(TradingEvents.ORDER_PLACED, sync));
    this._subscriptions.push(this.tradingEngine.on(TradingEvents.ORDER_TRIGGERED, sync));
    this._subscriptions.push(this.tradingEngine.on(TradingEvents.ORDER_CANCELLED, sync));

    this._subscriptions.push(this.tradingEngine.on(TradingEvents.ORDER_FILLED, (payload) => {
      this.syncChartTradingLines();
      const o = payload?.order ?? payload;
      if (o?.type && o.type !== 'MARKET') {
        const typeLabel = o.type === 'STOP_MARKET' ? 'Stop' : 'Limit';
        const priceStr = o.filledPrice != null ? ` @ $${Number(o.filledPrice).toFixed(2)}` : '';
        this.toastView?.show?.(`✓ ${typeLabel} ${o.side} Filled${priceStr}`);
      }
    }));

    this._subscriptions.push(this.tradingEngine.on(TradingEvents.STOP_LOSS_TRIGGERED, (p) => {
      this.syncChartTradingLines();
      const priceStr = p?.price != null ? ` @ $${Number(p.price).toFixed(2)}` : '';
      this.toastView?.show?.(`🛑 Stop Loss Triggered${priceStr}`);
    });

    this._subscriptions.push(this.tradingEngine.on(TradingEvents.TAKE_PROFIT_TRIGGERED, (p) => {
      this.syncChartTradingLines();
      const priceStr = p?.price != null ? ` @ $${Number(p.price).toFixed(2)}` : '';
      this.toastView?.show?.(`🎯 Take Profit Triggered${priceStr}`);
    }));

    this._subscriptions.push(this.tradingEngine.on(TradingEvents.POSITION_LIQUIDATED, (p) => {
      this.syncChartTradingLines();
      const priceStr = p?.liquidationPrice != null ? ` @ $${Number(p.liquidationPrice).toFixed(2)}` : '';
      this.toastView?.show?.(`⚠️ Position Liquidated${priceStr}`);
    });
  }

  syncChartTradingLines() {
    const positions = this.tradingEngine?.getPositions?.() || [];
    const activePos = positions.length > 0 ? positions[0] : null;

    this.chartManager?.updatePositionLines?.(activePos);

    const pendingOrders = this.tradingEngine?.getPendingOrders
      ? this.tradingEngine.getPendingOrders()
      : [];
    this.chartManager?.updateOrderLines?.(pendingOrders);

    this.floatingPosView?.render?.(activePos);
  }

  destroy() {
    for (const unsubscribe of this._subscriptions.splice(0)) {
      try { unsubscribe?.(); } catch (error) { console.warn('[ChartTradingController] unsubscribe failed', error); }
    }
  }

  handleChartClick({ price }) {
    if (!Number.isFinite(price) || price <= 0) return null;

    const positions = this.tradingEngine?.getPositions?.() || [];
    const activePos = positions.length > 0 ? positions[0] : null;
    const intent = TradingIntentResolver.resolveClickIntent(price, activePos);
    if (!intent) return null;

    if (intent.action === 'SET_TP') {
      const res = this.tradingEngine.setTakeProfit(intent.symbol, intent.price);
      if (res.success) {
        if (this.tpInput) this.tpInput.value = intent.price.toFixed(2);
        this.toastView?.show?.(`Take Profit set to $${intent.price.toFixed(2)}`);
      } else {
        this.coordinator?.showTradingError?.(res.message);
      }
    } else if (intent.action === 'SET_SL') {
      const res = this.tradingEngine.setStopLoss(intent.symbol, intent.price);
      if (res.success) {
        if (this.slInput) this.slInput.value = intent.price.toFixed(2);
        this.toastView?.show?.(`Stop Loss set to $${intent.price.toFixed(2)}`);
      } else {
        this.coordinator?.showTradingError?.(res.message);
      }
    } else {
      // PRICE_SELECT (when no active position or setting limit/stop)
      const type = this.orderFormView?.getOrderType
        ? this.orderFormView.getOrderType()
        : (this.orderTypeSelect?.value || 'MARKET');

      if (type === 'LIMIT') {
        if (this.orderFormView?.setLimitPrice) {
          this.orderFormView.setLimitPrice(intent.price);
        } else if (this.limitPriceInput) {
          this.limitPriceInput.value = intent.price.toFixed(2);
        }
        this.toastView?.show?.(`Limit Price set to $${intent.price.toFixed(2)}`);
      } else if (type === 'STOP_MARKET') {
        if (this.orderFormView?.setStopPrice) {
          this.orderFormView.setStopPrice(intent.price);
        } else if (this.stopPriceInput) {
          this.stopPriceInput.value = intent.price.toFixed(2);
        }
        this.toastView?.show?.(`Stop Price set to $${intent.price.toFixed(2)}`);
      }
    }

    this.syncChartTradingLines();
    this.tradingPanel?.render?.();
    return intent;
  }
}
