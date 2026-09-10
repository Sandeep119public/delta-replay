import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/phase3-trade-dock.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const workspace = fs.readFileSync('src/ui/paper/markup/Workspace.js', 'utf8');

describe('Phase 3 contextual trade dock', () => {
  it('loads Phase 3 after the earlier UI layers', () => {
    expect(html.indexOf('src/ui/phase3-trade-dock.css')).toBeGreaterThan(html.indexOf('src/ui/phase2-replay-rail.css'));
  });

  it('keeps the dock contextual and bounded', () => {
    expect(css).toMatch(/\.trading-section\s*\{[\s\S]*width:\s*var\(--phase3-dock-width\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*1180px\)[\s\S]*--phase3-dock-width:\s*338px/);
    expect(css).not.toMatch(/width:\s*100vw/);
  });

  it('prioritizes order entry with full-size primary actions', () => {
    expect(css).toMatch(/\.side-actions\s*\{[\s\S]*gap:\s*9px/);
    expect(css).toMatch(/\.order-action,[\s\S]*min-height:\s*48px/);
    expect(css).toMatch(/\.btn-buy-main/);
    expect(css).toMatch(/\.btn-sell-main/);
  });

  it('preserves trading interaction contracts', () => {
    for (const id of ['trading-panel', 'order-ticket', 'order-type', 'trade-qty', 'btn-buy', 'btn-sell', 'btn-close', 'sl-price', 'tp-price']) {
      expect(workspace).toContain(`id=\"${id}\"`);
    }
  });

  it('keeps the mobile trading sheet usable', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)/);
    expect(css).toMatch(/border-radius:\s*18px\s+18px\s+0\s+0/);
    expect(css).toMatch(/min-height:\s*50px/);
  });
});
