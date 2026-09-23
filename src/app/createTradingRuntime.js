import { bindTradingEvents } from '../ui/bindTradingEvents.js';
import { bindTradingState } from '../ui/TradingStateBridge.js';
import { createChartTradingActions } from './ChartTradingActions.js';

export function createTradingRuntime({ trading, tradingEvents, actions, ui, views, form, reportTradingError = null }) {
  const tradingBindings = bindTradingEvents({
    tradingEvents,
    actions,
    errorPanel: ui.errorPanel,
  });
  const chartTradingActions = createChartTradingActions({
    trading,
    executeTrade: (intent) => {
      if (intent.action === 'SET_TP') return trading.actions.setTakeProfit(intent.symbol, intent.price);
      if (intent.action === 'SET_SL') return trading.actions.setStopLoss(intent.symbol, intent.price);
      return { success: true };
    },
    reportError: reportTradingError,
  });
  const chartTradingController = ui.createChartTradingController({
    chartManager: ui.chartManager,
    trading,
    tradingEvents,
    tradingPanel: views.tradingPanel,
    floatingPosView: views.floatingPosView,
    toastView: views.toastView,
    orderFormView: views.tradingPanel.orderFormView,
    actions: chartTradingActions,
    ...form,
  });
  const tradingStateBridge = bindTradingState({
    tradingEvents,
    trading,
    onChange: () => chartTradingController.syncChartTradingLines(),
  });

  return { tradingBindings, chartTradingController, tradingStateBridge };
}
