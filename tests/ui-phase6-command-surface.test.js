import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/phase6-command-surface.css', 'utf8');
const commandSurface = fs.readFileSync('src/ui/CommandSurface.js', 'utf8');
const application = fs.readFileSync('src/app/Application.js', 'utf8');
const main = fs.readFileSync('src/main.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const navigationPath = 'src/ui/Navigation.js';

describe('Phase 6 command surface', () => {
  it('loads the command layer after the responsive sheet layer', () => {
    expect(html.indexOf('src/ui/phase6-command-surface.css')).toBeGreaterThan(html.indexOf('src/ui/phase5-mobile-sheets.css'));
  });

  it('keeps replay as the primary shell and removes the unused side navigation', () => {
    expect(css).toMatch(/\.side-nav\s*\{[\s\S]*display:\s*none/);
    expect(fs.existsSync(navigationPath)).toBe(false);
    expect(main).not.toContain("./ui/Navigation");
  });

  it('provides a keyboard accessible modal command dialog', () => {
    expect(commandSurface).toContain('aria-haspopup');
    expect(commandSurface).toContain('aria-expanded');
    expect(commandSurface).toContain('role="dialog"');
    expect(commandSurface).toContain('aria-modal="true"');
    expect(commandSurface).toContain('getFocusable()');
    expect(commandSurface).toContain("event.key === 'Tab'");
    expect(commandSurface).toContain("event.key.toLowerCase() === 'k'");
    expect(commandSurface).toContain("event.key === 'Escape'");
  });

  it('routes trade-panel focus through the authoritative mobile drawer controller', () => {
    expect(commandSurface).toContain('focusTradePanel');
    expect(commandSurface).toContain("focusTradePanel('trade-qty')");
    expect(application).toContain('createCommandSurface');
    expect(application).toContain('focusTradePanel: mobileDrawer?.focusTradingPanel');
  });

  it('reports command execution failure instead of silently succeeding', () => {
    expect(commandSurface).toContain('function clickElement(id)');
    expect(commandSurface).toContain("return clickElement('header-start-replay-btn')");
    expect(commandSurface).toContain("return clickElement('btn-step')");
    expect(commandSurface).toContain("return clickElement('btn-reset')");
  });

  it('exposes replay and trading actions without replacing existing bindings', () => {
    for (const id of ['symbol-select', 'replay-date', 'header-start-replay-btn', 'timeline-slider', 'btn-play', 'btn-step', 'btn-reset', 'trade-qty']) {
      expect(commandSurface).toContain(`'${id}'`);
    }
    expect(application).toContain('createCommandSurface');
    expect(application).toContain('commandSurface,');
    expect(main).toContain('app.commandSurface');
  });

  it('uses touch-safe command controls on mobile', () => {
    expect(css).toMatch(/\.phase6-command-item[\s\S]*min-height:\s*44px/);
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)/);
  });
});
