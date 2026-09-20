import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

describe('semantic UI layers', () => {
  it('replay layer owns replay and timeline geometry', () => {
    const css = read('../src/ui/replay.css');
    expect(css).toContain('.main-layout');
    expect(css).toContain('.timeline-section');
    expect(css).toContain('.controls-section');
  });

  it('trading layer owns trading workspace styling', () => {
    const css = read('../src/ui/trading.css');
    expect(css).toContain('.side-actions');
    expect(css).toContain('.position-card');
    expect(css).toContain('.flatten-button');
  });

  it('mobile layer owns touch and safe-area adaptations', () => {
    const css = read('../src/ui/mobile.css');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('--phase5-touch');
    expect(css).toContain('var(--phase5-touch)');
  });

  it('system layer owns command-surface and accessibility polish', () => {
    const css = read('../src/ui/system.css');
    expect(css).toContain('.phase6-command-item');
    expect(css).toContain('button:focus-visible');
  });

  it('responsive layer owns viewport-specific refinements', () => {
    const css = read('../src/ui/responsive.css');
    for (const media of [
      '@media (min-width: 641px) and (max-width: 1024px)',
      '@media (max-width: 640px)',
      '@media (max-width: 420px)',
      '@media (max-width: 360px)',
    ]) expect(css).toContain(media);
    expect(css).toMatch(/\.mobile-nav-toggle/);
    expect(css).toMatch(/body\.drawer-open \.trading-section::before/);
  });

  it('HTML loads semantic layers in cascade order', () => {
    const html = read('../index.html');
    const layers = ['index.css', 'data-center.css', 'replay.css', 'trading.css', 'mobile.css', 'system.css', 'responsive.css'];
    let previous = -1;
    for (const layer of layers) {
      const index = html.indexOf('/src/ui/' + layer);
      expect(index, 'stylesheet order is wrong for ' + layer).toBeGreaterThan(previous);
      previous = index;
    }
  });
});
