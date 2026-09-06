import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { ThemeManager, THEMES, THEME_NAMES } from '../src/ui/ThemeManager.js';
import { ChartManager, CHART_THEMES } from '../src/chart/ChartManager.js';
import { Timeline } from '../src/ui/Timeline.js';

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
  let mockStorage;

  beforeEach(() => {
    mockStorage = {};
    global.localStorage = {
      getItem: vi.fn((key) => mockStorage[key] ?? null),
      setItem: vi.fn((key, val) => { mockStorage[key] = String(val); }),
      removeItem: vi.fn((key) => { delete mockStorage[key]; }),
      clear: vi.fn(() => { mockStorage = {}; }),
    };

    global.document = {
      documentElement: createMockElement(),
      body: createMockElement(),
      getElementById: vi.fn(() => null),
    };
  });

  describe('1. ThemeManager Core Functionality', () => {
    it('defaults to dark theme when no saved theme exists', () => {
      const manager = new ThemeManager();
      expect(manager.getTheme()).toBe(THEMES.DARK);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(document.body.getAttribute('data-theme')).toBe('dark');
    });

    it('loads saved theme from localStorage', () => {
      mockStorage['delta_replay_theme'] = THEMES.MIDNIGHT;
      const manager = new ThemeManager();
      expect(manager.getTheme()).toBe(THEMES.MIDNIGHT);
      expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');
    });

    it('applies and persists new theme', () => {
      const manager = new ThemeManager();
      manager.applyTheme(THEMES.PAPER);
      expect(manager.getTheme()).toBe(THEMES.PAPER);
      expect(mockStorage['delta_replay_theme']).toBe('paper');
      expect(document.documentElement.getAttribute('data-theme')).toBe('paper');

      manager.applyTheme(THEMES.LIGHT);
      expect(manager.getTheme()).toBe(THEMES.LIGHT);
      expect(mockStorage['delta_replay_theme']).toBe('light');
    });

    it('notifies onThemeChange callback', () => {
      const onThemeChange = vi.fn();
      const manager = new ThemeManager({ onThemeChange });
      manager.applyTheme(THEMES.MIDNIGHT);
      expect(onThemeChange).toHaveBeenCalledWith('midnight');
    });

    it('synchronizes with select element change event', () => {
      const selectEl = createMockElement({ value: 'dark' });
      const onThemeChange = vi.fn();
      const manager = new ThemeManager({ selectEl, onThemeChange });

      selectEl.value = 'light';
      selectEl.dispatchEvent({ type: 'change' });
      expect(manager.getTheme()).toBe('light');
      expect(onThemeChange).toHaveBeenCalledWith('light');
    });

    it('falls back to default when unknown theme is passed', () => {
      const manager = new ThemeManager({ defaultTheme: 'dark' });
      manager.applyTheme('invalid-theme');
      expect(manager.getTheme()).toBe('dark');
    });

    it('theme pills support arrow-key navigation with roving tabindex', () => {
      const handlers = {};
      const mkPill = (theme) => ({
        dataset: { theme },
        getAttribute: (n) => (n === 'data-theme' ? theme : null),
        setAttribute: vi.fn(),
        classList: { toggle: vi.fn() },
        focus: vi.fn(),
        addEventListener: vi.fn((ev, fn) => { handlers[`${theme}:${ev}`] = fn; }),
      });
      const pills = [mkPill('dark'), mkPill('paper'), mkPill('light')];
      global.document.querySelectorAll = vi.fn(() => pills);
      const selectEl = createMockElement({ value: 'dark' });
      const onThemeChange = vi.fn();
      const manager = new ThemeManager({ selectEl, onThemeChange });
      expect(manager.getTheme()).toBe('dark');
      // Roving tabindex: only the active pill is tabbable
      expect(pills[0].setAttribute).toHaveBeenCalledWith('tabindex', '0');
      expect(pills[1].setAttribute).toHaveBeenCalledWith('tabindex', '-1');
      // ArrowRight moves focus forward and applies the next theme
      handlers['dark:keydown']({ key: 'ArrowRight', preventDefault: vi.fn() });
      expect(pills[1].focus).toHaveBeenCalled();
      expect(manager.getTheme()).toBe('paper');
      expect(onThemeChange).toHaveBeenCalledWith('paper');
    });

    it('injects paper font stylesheet on demand and only once', () => {
      const appended = [];
      const injected = {};
      global.document.querySelector = vi.fn((sel) => injected[sel] || null);
      global.document.createElement = vi.fn(() => ({
        setAttribute: vi.fn(function (n, v) { this[n] = v; }),
      }));
      global.document.head = { appendChild: vi.fn((el) => appended.push(el)) };
      const selectEl = createMockElement({ value: 'dark' });
      const manager = new ThemeManager({ selectEl });
      // Non-paper themes need no extra fonts
      expect(global.document.createElement).not.toHaveBeenCalled();
      manager.applyTheme('paper');
      expect(global.document.createElement).toHaveBeenCalledWith('link');
      expect(appended.length).toBe(1);
      expect(appended[0].href).toMatch(/Cinzel/);
      expect(appended[0].href).toMatch(/Shippori/);
      // Second switch reuses the existing link instead of duplicating it
      injected['link[data-theme-fonts="paper"]'] = appended[0];
      manager.applyTheme('light');
      manager.applyTheme('paper');
      expect(appended.length).toBe(1);
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
        upColor: '#00ff88',
        downColor: '#ff3b69',
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
    const themesCss = fs.readFileSync('src/themes.css', 'utf-8');
    const html = fs.readFileSync('index.html', 'utf-8');

    it('declutters by removing dead DOM nodes instead of CSS hiding hacks', () => {
      // Permanently hidden elements were deleted from index.html …
      expect(html).not.toMatch(/phase-badge/);
      expect(html).not.toMatch(/cache-badge/);
      expect(html).not.toMatch(/id="replay-time"/);
      expect(html).not.toMatch(/id="mode-indicator"/);
      expect(html).not.toMatch(/id="replay-status"/);
      expect(html).not.toMatch(/shortcuts-hint/);
      // … so no `display: none` masking hack for them may remain in themes.css
      // (bounded `[^}]*` keeps each check inside a single rule block)
      expect(themesCss).not.toMatch(/\.phase-badge[^{]*\{[^}]*display:\s*none/);
      expect(themesCss).not.toMatch(/#cache-badge[^{]*\{[^}]*display:\s*none/);
      expect(themesCss).not.toMatch(/\.shortcuts-hint[^{]*\{[^}]*display:\s*none/);
      expect(themesCss).not.toMatch(/\.replay-status[^{]*\{[^}]*display:\s*none/);
      expect(themesCss).not.toMatch(/#mode-banner[^{]*\{[^}]*display:\s*none/);
      expect(themesCss).not.toMatch(/\.position-panel\.is-empty\s*\{[^}]*display:\s*none/);
      expect(themesCss).not.toMatch(/#replay-time[^{]*\{[^}]*display:\s*none/);
    });

    it('keeps a slim mode-banner status bar instead of hiding progress', () => {
      // Banner stays visible as a slim ticker
      expect(themesCss).toMatch(/#mode-banner\s*\{[\s\S]*?display:\s*flex\s*!important/);
      // Progress panel is styled as a mini status bar
      expect(themesCss).toMatch(/\.progress-panel:not\(\.hidden\)\s*\{[\s\S]*?display:\s*flex\s*!important/);
      // Banner keeps its progress + market-time nodes in the DOM
      expect(html).toMatch(/id="mode-banner"/);
      expect(html).toMatch(/id="progress-panel"/);
      expect(html).toMatch(/id="market-time-full"/);
    });

    it('shows a graceful empty position state instead of hiding the card', () => {
      // Card stays mounted; only the metrics grid is hidden and inputs dimmed
      expect(themesCss).toMatch(/\.position-panel\.is-empty\s+\.pos-compact-grid\s*\{[\s\S]*?display:\s*none\s*!important/);
      expect(themesCss).toMatch(/\.position-panel\.is-empty\s+\.risk-inputs-row input\s*\{[\s\S]*?opacity:\s*0\.5/);
      // The old aggressive whole-card hide must be gone
      expect(themesCss).not.toMatch(/\.position-panel\.is-empty\s*\{[\s\S]*?display:\s*none\s*!important/);
    });

    it('ships a streamlined DOM: only 1D/7D/Live presets and 3 capital tiers', () => {
      // Surplus options were deleted from the DOM (no CSS masking needed)
      expect(html).not.toMatch(/data-preset="3d"/);
      expect(html).not.toMatch(/data-preset="30d"/);
      expect(html).toMatch(/data-preset="1d"/);
      expect(html).toMatch(/data-preset="7d"/);
      expect(html).toMatch(/data-preset="now"/);

      expect(html).not.toMatch(/data-qty="0\.05"/);

      expect(html).not.toMatch(/data-balance="1000"/);
      expect(html).not.toMatch(/data-balance="25000"/);
      expect(html).not.toMatch(/data-balance="100000"/);
      expect(html).toMatch(/data-balance="5000"/);
      expect(html).toMatch(/data-balance="10000"/);
      expect(html).toMatch(/data-balance="50000"/);

      // … and no attribute-hiding hacks remain in the theme engine
      expect(themesCss).not.toMatch(/\[data-preset=/);
      expect(themesCss).not.toMatch(/\[data-qty=/);
      expect(themesCss).not.toMatch(/\[data-balance=/);
    });

    it('contains CSS definitions for all four themes', () => {
      expect(themesCss).toMatch(/html\[data-theme="dark"\]/);
      expect(themesCss).toMatch(/html\[data-theme="paper"\]/);
      expect(themesCss).toMatch(/html\[data-theme="light"\]/);
      expect(themesCss).toMatch(/html\[data-theme="midnight"\]/);
    });

    it('index.html contains theme selector and themes.css stylesheet link', () => {
      expect(html).toMatch(/id="theme-select"/);
      expect(html).toMatch(/href="\/src\/themes\.css"/);
      expect(html).toMatch(/value="dark"/);
      expect(html).toMatch(/value="paper"/);
      expect(html).toMatch(/value="light"/);
      expect(html).toMatch(/value="midnight"/);
    });

    it('index.html exposes a segmented theme pill switcher', () => {
      expect(html).toMatch(/class="theme-pills"/);
      expect(html).toMatch(/class="theme-pill/);
      expect(html).toMatch(/data-theme="dark"/);
      expect(html).toMatch(/data-theme="paper"/);
      expect(html).toMatch(/data-theme="light"/);
      expect(html).toMatch(/data-theme="midnight"/);
    });

    it('theme pills use cross-platform SVG icons instead of emoji', () => {
      const pillsBlock = html.match(/class="theme-pills"[\s\S]*?<\/div>/);
      expect(pillsBlock).not.toBeNull();
      expect(pillsBlock[0]).toMatch(/<svg/);
      expect(pillsBlock[0]).not.toMatch(/🌙|📜|☀️|🌌/);
    });

    it('timeline slider has a visual progress fill driven by --timeline-progress', () => {
      const baseCss = fs.readFileSync('src/styles.css', 'utf-8');
      expect(baseCss).toMatch(/--timeline-progress/);
      expect(baseCss).toMatch(/::-webkit-slider-runnable-track/);
      expect(baseCss).toMatch(/::-moz-range-track/);
    });

    it('close button shows high-contrast red outline while a position is open', () => {
      const baseCss = fs.readFileSync('src/styles.css', 'utf-8');
      expect(baseCss).toMatch(/\.btn-close-pos:not\(:disabled\)/);
      expect(themesCss).toMatch(/\.btn-close-pos:not\(:disabled\)/);
    });

    it('empty states stay legible: centered trade hints and position message', () => {
      const baseCss = fs.readFileSync('src/styles.css', 'utf-8');
      expect(baseCss).toMatch(/\.trades-list\s+\.empty-hint\s*\{[\s\S]*?text-align:\s*center/);
      expect(baseCss).toMatch(/\.position-panel\.is-empty::after\s*\{[\s\S]*?content:/);
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

    it('ships audit-driven DOM: sparkline, drawer FAB, sr ticker, advanced toggle', () => {
      expect(html).toMatch(/id="timeline-sparkline"/);
      expect(html).toMatch(/id="btn-trading-drawer"/);
      expect(html).toMatch(/id="sr-ticker"/);
      expect(html).toMatch(/id="btn-advanced-order"/);
      expect(html).toMatch(/value="colorblind"/);
      expect(html).toMatch(/data-theme="colorblind"/);
    });

    it('ships audit-driven CSS: fog, velocity, clamp sidebar, drawer, sr-only', () => {
      const baseCss = fs.readFileSync('src/styles.css', 'utf-8');
      expect(baseCss).toMatch(/\.chart-container::after/);
      expect(baseCss).toMatch(/velocity-boost/);
      expect(baseCss).toMatch(/clamp\(280px, 25vw, 420px\)/);
      expect(baseCss).toMatch(/max-width:\s*1200px/);
      expect(baseCss).toMatch(/\.sr-only/);
      expect(baseCss).toMatch(/\.timeline-sparkline/);
      expect(themesCss).toMatch(/\.fab-trading/);
      expect(themesCss).toMatch(/drawer-open/);
      expect(themesCss).toMatch(/html\[data-theme="colorblind"\]/);
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
      const candleStore = { getCount: () => 100, get: (i) => ({ time: 1000 + i * 60 }) };
      banner.update({ replayState: { status: 'paused', currentIndex: 5 }, appState: { candles: [], pendingStartIndex: 0 }, candleStore });
      expect(srTicker.textContent).toMatch(/paused/i);
      const first = srTicker.textContent;
      // Same status in the same tick window -> no repeated announcement
      banner.update({ replayState: { status: 'paused', currentIndex: 6 }, appState: { candles: [], pendingStartIndex: 0 }, candleStore });
      expect(srTicker.textContent).toBe(first);
      // Status change always announces immediately
      banner.update({ replayState: { status: 'playing', currentIndex: 7 }, appState: { candles: [], pendingStartIndex: 0 }, candleStore });
      expect(srTicker.textContent).toMatch(/playing/i);
    });
  });
});
