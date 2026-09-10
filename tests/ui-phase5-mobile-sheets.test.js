import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/phase5-mobile-sheets.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const mobileDrawer = fs.readFileSync('src/ui/bindMobileDrawer.js', 'utf8');
const workspace = fs.readFileSync('src/ui/paper/markup/Workspace.js', 'utf8');

describe('Phase 5 mobile-first sheets', () => {
  it('loads Phase 5 after the earlier UI layers', () => {
    expect(html.indexOf('src/ui/phase5-mobile-sheets.css')).toBeGreaterThan(html.indexOf('src/ui/phase4-position-activity.css'));
  });
  it('uses viewport-safe sheet spacing and touch-sized controls', () => {
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toMatch(/--phase5-touch:\s*44px/);
    expect(css).toMatch(/min-height:var\(--phase5-touch\)/);
  });
  it('keeps the existing drawer state hooks', () => {
    expect(mobileDrawer).toContain('drawer-open');
    expect(mobileDrawer).toContain('aria-expanded');
    expect(mobileDrawer).toContain('Escape');
    expect(mobileDrawer).toContain('focus');
  });
  it('preserves primary trading controls for touch layouts', () => {
    for (const id of ['trading-panel', 'btn-buy', 'btn-sell', 'btn-close', 'trade-qty', 'order-type']) {
      expect(workspace).toContain(`id="${id}"`);
    }
    expect(css).toMatch(/\.order-action,[\s\S]*min-height:var\(--phase5-touch\)/);
  });
  it('collapses fields into a mobile-friendly single column', () => {
    expect(css).toMatch(/\.ticket-field-grid,.risk-grid\{grid-template-columns:1fr/);
  });
});
