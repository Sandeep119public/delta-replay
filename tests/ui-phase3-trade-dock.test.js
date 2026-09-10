import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/phase3-trade-dock.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const workspace = fs.readFileSync('src/ui/paper/markup/Workspace.js', 'utf8');

const directTradingSectionRules = [...css.matchAll(/(?:^|\n)\s*\.trading-section\s*\{([^}]*)\}/g)]
  .map((match) => match[1]);

const forbiddenGeometryProperties = new Set([
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'position',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'grid-column',
  'grid-row',
]);

const declarationNames = (rule) => [...rule.matchAll(/(?:^|\n)\s*([a-z-]+)\s*:/gi)]
  .map((match) => match[1].toLowerCase());

describe('Phase 3 trading desk presentation', () => {
  it('loads Phase 3 after the earlier UI layers', () => {
    expect(html.indexOf('src/ui/phase3-trade-dock.css')).toBeGreaterThan(html.indexOf('src/ui/phase2-replay-rail.css'));
  });

  it('does not own workspace geometry', () => {
    expect(css).not.toMatch(/--phase3-dock-width/);

    const geometryDeclarations = directTradingSectionRules
      .flatMap(declarationNames)
      .filter((name) => forbiddenGeometryProperties.has(name));

    expect(geometryDeclarations).toEqual([]);
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

  it('keeps the mobile trading sheet presentation intact', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)/);
    expect(css).toMatch(/min-height:\s*50px/);
  });
});
