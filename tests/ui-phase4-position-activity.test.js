import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/phase4-position-activity.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const workspace = fs.readFileSync('src/ui/paper/markup/Workspace.js', 'utf8');

describe('Phase 4 position and activity inspector', () => {
  it('loads Phase 4 after the trade dock layer', () => {
    expect(html.indexOf('src/ui/phase4-position-activity.css')).toBeGreaterThan(
      html.indexOf('src/ui/phase3-trade-dock.css'),
    );
  });

  it('makes position exposure the primary inspector surface', () => {
    expect(css).toMatch(/\.position-card\s*\{[\s\S]*border-color:/);
    expect(css).toMatch(/\.position-card-head\s*\{[\s\S]*border-bottom:/);
    expect(css).toMatch(/\.pos-compact-grid\s*\{[\s\S]*repeat\(4/);
  });

  it('keeps risk and flatten controls visually explicit', () => {
    expect(css).toMatch(/\.current-risk\s*\{[\s\S]*border-top:/);
    expect(css).toMatch(/\.flatten-button\s*\{[\s\S]*min-height:\s*40px/);
  });

  it('preserves the existing state and activity hooks', () => {
    for (const id of ['pos-symbol', 'pos-side', 'pos-qty', 'pos-entry', 'pos-current', 'pos-pnl', 'pos-sl', 'pos-tp', 'btn-close', 'pending-orders-list', 'trades-list']) {
      expect(workspace).toContain(`id=\"${id}\"`);
    }
  });

  it('adapts the inspector to narrower screens', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*840px\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)/);
    expect(css).toMatch(/min-height:\s*44px/);
  });
});
