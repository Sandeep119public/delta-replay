import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TradingIntentResolver } from '../src/trading/TradingIntentResolver.js';
import { ChartTradingOverlay } from '../src/chart/ChartTradingOverlay.js';
import { PaperTradingEngine } from '../src/trading/PaperTradingEngine.js';
import { TradingEvents } from '../src/trading/TradingEvents.js';
import { ReplayCommandController } from '../src/app/ReplayCommandController.js';
import { ToastNotificationView } from '../src/ui/ToastNotificationView.js';
import { FloatingPositionView } from '../src/ui/FloatingPositionView.js';
import { ReplayDateSelector } from '../src/ui/ReplayDateSelector.js';
import { AppState } from '../src/state/AppState.js';
import { Order, ORDER_STATUSES } from '../src/trading/Order.js';
import { FundingManager } from '../src/trading/FundingManager.js';

function createMockElement(initial = {}) {
  const classes = new Set(initial.classes || []); const listeners = {};
  return {
    textContent: initial.textContent ?? '', innerHTML: initial.innerHTML ?? '', value: initial.value ?? '', className: initial.className ?? '',
    dataset: { ...(initial.dataset || {}) }, disabled: initial.disabled ?? false,
    classList: { add(cls){ classes.add(cls); }, remove(cls){ classes.delete(cls); }, toggle(cls, force){ if (force === undefined) { if (classes.has(cls)) classes.delete(cls); else classes.add(cls); } else if (force) classes.add(cls); else classes.delete(cls); }, contains(cls){ return classes.has(cls); } },
    addEventListener(event, handler){ if (!listeners[event]) listeners[event] = []; listeners[event].push(handler); },
    removeEventListener(event, handler){ if (listeners[event]) listeners[event] = listeners[event].filter(h => h !== handler); },
    dispatchEvent(event){ (listeners[event.type || event] || []).forEach(h => h(event)); },
    click(){ (listeners.click || []).forEach(h => h({ type: 'click' })); },
    ...initial,
  };
}
