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

    it('hides phase-badge, shortcuts-hint, and replay-status to declutter interface', () => {
      expect(themesCss).toMatch(/\.phase-badge\s*\{[\s\S]*?display:\s*none\s*!important/);
      expect(themesCss).toMatch(/\.shortcuts-hint[\s\S]*?display:\s*none\s*!important/);
      expect(themesCss).toMatch(/\.replay-status[\s\S]*?display:\s*none\s*!important/);
    });

    it('keeps a slim mode-banner status bar instead of hiding progress', () => {
      // Banner stays visible as a slim bar; only the bulky indicator text is hidden
      expect(themesCss).toMatch(/#mode-banner\s*\{[\s\S]*?display:\s*flex\s*!important/);
      expect(themesCss).toMatch(/#mode-banner\s+#mode-indicator\s*\{[\s\S]*?display:\s*none\s*!important/);
      // Progress panel is styled as a mini status bar
      expect(themesCss).toMatch(/\.progress-panel:not\(\.hidden\)\s*\{[\s\S]*?display:\s*flex\s*!important/);
    });

    it('shows a graceful empty position state instead of hiding the card', () => {
      // Card stays mounted; only the metrics grid is hidden and inputs dimmed
      expect(themesCss).toMatch(/\.position-panel\.is-empty\s+\.pos-compact-grid\s*\{[\s\S]*?display:\s*none\s*!important/);
      expect(themesCss).toMatch(/\.position-panel\.is-empty\s+\.risk-inputs-row input\s*\{[\s\S]*?opacity:\s*0\.5/);
      // The old aggressive whole-card hide must be gone
      expect(themesCss).not.toMatch(/\.position-panel\.is-empty\s*\{[\s\S]*?display:\s*none\s*!important/);
    });

    it('streamlines redundant UI options across presets, capital, and quantity', () => {
      // Streamlined date presets (3d and 30d hidden, leaving 1D, 7D, Live)
      expect(themesCss).toMatch(/\[data-preset="3d"\]/);
      expect(themesCss).toMatch(/\[data-preset="30d"\]/);

      // Streamlined quantity (0.05 hidden, leaving 0.1, 0.5, 1.0)
      expect(themesCss).toMatch(/\[data-qty="0.05"\]/);

      // Streamlined capital (1k, 25k, 100k hidden, leaving $5K, $10K, $50K)
      expect(themesCss).toMatch(/\[data-balance="1000"\]/);
      expect(themesCss).toMatch(/\[data-balance="25000"\]/);
      expect(themesCss).toMatch(/\[data-balance="100000"\]/);

      // Secondary replay time hidden by default
      expect(themesCss).toMatch(/\.datetime-group\s+#replay-time\s*\{[\s\S]*?display:\s*none\s*!important/);
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

    it('timeline slider has a visual progress fill driven by --timeline-progress', () => {
      const baseCss = fs.readFileSync('src/styles.css', 'utf-8');
      expect(baseCss).toMatch(/--timeline-progress/);
      expect(baseCss).toMatch(/::-webkit-slider-runnable-track/);
      expect(baseCss).toMatch(/::-moz-range-track/);
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
  });
});
