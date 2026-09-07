import { describe, it, expect, vi, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PaperTradingEngine } from '../src/trading/PaperTradingEngine.js';
import { createDashboardPresentation } from '../src/app/DashboardPresentationAdapter.js';
import { assertDashboardView } from '../src/ports/DashboardPresentationPort.js';
import { DashboardPage } from '../src/pages/DashboardPage.js';
import { JournalPage } from '../src/pages/JournalPage.js';
import { StrategiesPage } from '../src/pages/StrategiesPage.js';
import { Router } from '../src/router/Router.js';

const execFileAsync = promisify(execFile);

afterEach(() => {
  delete global.document;
});

describe('Pages boundary', () => {
  it('dependency graph keeps pages and chart behind the presentation boundary', async () => {
    const { stdout } = await execFileAsync(process.execPath, ['scripts/check-architecture.mjs']);
    expect(stdout).toContain('Architecture dependency graph: PASS');
  });

  it('dashboard adapter projects the engine into a frozen snapshot', () => {
    const engine = new PaperTradingEngine({ startingBalance: 10000 });
    const view = createDashboardPresentation(engine);
    expect(assertDashboardView(view)).toBe(view);
    const snap = view.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.recentTrades)).toBe(true);
    expect(Object.isFrozen(snap.equityCurve)).toBe(true);
    expect(snap.stats.equity).toBe(10000);
    engine.destroy?.();
  });

  it('DashboardPage renders from the snapshot and rejects engine-shaped objects', () => {
    const dashEl = { innerHTML: '' };
    global.document = { getElementById: (id) => (id === 'page-dashboard' ? dashEl : null) };
    const dashboard = {
      snapshot: () => Object.freeze({
        stats: Object.freeze({
          equity: 12000, netReturn: 5.5, totalTrades: 10,
          winningTrades: 6, losingTrades: 4, winRate: 60, netPnl: 200,
        }),
        recentTrades: Object.freeze([]),
        equityCurve: Object.freeze([10000, 11000, 12000]),
      }),
    };
    const page = new DashboardPage(dashboard);
    page.render();
    expect(dashEl.innerHTML).toContain('12,000.00');
    expect(dashEl.innerHTML).toContain('60.0%');

    expect(() => new DashboardPage({ getStatistics: () => ({}), on: () => {} })).toThrow(TypeError);
    expect(() => new DashboardPage()).toThrow(TypeError);
  });

  it('JournalPage persists through injected storage instead of the engine', () => {
    global.document = { getElementById: () => null };
    let stored = null;
    const storage = { load: () => stored, save: (value) => { stored = value; } };
    const page = new JournalPage({ storage });
    expect(page).not.toHaveProperty('tradingEngine');
    page.entries = [];
    page.saveEntries();
    expect(stored).toBe('[]');
    const reloaded = new JournalPage({ storage });
    expect(reloaded.entries).toEqual([]);
  });

  it('StrategiesPage navigates through the injected callback', () => {
    global.document = { getElementById: () => null };
    const onNavigate = vi.fn();
    const page = new StrategiesPage({ onNavigate });
    page.goTo('replay');
    expect(onNavigate).toHaveBeenCalledWith('replay');
    const defaults = new StrategiesPage({ onNavigate: () => {} });
    expect(defaults.strategies.length).toBeGreaterThan(0);
  });

  it('Router works with injected globals and no real browser', () => {
    const dispatched = [];
    const mkEl = () => ({
      classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: () => false },
      style: {},
      dataset: {},
    });
    const pageEls = new Map();
    const fakeDoc = {
      querySelectorAll: vi.fn(() => []),
      getElementById: (id) => {
        if (!pageEls.has(id)) pageEls.set(id, mkEl());
        return pageEls.get(id);
      },
    };
    const fakeWin = {
      location: { hash: '' },
      addEventListener: vi.fn(),
      dispatchEvent: (event) => { dispatched.push(event); return true; },
    };
    const router = new Router({ win: fakeWin, doc: fakeDoc });
    router.register('dashboard', null);
    router.navigate('dashboard');
    expect(fakeWin.location.hash).toBe('dashboard');
    expect(router.currentPage).toBe('dashboard');
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].type).toBe('pagechange');
    expect(dispatched[0].detail).toEqual({ page: 'dashboard' });
  });
});
