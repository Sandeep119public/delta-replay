import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/phase7-final-system.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const runtime = fs.readFileSync('src/app/createApplicationRuntime.js', 'utf8');
const appShell = fs.readFileSync('src/ui/paper/markup/AppShell.js', 'utf8');

describe('Phase 7 final UI system cleanup', () => {
  it('loads the final interaction layer before later responsive refinements', () => {
    expect(html.indexOf('src/ui/phase7-final-system.css')).toBeGreaterThan(html.indexOf('src/ui/phase6-command-surface.css'));
    expect(html.indexOf('src/ui/phase8-responsive-final.css')).toBeGreaterThan(html.indexOf('src/ui/phase7-final-system.css'));
  });

  it('does not hide active application navigation or routed data pages', () => {
    expect(css).not.toContain('.side-nav');
    expect(css).not.toContain('#page-dashboard');
    expect(css).not.toContain('#page-strategies');
    expect(css).not.toContain('#page-journal');
    expect(css).not.toContain('#page-settings');
    expect(appShell).toContain('class="app-sidebar"');
    expect(appShell).toContain('id="page-dashboard"');
    expect(appShell).toContain('id="page-strategies"');
    expect(appShell).toContain('id="page-journal"');
  });

  it('keeps the application shell and runtime-owned chart active', () => {
    expect(appShell).toContain('id="page-replay"');
    expect(runtime).toContain('renderPaperLayout');
    expect(runtime).toContain("requireElement('chart-container')");
  });

  it('keeps shared focus and narrow-layout safety contracts', () => {
    expect(css).toContain('button:focus-visible');
    expect(css).toContain('min-width: 0');
    expect(css).toContain('@media (max-width: 640px)');
  });
});
