import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { ThemeManager, THEMES, THEME_NAMES } from '../src/ui/ThemeManager.js';
import { ChartManager, CHART_THEMES } from '../src/chart/ChartManager.js';
import { Timeline } from '../src/ui/Timeline.js';
import { terminalMarkup } from '../src/ui/rebuildMarkup.js';

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
      (listeners[event.type || event] || []).forEach(h => h(event));
    },
    setAttribute(name, val) { attrs[name] = val; },
    getAttribute(name) { return attrs[name] ?? null; },
    ...initial,
  };
}

describe('ThemeManager & rebuilt UI', () => {
  beforeEach(() => {
    global.document = {
      documentElement: createMockElement(),
      body: createMockElement(),
      getElementById: vi.fn(() => null),
    };
  });

  it('keeps the single paper theme boundary', () => {
    expect(THEMES.PAPER).toBe('paper');
    expect(Object.keys(THEMES)).toEqual(['PAPER']);
    expect(THEME_NAMES[THEMES.PAPER]).toBe('Paper');
    const manager = new ThemeManager();
    manager.applyTheme('dark');
    expect(manager.getTheme()).toBe('paper');
    expect(document.documentElement.getAttribute('data-theme')).toBe('paper');
  });

  it('keeps chart theme profiles independent from the UI theme boundary', () => {
    expect(CHART_THEMES.dark).toBeDefined();
    expect(CHART_THEMES.paper).toBeDefined();
    expect(CHART_THEMES.light).toBeDefined();
    expect(CHART_THEMES.midnight).toBeDefined();
    expect(CHART_THEMES.colorblind.series).toMatchObject({ upColor: '#60a5fa', downColor: '#fb923c' });
  });

  it('Timeline publishes replay progress to --timeline-progress', () => {
    const sliderEl = createMockElement({ value: '0', min: '0', style: { setProperty: vi.fn() } });
    const mk = (t = '') => createMockElement({ textContent: t });
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
    expect(calls.at(-1)?.[1]).toMatch(/%/);
  });

  it('mounts the rebuilt terminal markup with stable controls', () => {
    const html = terminalMarkup();
    for (const id of ['app-sidebar','page-replay','symbol-select','timeframe-select','replay-dataset-select','chart-container','trading-panel','timeline-slider','btn-play','btn-step','btn-reset','btn-buy','btn-sell','btn-close','btn-trading-drawer']) {
      expect(html).toContain('id="' + id + '"');
    }
    expect(html).not.toContain('theme-select');
    expect(html).not.toContain('theme-pills');
    expect(html).not.toContain('replay-date');
    expect(html).not.toContain('jump-date');
  });

  it('uses the rebuilt stylesheet from the HTML shell', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    expect(html).toMatch(/href="\/src\/ui\/rebuild\.css"/);
    expect(html).not.toMatch(/href="\/src\/ui\/(index|replay|trading|mobile|system|responsive|data-center)\.css"/);
  });
});
