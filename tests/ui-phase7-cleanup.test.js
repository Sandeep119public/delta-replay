import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/phase7-final-system.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const application = fs.readFileSync('src/app/Application.js', 'utf8');
const paperMarkup = fs.readFileSync('src/ui/paperMarkup.js', 'utf8');

describe('Phase 7 final UI system cleanup', () => {
  it('loads the cleanup layer before the final responsive layer', () => {
    expect(html.indexOf('src/ui/phase7-final-system.css')).toBeGreaterThan(html.indexOf('src/ui/phase6-command-surface.css'));
    expect(html.indexOf('src/ui/phase8-responsive-final.css')).toBeGreaterThan(html.indexOf('src/ui/phase7-final-system.css'));
  });

  it('neutralizes legacy navigation and dormant page containers', () => {
    expect(css).toContain('.side-nav');
    expect(css).toContain('#page-dashboard');
    expect(css).toContain('#page-settings');
    expect(css).toMatch(/display:\s*none\s*!important/);
  });

  it('keeps the active replay shell as the product surface', () => {
    expect(paperMarkup).toContain('id="page-replay"');
    expect(application).toContain('renderPaperLayout');
    expect(application).toContain("requireElement('chart-container')");
  });

  it('keeps shared focus and narrow-layout safety contracts', () => {
    expect(css).toContain('button:focus-visible');
    expect(css).toContain('min-width: 0');
    expect(css).toContain('@media (max-width: 640px)');
  });
});
