import { TimelineSparkline } from './TimelineSparkline.js';
import { ToastNotificationView } from './ToastNotificationView.js';
import { FloatingPositionView } from './FloatingPositionView.js';
import { TradingPanel } from './TradingPanel.js';

export function createPaperTerminalViews(ctx) {
  const {
    el,
    dataset,
    candles,
    replayPort,
    trading,
    tradingEvents,
    onSeek = null,
    timeframeSelect,
    orderTypeSelect,
    limitPriceInput,
    stopPriceInput,
    slInput,
    tpInput,
    getSymbol = () => 'BTCUSDT',
  } = ctx;

  const sparkline = new TimelineSparkline({
    canvasEl: el('timeline-sparkline'),
    candles,
    replay: replayPort,
    trading,
    tradingEvents,
    onSeek,
  });
  const toastView = new ToastNotificationView();
  const floatingPosView = new FloatingPositionView({ trading, getSymbol });
  const tradingPanel = new TradingPanel({
    trading,
    tradingEvents,
    balanceEl: el('acct-balance'),
    equityEl: el('acct-equity'),
    realizedEl: el('acct-realized'),
    unrealizedEl: el('acct-unrealized'),
    feesEl: el('acct-fees'),
    posSymbolEl: el('pos-symbol'),
    posSideEl: el('pos-side'),
    posQtyEl: el('pos-qty'),
    posEntryEl: el('pos-entry'),
    posCurrentEl: el('pos-current'),
    posPnlEl: el('pos-pnl'),
    qtyInput: el('trade-qty'),
    buyBtn: el('btn-buy'),
    sellBtn: el('btn-sell'),
    closeBtn: el('btn-close'),
    resetBtn: el('btn-reset-acct'),
    tradesListEl: el('trades-list'),
    errorEl: el('trading-error'),
    orderTypeSelect: orderTypeSelect || el('order-type'),
    limitPriceInput: limitPriceInput || el('limit-price'),
    stopPriceInput: stopPriceInput || el('stop-price'),
    limitPriceRow: el('limit-price-row'),
    stopPriceRow: el('stop-price-row'),
    advancedToggle: el('advanced-toggle'),
    pendingListEl: el('pending-orders-list'),
    posSlEl: el('pos-sl'),
    posTpEl: el('pos-tp'),
    slInput: slInput || el('sl-price'),
    tpInput: tpInput || el('tp-price'),
    setRiskBtn: el('btn-set-risk'),
    clearRiskBtn: el('btn-clear-risk'),
    getSymbol,
  });

  return { sparkline, toastView, floatingPosView, tradingPanel };
}
