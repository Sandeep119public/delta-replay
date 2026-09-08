import { assertTradingPresentation } from '../ports/TradingPresentationPort.js';

export class ChartTradingController {
  constructor({
    chartManager,
    trading = null,
    tradingEvents = null,
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
    this.tradingEvents = tradingEvents;
    this.trading = trading ? assertTradingPresentation(trading) : null;
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
    this._subscriptions = [];
    this._unsubscribeChartClick = null;
    this._destroyed = false;
    this._boundOnChartClick = (event) => { void this.handleChartClick(event); };
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

    [events.POSITION_OPENED, events.POSITION_UPDATED, events.POSITION_CLOSED,
      events.ACCOUNT_RESET, events.ORDER_PLACED, events.ORDER_TRIGGERED,
      events.ORDER_CANCELLED, events.ORDER_FILLED, events.TRADE_EXECUTED,
      events.STOP_LOSS_TRIGGERED, events.TAKE_PROFIT_TRIGGERED,
      events.POSITION_LIQUIDATED].forEach((event) => subscribe(event, sync));

    subscribe(events.ORDER_FILLED, (payload) => {
      const order = payload?.order ?? payload;
      if (order?.type && order.type !== 'market') {
        const label = order.type === 'stop_market' ? 'Stop' : 'Limit';
        const price = order.filledPrice != null ? ` @ $${Number(order.filledPrice).toFixed(2)}` : '';
        this.toastView?.show?.(`✓ ${label} ${String(order.side).toUpperCase()} Filled${price}`);
      }
    });
    subscribe(events.STOP_LOSS_TRIGGERED, (payload) => this.toastView?.show?.(`🛑 Stop Loss Triggered${payload?.price != null ? ` @ $${Number(payload.price).toFixed(2)}` : ''}`));
    subscribe(events.TAKE_PROFIT_TRIGGERED, (payload) => this.toastView?.show?.(`🎯 Take Profit Triggered${payload?.price != null ? ` @ $${Number(payload.price).toFixed(2)}` : ''}`));
    subscribe(events.POSITION_LIQUIDATED, (payload) => this.toastView?.show?.(`⚠️ Position Liquidated${payload?.liquidationPrice != null ? ` @ $${Number(payload.liquidationPrice).toFixed(2)}` : ''}`));
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._subscriptions.splice(0).forEach((unsubscribe) => { try { unsubscribe?.(); } catch {} });
    try { this._unsubscribeChartClick?.(); } catch {}
    this._unsubscribeChartClick = null;
  }

  syncChartTradingLines() {
    const snapshot = this.trading?.snapshot() || { positions: [], pendingOrders: [] };
    const position = snapshot.positions[0] || null;
    this.chartManager?.updatePositionLines?.(position);
    this.chartManager?.updateOrderLines?.(snapshot.pendingOrders || []);
    this.floatingPosView?.render?.(position);
  }

  async handleChartClick({ price }) {
    if (this._destroyed || !Number.isFinite(price) || price <= 0) return null;
    const intent = this.actions?.resolveClick?.(price);
    if (!intent) return null;

    if (intent.action === 'SET_TP' || intent.action === 'SET_SL') {
      try {
        const result = await this.actions.execute(intent);
        if (!result?.success) {
          this.actions.reportError?.(result?.message || 'Unable to set risk');
          return result;
        }
        const input = intent.action === 'SET_TP' ? this.tpInput : this.slInput;
        if (input) input.value = Number(intent.price).toFixed(2);
        const label = intent.action === 'SET_TP' ? 'Take Profit' : 'Stop Loss';
        this.toastView?.show?.(`${label} set to $${Number(intent.price).toFixed(2)}`);
      } catch (error) {
        this.actions.reportError?.(error?.message || 'Unable to set risk');
      }
      this.syncChartTradingLines();
      this.tradingPanel?.render?.();
      return intent;
    }

    const type = this.orderFormView?.getOrderType?.() || this.orderTypeSelect?.value || 'MARKET';
    if (type === 'LIMIT') {
      this.orderFormView?.setLimitPrice?.(intent.price);
      this.toastView?.show?.(`Limit Price set to $${Number(intent.price).toFixed(2)}`);
    } else if (type === 'STOP_MARKET') {
      this.orderFormView?.setStopPrice?.(intent.price);
      this.toastView?.show?.(`Stop Price set to $${Number(intent.price).toFixed(2)}`);
    }
    this.syncChartTradingLines();
    this.tradingPanel?.render?.();
    return intent;
  }
}
