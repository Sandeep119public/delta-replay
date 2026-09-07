import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { ThemeManager, THEMES, THEME_NAMES } from '../src/ui/ThemeManager.js';
import { ChartManager, CHART_THEMES } from '../src/chart/ChartManager.js';
import { Timeline } from '../src/ui/Timeline.js';
import { paperMarkup } from '../src/ui/paperMarkup.js';

// Paper UI v1: one stylesheet, one theme. Legacy per-theme stylesheets
// (src/themes.css, src/styles.css, src/paper-theme.css, …) were consolidated
// into src/ui/index.css.
const CSS_PATH = 'src/ui/index.css';

function createMockElement(initial = {}) {
  const listeners = {};
  const attrs = {};
  return {
    value: initial.value ?? '',
    textContent: initial.textContent ?? '',
    addEventListener(event, handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    dispatchEvent(event) {
      const handlers = listeners[event.type || event] || [];
      handlers.forEach(h => h(event));
    },
    setAttribute(name, val) { attrs[name] = val; },
    getAttribute(name) { return attrs[name] ?? null; },
    ...initial,
  };
}

describe('ThemeManager & UI Simplification', () => {
  beforeEach(() => {
    global.document = {
      documentElement: createMockElement(),
      body: createMockElement(),
      getElementById: vi.fn(() => null),
    };
  });

  describe('1. ThemeManager Single-Theme Boundary', () => {
    it('exposes only the paper theme', () => {
      expect(THEMES.PAPER).toBe('paper');
      expect(Object.keys(THEMES)).toEqual(['PAPER']);
      expect(THEME_NAMES[THEMES.PAPER]).toBe('Paper');
    });

    it('defaults to the paper theme', () => {
      const manager = new ThemeManager();
      expect(manager.getTheme()).toBe(THEMES.PAPER);
      expect(document.documentElement.getAttribute('data-theme')).toBe('paper');
      expect(document.body.getAttribute('data-theme')).toBe('paper');
    });

    it('pins any requested theme back to paper', () => {
      const manager = new ThemeManager();
      manager.applyTheme('dark');
      expect(manager.getTheme()).toBe('paper');
      manager.applyTheme('midnight');
      expect(manager.getTheme()).toBe('paper');
      expect(document.documentElement.getAttribute('data-theme')).toBe('paper');
    });

    it('notifies onThemeChange with paper', () => {
      const onThemeChange = vi.fn();
      const manager = new ThemeManager({ onThemeChange });
      expect(onThemeChange).toHaveBeenCalledWith('paper');
      manager.applyTheme('light');
      expect(onThemeChange).toHaveBeenLastCalledWith('paper');
    });

    it('destroy clears the change callback', () => {
      const manager = new ThemeManager({ onThemeChange: vi.fn() });
      manager.destroy();
      expect(manager.onThemeChange).toBeNull();
    });
  });

  describe('2. ChartManager Theme Profiles & applyTheme', () => {
    it('defines distinct color palettes for dark, paper, light, and midnight', () => {
      expect(CHART_THEMES.dark).toBeDefined();
      expect(CHART_THEMES.paper).toBeDefined();
      expect(CHART_THEMES.light).toBeDefined();
      expect(CHART_THEMES.midnight).toBeDefined();

      expect(CHART_THEMES.dark.layout.background.color).toBe('#0b0f17');
      expect(CHART_THEMES.paper.layout.background.color).toBe('#fbf8f1');
      expect(CHART_THEMES.light.layout.background.color).toBe('#ffffff');
      expect(CHART_THEMES.midnight.layout.background.color).toBe('#030712');
    });

    it('defines a blue/orange colorblind-safe chart palette', () => {
      expect(CHART_THEMES.colorblind).toBeDefined();
      expect(CHART_THEMES.colorblind.series).toMatchObject({
        upColor: '#60a5fa',
        downColor: '#fb923c',
      });
    });

    it('applyTheme switches to the colorblind chart palette', () => {
      const mockContainer = { clientWidth: 800, clientHeight: 500 };
      const manager = new ChartManager(mockContainer);
      manager.chart = { applyOptions: vi.fn() };
      manager.series = { applyOptions: vi.fn() };
      manager.applyTheme('colorblind');
      expect(manager.series.applyOptions).toHaveBeenCalledWith(expect.objectContaining({
        upColor: '#60a5fa',
        downColor: '#fb923c',
      }));
    });

    it('applyTheme updates chart and series options', () => {
      const mockContainer = { clientWidth: 800, clientHeight: 500 };
      const manager = new ChartManager(mockContainer);

      const mockChart = {
        applyOptions: vi.fn(),
      };
      const mockSeries = {
        applyOptions: vi.fn(),
      };
      manager.chart = mockChart;
      manager.series = mockSeries;

      manager.applyTheme('midnight');
      expect(mockChart.applyOptions).toHaveBeenCalledWith(expect.objectContaining({
        layout: expect.objectContaining({
          background: expect.objectContaining({ color: '#030712' }),
        }),
      }));
      expect(mockSeries.applyOptions).toHaveBeenCalledWith(expect.objectContaining({
        upColor: '#10b981',
        downColor: '#ef4444',
      }));

      manager.applyTheme('light');
      expect(mockChart.applyOptions).toHaveBeenCalledWith(expect.objectContaining({
        layout: expect.objectContaining({
          background: expect.objectContaining({ color: '#ffffff' }),
        }),
      }));
    });
  });

  describe('3. UI Simplification Stylesheet Audit', () => {
    const paperCss = fs.readFileSync(CSS_PATH, 'utf-8');
    const html = fs.readFileSync('index.html', 'utf-8');
    const markup = paperMarkup();

    it('shell mounts a single #app node with one stylesheet and no legacy theme links', () => {
      expect(html).toMatch(/<div id="app"><\/div>/);
      expect(html).toMatch(/href="\/src\/ui\/index\.css"/);
      expect(html).toMatch(/name="viewport"/);
      // Legacy per-theme stylesheets are gone from the shell …
      expect(html).not.toMatch(/themes\.css/);
      expect(html).not.toMatch(/paper-theme\.css/);
      expect(html).not.toMatch(/src\/styles\.css/);
      expect(html).not.toMatch(/ui-polish\.css/);
      // … and permanently removed nodes were not reintroduced into the shell
      expect(html).not.toMatch(/phase-badge/);
      expect(html).not.toMatch(/cache-badge/);
      expect(html).not.toMatch(/id="replay-time"/);
      expect(html).not.toMatch(/id="mode-indicator"/);
      expect(html).not.toMatch(/id="replay-status"/);
      expect(html).not.toMatch(/shortcuts-hint/);
    });

    it('is a single-theme app: paper tokens, no data-theme switching surface', () => {
      expect(paperCss).toMatch(/--paper:/);
      expect(paperCss).toMatch(/--paper-panel:/);
      expect(paperCss).toMatch(/--paper-ink:/);
      expect(paperCss).not.toMatch(/html\[data-theme="/);
      expect(html).not.toMatch(/id="theme-select"/);
      expect(html).not.toMatch(/theme-pills/);
      expect(markup).not.toMatch(/theme-pills/);
    });

    it('keeps a slim mode-banner status bar instead of hiding progress', () => {
      // Banner stays visible as a slim ticker
      expect(paperCss).toMatch(/\.mode-banner\s*\{[\s\S]*?display:\s*flex/);
      // Progress panel is a flex row inside the banner
      expect(paperCss).toMatch(/\.progress-panel\s*\{[\s\S]*?display:\s*flex/);
      // Banner keeps its progress + market-time nodes in the markup
      expect(markup).toMatch(/id="mode-banner"/);
      expect(markup).toMatch(/id="progress-panel"/);
      expect(markup).toMatch(/id="market-time-full"/);
    });

    it('keeps the trading sidebar mounted with compact grids (no whole-card hiding hacks)', () => {
      expect(paperCss).toMatch(/\.trading-section/);
      expect(paperCss).toMatch(/\.pos-compact-grid/);
      expect(paperCss).toMatch(/\.order-secondary-grid/);
      // No aggressive whole-card hide for the position panel
      expect(paperCss).not.toMatch(/\.position-panel\.is-empty\s*\{[^}]*display:\s*none/);
      expect(markup).toMatch(/id="trading-panel"/);
    });

    it('ships the replay DOM from markup modules: header, workspace, timeline, drawer', () => {
      expect(markup).toMatch(/id="symbol-select"/);
      expect(markup).toMatch(/id="timeframe-select"/);
      expect(markup).toMatch(/id="header-start-replay-btn"/);
      expect(markup).toMatch(/id="chart-container"/);
      expect(markup).toMatch(/id="timeline-sparkline"/);
      expect(markup).toMatch(/id="timeline-slider"/);
      expect(markup).toMatch(/id="speed-select"/);
      expect(markup).toMatch(/id="btn-buy"/);
      expect(markup).toMatch(/id="btn-sell"/);
      expect(markup).toMatch(/id="btn-close"/);
      expect(markup).toMatch(/id="btn-trading-drawer"/);
      expect(markup).toMatch(/id="drawer-scrim"/);
      expect(markup).toMatch(/id="error-panel"/);
    });

    it('drawer is a transform-based bottom sheet on small screens, not display:none', () => {
      const mobileBlock = paperCss.match(/@media\s*\(\s*max-width:\s*1024px\s*\)[\s\S]*$/);
      expect(mobileBlock).not.toBeNull();
      expect(mobileBlock[0]).toMatch(/\.trading-section\s*\{[\s\S]*?transform:\s*translateY/);
      expect(paperCss).toMatch(/drawer-open/);
      expect(paperCss).not.toMatch(/\.trading-section\s*\{[^}]*display:\s*none/);
    });

    it('Timeline publishes replay progress to --timeline-progress', () => {
      const sliderEl = createMockElement({ value: '0' });
      sliderEl.min = '0';
      sliderEl.style = { setProperty: vi.fn() };
      const mk = (t) => createMockElement({ textContent: t ?? '' });
      const timeline = new Timeline({
        sliderEl,
        startLabelEl: mk(),
        currentLabelEl: mk(),
        endLabelEl: mk(),
        indexLabelEl: mk(),
        timeLabelEl: mk(),
        startIndexLabelEl: mk(),
      });
      timeline.setTotal(100, Array.from({ length: 100 }, (_, i) => ({ time: i })));
      timeline.setPosition(49);
      const calls = sliderEl.style.setProperty.mock.calls.filter(([k]) => k === '--timeline-progress');
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[calls.length - 1][1]).toMatch(/%/);
    });

    it('ModeBanner throttles screen-reader announcements', async () => {
      const { ModeBanner } = await import('../src/ui/ModeBanner.js');
      const mkEl = (txt = '') => ({ textContent: txt, className: '', classList: { add() {}, remove() {} } });
      const srTicker = mkEl();
      const banner = new ModeBanner({
        modeBanner: { className: '', classList: { add() {}, remove() {} } },
        modeIndicator: null,
        progressPanel: mkEl(),
        progressText: mkEl(),
        progressPct: mkEl(),
        marketTimeEl: mkEl(),
        marketTimeFull: mkEl(),
        srTicker,
        overlay: mkEl(),
        overlayText: mkEl(),
      });
      const candleAt = (i) => ({ time: 1000 + i * 60 });
      banner.update({ total: 100, status: 'paused', loadingState: 'IDLE', pendingStartIndex: 0, currentIndex: 5, candleAt });
      expect(srTicker.textContent).toMatch(/paused/i);
      const first = srTicker.textContent;
      // Same status in the same tick window -> no repeated announcement
      banner.update({ total: 100, status: 'paused', loadingState: 'IDLE', pendingStartIndex: 0, currentIndex: 6, candleAt });
      expect(srTicker.textContent).toBe(first);
      // Status change always announces immediately
      banner.update({ total: 100, status: 'playing', loadingState: 'IDLE', pendingStartIndex: 0, currentIndex: 7, candleAt });
      expect(srTicker.textContent).toMatch(/playing/i);
    });
  });
});
