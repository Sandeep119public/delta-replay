import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/phase8-responsive-final.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const workspace = fs.readFileSync('src/ui/paper/markup/Workspace.js', 'utf8');
const timeline = fs.readFileSync('src/ui/paper/markup/Timeline.js', 'utf8');
const mobileDrawer = fs.readFileSync('src/ui/bindMobileDrawer.js', 'utf8');

describe('Phase 8 final responsive system', () => {
  it('loads the final responsive layer after all redesign layers', () => {
    expect(html.indexOf('src/ui/phase8-responsive-final.css')).toBeGreaterThan(html.indexOf('src/ui/phase7-final-system.css'));
  });

  it('covers tablet and mobile breakpoint contracts without owning the desktop shell', () => {
    expect(css).toContain('@media (min-width: 641px) and (max-width: 1024px)');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('@media (max-width: 420px)');
  });

  it('keeps core mobile controls at touch-sized targets', () => {
    expect(css).toMatch(/--phase8-touch:\s*44px/);
    expect(css).toMatch(/min-height:\s*var\(--phase8-touch\)/);
  });

  it('preserves replay and trading DOM contracts', () => {
    for (const id of ['chart-container', 'trading-panel', 'btn-buy', 'btn-sell']) {
      expect(workspace).toContain(`id="${id}"`);
    }
    for (const id of ['timeline-slider', 'btn-play', 'btn-pause', 'btn-step', 'btn-reset']) {
      expect(timeline).toContain(`id="${id}"`);
    }
  });

  it('retains accessible mobile drawer behavior', () => {
    expect(mobileDrawer).toContain('drawer-open');
    expect(mobileDrawer).toContain('aria-expanded');
    expect(mobileDrawer).toContain('aria-hidden');
    expect(mobileDrawer).toContain('Escape');
  });

  it('does not introduce raw viewport-width overflow', () => {
    const rawViewportWidth = css.split('\n').some((line) => /^\s*width:\s*100vw/.test(line));
    expect(rawViewportWidth).toBe(false);
  });
});
