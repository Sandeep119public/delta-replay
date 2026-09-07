import { TRADING_PRESENTATION_EVENTS } from '../ports/TradingPresentationPort.js';

function createLegacyTradingEventPort(tradingEngine) {
  if (!tradingEngine?.on) return null;
  return Object.freeze({
    events: TRADING_PRESENTATION_EVENTS,
    on: (event, handler) => tradingEngine.on(event, handler),
    onAll(handler) {
      const unsubs = Object.values(TRADING_PRESENTATION_EVENTS)
        .map((event) => tradingEngine.on(event, handler))
        .filter((unsubscribe) => typeof unsubscribe === 'function');
      return () => unsubs.forEach((unsubscribe) => { try { unsubscribe(); } catch {} });
    },
  });
}

/**
 * Presentation controller for chart-click trading interactions and visual state.
 * Trading domain events arrive through an application-provided presentation port.
 */
export class ChartTradingController {
  constructor({
    chartManager,
    tradingEvents = null,
    tradingEngine = null,
    tradingState = null,
    actions = null,
    tradingPanel = null,
    floatingPosView = null,
    toastView = null,
    orderFormView = null,
    slInput = null,
    tpInput = null,
    limitPriceInput = null,
    stopPriceInput = null,
    orderTypeSelect = null,
  }) {
    this.chartManager = chartManager;
    this.tradingEvents = tradingEvents || createLegacyTradingEventPort(tradingEngine);
    this.tradingState = tradingState;
    this.actions = actions;
    this.tradingPanel = tradingPanel;
    this.floatingPosView = floatingPosView;
    this.toastView = toastView;
    this.orderFormView = orderFormView;
    this.slInput = slInput;
    this.tpInput = tpInput;
    this.limitPriceInput = limitPriceInput;
    this.stopPriceInput = stopPriceInput;
    this.orderTypeSelect = orderTypeSelect;
    this._boundOnChartClick = (event) => this.handleChartClick(event);
    this._subscriptions = [];
    this._unsubscribeChartClick = null;
    this._destroyed = false;
    this._init();
  }

  _init() {
    if (this.chartManager?.onChartClick) this._unsubscribeChartClick = this.chartManager.onChartClick(this._boundOnChartClick);
    this._bindTradingEvents();
    this.syncChartTradingLines();
  }

  _bindTradingEvents() {
    if (!this.tradingEvents?.on || !this.tradingEvents?.events) return;
    const { events } = this.tradingEvents;
    const sync = () => this.syncChartTradingLines();

    const subscribe = (event, handler) => {
      const unsubscribe = this.tradingEvents.on(event, handler);
      if (typeof unsubscribe === 'function') this._subscriptions.push(unsubscribe);
    };

    subscribe(events.POSITION_OPENED, sync);
    subscribe(events.POSITION_UPDATED, sync);
    subscribe(events.POSITION_CLOSED, () => {
      this.chartManager?.updatePositionLines?.(null);
      this.floatingPosView?.render?.(null);
      this.syncChartTradingLines();
    });
    subscribe(events.ACCOUNT_RESET, () => {
      this.chartManager?.clearTradingLines?.();
      this.floatingPosView?.render?.(null);
    });
    subscribe(events.ORDER_PLACED, sync);
    subscribe(events.ORDER_TRIGGERED, sync);
    subscribe(events.ORDER_CANCELLED, sync);
    subscribe(events.ORDER_FILLED, (payload) => {
      this.syncChartTradingLines();
      const order = payload?.order ?? payload;
      if (order?.type && order.type !== 'MARKET') {
        const typeLabel = order.type === 'STOP_MARKET' ? 'Stop' : 'Limit';
        const priceStr = order.filledPrice != null ? ` @ $${Number(order.filledPrice).toFixed(2)}` : '';
        this.toastView?.show?.(`✓ ${typeLabel} ${order.side} Filled${priceStr}`);
      }
    });
    subscribe(events.STOP_LOSS_TRIGGERED, (payload) => {
      this.syncChartTradingLines();
      const priceStr = payload?.price != null ? ` @ $${Number(payload.price).toFixed(2)}` : '';
      this.toastView?.show?.(`🛑 Stop Loss Triggered${priceStr}`);
    });
    subscribe(events.TAKE_PROFIT_TRIGGERED, (payload) => {
      this.syncChartTradingLines();
      const priceStr = payload?.price != null ? ` @ $${Number(payload.price).toFixed(2)}` : '';
      this.toastView?.show?.(`🎯 Take Profit Triggered${priceStr}`);
    });
    subscribe(events.POSITION_LIQUIDATED, (payload) => {
      this.syncChartTradingLines();
      const priceStr = payload?.liquidationPrice != null ? ` @ $${Number(payload.liquidationPrice).toFixed(2)}` : '';
      this.toastView?.show?.(`⚠️ Position Liquidated${priceStr}`);
    });
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._subscriptions.forEach((unsubscribe) => {
      try { unsubscribe?.(); } catch (error) { console.warn('[ChartTrading] unsubscribe failed', error); }
    });
    this._subscriptions = [];
    try { this._unsubscribeChartClick?.(); } catch (error) { console.warn('[ChartTrading] chart unsubscribe failed', error); }
    this._unsubscribeChartClick = null;
  }

  syncChartTradingLines() {
    const activePos = this.tradingState?.activePosition?.() || null;
    this.chartManager?.updatePositionLines?.(activePos);
    const pendingOrders = this.tradingState?.snapshot?.().pendingOrders || [];
    this.chartManager?.updateOrderLines?.(pendingOrders);
    this.floatingPosView?.render?.(activePos);
  }

  handleChartClick({ price }) {
    if (!Number.isFinite(price) || price <= 0) return null;
    const intent = this.actions?.resolveClick?.(price);
    if (!intent) return null;

    if (intent.action === 'SET_TP') {
      const res = this.actions?.execute?.(intent) || { success: false };
      if (res.success) {
        if (this.tpInput) this.tpInput.value = intent.price.toFixed(2);
        this.toastView?.show?.(`Take Profit set to $${intent.price.toFixed(2)}`);
      } else this.actions?.reportError?.(res.message);
    } else if (intent.action === 'SET_SL') {
      const res = this.actions?.execute?.(intent) || { success: false };
      if (res.success) {
        if (this.slInput) this.slInput.value = intent.price.toFixed(2);
        this.toastView?.show?.(`Stop Loss set to $${intent.price.toFixed(2)}`);
      } else this.actions?.reportError?.(res.message);
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
