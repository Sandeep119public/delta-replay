import { ReplayCoordinator } from './ReplayCoordinator.js';
import { ReplayCommandController } from './ReplayCommandController.js';
import { ChartTradingController } from '../ui/ChartTradingController.js';
import { createCoreServices } from './createCoreServices.js';
import { createReplayUI } from './createReplayUI.js';
import { createTerminalViews } from './createTerminalViews.js';
import { bindTimelineInteractions } from './bindTimelineInteractions.js';
import { bindTradingEvents } from './bindTradingEvents.js';
import { bindReplayLifecycle } from './bindReplayLifecycle.js';
import { bindMobileDrawer } from './bindMobileDrawer.js';
import { bindApplicationLifecycle } from './bindApplicationLifecycle.js';

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

function bindDatasetSelectors(ui, coordinator) {
  ui.symbolSelector.onChange((symbol) =>
    coordinator.handleSymbolTimeframeChange('symbol', symbol, ui.el('symbol-select')));
  ui.timeframeSelector.onChange((timeframe) =>
    coordinator.handleSymbolTimeframeChange('timeframe', timeframe, ui.el('timeframe-select')));
}

export function createApplication() {
  const services = createCoreServices();
  const { appState, candleStore, engine, candleCache, dataManager, tradingEngine } = services;
  const coordinatorRef = { current: null };
  const ui = createReplayUI({ engine, candleStore, appState, coordinatorRef });

  const coordinator = new ReplayCoordinator({
    dataManager, candleStore, appState, replayEngine: engine, tradingEngine,
    chartManager: ui.chartManager, chartAdapter: ui.adapter, timeline: ui.timeline,
    controls: ui.controls, errorPanel: ui.errorPanel, modeBanner: ui.modeBanner,
    tradingErrorView: ui.tradingErrorView, dataStatusEl: ui.el('data-status'),
    cacheBadgeEl: ui.el('cache-badge'), startReplayBtn: ui.el('start-replay-btn'),
    headerStartReplayBtn: ui.el('header-start-replay-btn'), loadBtn: ui.el('load-btn'),
    fromDateEl: ui.el('from-date'), fromTimeEl: ui.el('from-time'),
    toDateEl: ui.el('to-date'), toTimeEl: ui.el('to-time'),
  });
  coordinatorRef.current = coordinator;

  registerActionGuard(engine, tradingEngine, coordinator);

  const commandController = new ReplayCommandController({
    engine, appState, candleStore, tradingEngine, coordinator,
    headerBtn: ui.el('header-start-replay-btn'),
    onError: (msg) => coordinator.showTradingError(msg),
  });
  const unbindKeyboardShortcuts = commandController.bindKeyboardShortcuts();

  const form = {
    timeframeSelect: ui.el('timeframe-select'), orderTypeSelect: ui.el('order-type'),
    limitPriceInput: ui.el('limit-price'), stopPriceInput: ui.el('stop-price'),
    slInput: ui.el('sl-price'), tpInput: ui.el('tp-price'),
  };

  const views = createTerminalViews({
    appState, candleStore, engine, tradingEngine, commandController, coordinator,
    timeline: ui.timeline, controls: ui.controls, modeBanner: ui.modeBanner, ...form,
  });

  bindDatasetSelectors(ui, coordinator);
  const timelineBindings = bindTimelineInteractions({ timeline: ui.timeline, controls: ui.controls, appState, engine, candleStore, tradingEngine, commandController, coordinator, modeBanner: ui.modeBanner });
  bindTradingEvents({ tradingEngine, commandController, errorPanel: ui.errorPanel });
  ui.chartManager.onAutoFollowChange((isFollow) => ui.controls.setAutoFollow(isFollow));

  const chartTradingController = new ChartTradingController({
    chartManager: ui.chartManager, tradingEngine, tradingPanel: views.tradingPanel,
    floatingPosView: views.floatingPosView, toastView: views.toastView,
    orderFormView: views.tradingPanel.orderFormView, coordinator, ...form,
  });

  bindReplayLifecycle({ engine, appState, candleStore, timeline: ui.timeline, modeBanner: ui.modeBanner, coordinator, chartManager: ui.chartManager });
  ui.el('load-btn')?.addEventListener('click', () => coordinator.loadAndPrepareReplay({ autoStart: false }));
  bindMobileDrawer();

  const destroy = bindApplicationLifecycle({
    unbindKeyboardShortcuts, coordinator, engine, candleCache,
    resources: [timelineBindings, chartTradingController, ui.adapter, ui.chartManager, views.tradingPanel, views.dateSelector, views.sparkline, views.floatingPosView],
  });

  return {
    start() {
      ui.modeBanner.update({ replayState: engine.getState(), appState, candleStore });
      coordinator.loadAndPrepareReplay({ autoStart: false });
    },
    destroy, services, ui, coordinator,
  };
}
