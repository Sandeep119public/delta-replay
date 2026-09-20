import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

describe('UI semantic layers', () => {
  it('replay layer owns replay and timeline geometry', () => {
    const css = read('../src/ui/replay.css');
    expect(css).toMatch(/\.main-layout\s*\{[\s\S]*display:\s*grid/);
    expect(css).toMatch(/\.timeline-section\s*\{[\s\S]*display:\s*grid/);
    expect(css).toMatch(/\.controls-section\s*\{[\s\S]*position:\s*absolute/);
  });

  it('trading layer owns trading workspace styling', () => {
    const css = read('../src/ui/trading.css');
    expect(css).toMatch(/\.side-actions\s*\{[\s\S]*gap:\s*9px/);
    expect(css).toMatch(/\.position-card\s*\{[\s\S]*border-color:/);
    expect(css).toMatch(/\.flatten-button\s*\{[\s\S]*min-height:/);
  });

  it('mobile layer owns touch and safe-area adaptations', () => {
    const css = read('../src/ui/mobile.css');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toMatch(/--phase5-touch:\s*44px/);
    expect(css).toMatch(/min-height:\s*var\(--phase5-touch\)/);
  });

  it('system layer owns command-surface and accessibility polish', () => {
    const css = read('../src/ui/system.css');
    expect(css).toMatch(/\.phase6-command-item[\s\S]*min-height:\s*44px/);
    expect(css).toMatch(/button:focus-visible/);
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
