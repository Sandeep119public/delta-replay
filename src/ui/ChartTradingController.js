import { TradingIntentResolver } from '../trading/TradingIntentResolver.js';
import { TradingEvents } from '../trading/TradingEvents.js';

/**
 * ChartTradingController coordinates chart-click trading interactions,
 * visual order/position price overlays, and trading toast notifications.
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
    this._boundOnChartClick = (event) => this.handleChartClick(event);
    this._subscriptions = [];
    this._init();
  }

  _init() {
    if (this.chartManager?.onChartClick) this.chartManager.onChartClick(this._boundOnChartClick);
    this._bindTradingEvents();
    this.syncChartTradingLines();
  }

  _bindTradingEvents() {
    if (!this.tradingEngine?.on) return;
    const sync = () => this.syncChartTradingLines();

    const subscribe = (event, handler) => {
      const unsubscribe = this.tradingEngine.on(event, handler);
      if (typeof unsubscribe === 'function') this._subscriptions.push(unsubscribe);
    };

    subscribe(TradingEvents.POSITION_OPENED, sync);
    subscribe(TradingEvents.POSITION_UPDATED, sync);
    subscribe(TradingEvents.POSITION_CLOSED, () => {
      this.chartManager?.updatePositionLines?.(null);
      this.floatingPosView?.render?.(null);
      this.syncChartTradingLines();
    });
    subscribe(TradingEvents.ACCOUNT_RESET, () => {
      this.chartManager?.clearTradingLines?.();
      this.floatingPosView?.render?.(null);
    });
    subscribe(TradingEvents.ORDER_PLACED, sync);
    subscribe(TradingEvents.ORDER_TRIGGERED, sync);
    subscribe(TradingEvents.ORDER_CANCELLED, sync);
    subscribe(TradingEvents.ORDER_FILLED, (payload) => {
      this.syncChartTradingLines();
      const order = payload?.order ?? payload;
      if (order?.type && order.type !== 'MARKET') {
        const typeLabel = order.type === 'STOP_MARKET' ? 'Stop' : 'Limit';
        const priceStr = order.filledPrice != null ? ` @ $${Number(order.filledPrice).toFixed(2)}` : '';
        this.toastView?.show?.(`✓ ${typeLabel} ${order.side} Filled${priceStr}`);
      }
    });
    subscribe(TradingEvents.STOP_LOSS_TRIGGERED, (payload) => {
      this.syncChartTradingLines();
      const priceStr = payload?.price != null ? ` @ $${Number(payload.price).toFixed(2)}` : '';
      this.toastView?.show?.(`🛑 Stop Loss Triggered${priceStr}`);
    });
    subscribe(TradingEvents.TAKE_PROFIT_TRIGGERED, (payload) => {
      this.syncChartTradingLines();
      const priceStr = payload?.price != null ? ` @ $${Number(payload.price).toFixed(2)}` : '';
      this.toastView?.show?.(`🎯 Take Profit Triggered${priceStr}`);
    });
    subscribe(TradingEvents.POSITION_LIQUIDATED, (payload) => {
      this.syncChartTradingLines();
      const priceStr = payload?.liquidationPrice != null ? ` @ $${Number(payload.liquidationPrice).toFixed(2)}` : '';
      this.toastView?.show?.(`⚠️ Position Liquidated${priceStr}`);
    });
  }

  destroy() {
    this._subscriptions.forEach((unsubscribe) => {
      try { unsubscribe?.(); } catch (error) { console.warn('[ChartTrading] unsubscribe failed', error); }
    });
    this._subscriptions = [];
    if (Array.isArray(this.chartManager?._onChartClickCallbacks)) {
      this.chartManager._onChartClickCallbacks = this.chartManager._onChartClickCallbacks.filter((cb) => cb !== this._boundOnChartClick);
    }
  }

  syncChartTradingLines() {
    const positions = this.tradingEngine?.getPositions?.() || [];
    const activePos = positions.length > 0 ? positions[0] : null;
    this.chartManager?.updatePositionLines?.(activePos);
    const pendingOrders = this.tradingEngine?.getPendingOrders ? this.tradingEngine.getPendingOrders() : [];
    this.chartManager?.updateOrderLines?.(pendingOrders);
    this.floatingPosView?.render?.(activePos);
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
      } else this.coordinator?.showTradingError?.(res.message);
    } else if (intent.action === 'SET_SL') {
      const res = this.tradingEngine.setStopLoss(intent.symbol, intent.price);
      if (res.success) {
        if (this.slInput) this.slInput.value = intent.price.toFixed(2);
        this.toastView?.show?.(`Stop Loss set to $${intent.price.toFixed(2)}`);
      } else this.coordinator?.showTradingError?.(res.message);
    } else {
      const type = this.orderFormView?.getOrderType ? this.orderFormView.getOrderType() : (this.orderTypeSelect?.value || 'MARKET');
      if (type === 'LIMIT') {
        if (this.orderFormView?.setLimitPrice) this.orderFormView.setLimitPrice(intent.price);
        else if (this.limitPriceInput) this.limitPriceInput.value = intent.price.toFixed(2);
        this.toastView?.show?.(`Limit Price set to $${intent.price.toFixed(2)}`);
      } else if (type === 'STOP_MARKET') {
        if (this.orderFormView?.setStopPrice) this.orderFormView.setStopPrice(intent.price);
        else if (this.stopPriceInput) this.stopPriceInput.value = intent.price.toFixed(2);
        this.toastView?.show?.(`Stop Price set to $${intent.price.toFixed(2)}`);
      }
    }

    this.syncChartTradingLines();
    this.tradingPanel?.render?.();
    return intent;
  }
}
