import { ReplayCoordinator } from './ReplayCoordinator.js';
import { ReplayCommandController } from './ReplayCommandController.js';
import { createCoreServices } from './createCoreServices.js';
import { bindReplayLifecycle } from './bindReplayLifecycle.js';
import { bindApplicationLifecycle } from './bindApplicationLifecycle.js';
import { createPaperUI } from '../ui/PaperUI.js';
import { bindTimelineInteractions } from '../ui/bindTimelineInteractions.js';
import { bindTradingEvents } from '../ui/bindTradingEvents.js';
import { bindMobileDrawer } from '../ui/bindMobileDrawer.js';
import { createApplicationActions } from './ApplicationActions.js';
import { createChartTradingActions } from './ChartTradingActions.js';
import { createTradingUIState } from './TradingUIState.js';
import { bindTradingState } from '../ui/TradingStateBridge.js';

function registerActionGuard(engine, tradingEngine, coordinator) {
  engine.registerActionGuard((action) => {
    if (!tradingEngine.hasOpenPosition()) return { allowed: true };
    const msg = action === 'load'
      ? 'Cannot load new data while a position is open — close position or reset account first.'
      : `Cannot ${action} while a position is open — close position first.`;
    coordinator.showTradingError(msg);
    return { allowed: false, reason: msg };
  });
}

function bindDatasetSelectors(ui, actions) {
  const unbinds = [
    ui.symbolSelector.onChange((symbol) => actions.changeDataset('symbol', symbol, ui.el('symbol-select'))),
    ui.timeframeSelector.onChange((timeframe) => actions.changeDataset('timeframe', timeframe, ui.el('timeframe-select'))),
  ];
  return { destroy() { unbinds.forEach((unbind) => { try { unbind?.(); } catch {} }); } };
}

export function createApplication() {
  const services = createCoreServices();
  const { appState, candleStore, engine, candleCache, dataManager, tradingEngine } = services;
  const coordinatorRef = { current: null };
  const ui = createPaperUI({ engine, candleStore, appState, coordinatorRef });

  const coordinator = new ReplayCoordinator({
    dataManager, candleStore, appState, replayEngine: engine, tradingEngine,
    chartManager: ui.chartManager, chartAdapter: ui.adapter, timeline: ui.timeline,
    controls: ui.controls, errorPanel: ui.errorPanel, modeBanner: ui.modeBanner,
    tradingErrorView: ui.tradingErrorView, ...ui.getCoordinatorPorts(),
  });
  coordinatorRef.current = coordinator;

  const coordinatorPorts = ui.getCoordinatorPorts();
  const commandController = new ReplayCommandController({
    engine, appState, candleStore, tradingEngine, coordinator,
    headerBtn: coordinatorPorts.headerStartReplayBtn,
    onError: (msg) => coordinator.showTradingError(msg),
  });
  const unbindKeyboardShortcuts = commandController.bindKeyboardShortcuts();

  const tradingState = createTradingUIState(tradingEngine);

  const actions = createApplicationActions({ coordinator, commandController, appState, engine, candleStore, modeBanner: ui.modeBanner, timeline: ui.timeline, controls: ui.controls, errorPanel: ui.errorPanel });

  const form = ui.getOrderFormPorts();
  const views = ui.createTerminalViews({ appState, candleStore, engine, tradingEngine, commandController, coordinator, timeline: ui.timeline, controls: ui.controls, modeBanner: ui.modeBanner, ...form });

  const selectorBindings = bindDatasetSelectors(ui, actions);
  const timelineBindings = bindTimelineInteractions({ timeline: ui.timeline, tradingEngine, actions });
  const tradingBindings = bindTradingEvents({ tradingEngine, actions, errorPanel: ui.errorPanel });
  const unbindAutoFollow = ui.chartManager.onAutoFollowChange((isFollow) => ui.controls.setAutoFollow(isFollow));

  const chartTradingActions = createChartTradingActions({ tradingEngine, coordinator });
  const chartTradingController = ui.createChartTradingController({ chartManager: ui.chartManager, tradingState, tradingPanel: views.tradingPanel, floatingPosView: views.floatingPosView, toastView: views.toastView, orderFormView: views.tradingPanel.orderFormView, actions: chartTradingActions, ...form });
  const tradingStateBridge = bindTradingState({ tradingEngine, tradingState, onChange: () => chartTradingController.syncChartTradingLines() });

  const replayLifecycle = bindReplayLifecycle({ engine, appState, candleStore, timeline: ui.timeline, modeBanner: ui.modeBanner, coordinator, chartManager: ui.chartManager });

  const loadBtn = coordinatorPorts.loadBtn;
  const onLoadClick = () => actions.load();
  if (loadBtn) loadBtn.addEventListener('click', onLoadClick);
  const loadBinding = { destroy() { loadBtn?.removeEventListener?.('click', onLoadClick); } };
  const mobileDrawer = bindMobileDrawer();

  const destroy = bindApplicationLifecycle({
    unbindKeyboardShortcuts, coordinator, engine, candleCache,
    resources: [selectorBindings, timelineBindings, tradingBindings, tradingStateBridge, replayLifecycle, commandController, mobileDrawer, loadBinding, ui.symbolSelector, ui.timeframeSelector, ui.timeline, ui.controls, ui.themeManager, ui.errorPanel, chartTradingController, ui.adapter, ui.chartManager, views.tradingPanel, views.dateSelector, views.sparkline, views.floatingPosView, views.toastView],
    extraCleanup: [unbindAutoFollow],
  });

  let started = false;
  let destroyed = false;
  const guardedDestroy = () => {
    if (destroyed) return;
    destroyed = true;
    destroy();
  };
  return {
    start() {
      if (destroyed || started) return;
      started = true;
      ui.modeBanner.update({ replayState: engine.getState(), appState, candleStore });
      Promise.resolve(coordinator.loadAndPrepareReplay({ autoStart: false })).catch((error) => {
        if (!destroyed) coordinator.showTradingError?.(error?.message || 'Failed to load replay');
      });
    },
    destroy: guardedDestroy,
    services, ui, coordinator,
  };
}
