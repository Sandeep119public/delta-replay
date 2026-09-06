import { TimelineSparkline } from '../ui/TimelineSparkline.js';
import { ToastNotificationView } from '../ui/ToastNotificationView.js';
import { FloatingPositionView } from '../ui/FloatingPositionView.js';
import { ReplayDateSelector } from '../ui/ReplayDateSelector.js';
import { TradingPanel } from '../ui/TradingPanel.js';

export function createTerminalViews(ctx) {
  const { appState, candleStore, engine, tradingEngine, commandController, coordinator, timeline, controls, modeBanner, timeframeSelect, orderTypeSelect, limitPriceInput, stopPriceInput, slInput, tpInput } = ctx;
  const sparkline = new TimelineSparkline({ canvasEl: document.getElementById('timeline-sparkline'), candleStore, engine, tradingEngine, onSeek: (idx) => commandController.trySeek(idx) });
  const toastView = new ToastNotificationView();
  const floatingPosView = new FloatingPositionView({ tradingEngine });
  const dateSelector = new ReplayDateSelector({ appState, coordinator, candleStore, engine, commandController, timeframeSelect, onJump: (idx) => commandController.trySeek(idx) });
  const tradingPanel = new TradingPanel({ tradingEngine, balanceEl: document.getElementById('acct-balance'), equityEl: document.getElementById('acct-equity'), realizedEl: document.getElementById('acct-realized'), unrealizedEl: document.getElementById('acct-unrealized'), feesEl: document.getElementById('acct-fees'), posSymbolEl: document.getElementById('pos-symbol'), posSideEl: document.getElementById('pos-side'), posQtyEl: document.getElementById('pos-qty'), posEntryEl: document.getElementById('pos-entry'), posCurrentEl: document.getElementById('pos-current'), posPnlEl: document.getElementById('pos-pnl'), qtyInput: document.getElementById('trade-qty'), buyBtn: document.getElementById('btn-buy'), sellBtn: document.getElementById('btn-sell'), closeBtn: document.getElementById('btn-close'), resetBtn: document.getElementById('btn-reset-acct'), tradesListEl: document.getElementById('trades-list'), errorEl: document.getElementById('trading-error'), orderTypeSelect, limitPriceInput, stopPriceInput, pendingListEl: document.getElementById('pending-orders-list'), posSlEl: document.getElementById('pos-sl'), posTpEl: document.getElementById('pos-tp'), slInput, tpInput, setRiskBtn: document.getElementById('btn-set-risk'), clearRiskBtn: document.getElementById('btn-clear-risk') });
  return { sparkline, toastView, floatingPosView, dateSelector, tradingPanel };
}
