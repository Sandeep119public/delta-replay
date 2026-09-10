import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/phase1-chart-shell.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const workspace = fs.readFileSync('src/ui/paper/markup/Workspace.js', 'utf8');
const timeline = fs.readFileSync('src/ui/paper/markup/Timeline.js', 'utf8');


describe('Phase 1 chart-first shell', () => {
  it('loads the phase 1 shell after the canonical UI stylesheet', () => {
    expect(html.indexOf('src/ui/index.css')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('src/ui/phase1-chart-shell.css')).toBeGreaterThan(html.indexOf('src/ui/index.css'));
  });

  it('keeps the trading desk in a dedicated chart-adjacent column', () => {
    expect(css).toMatch(/\.main-layout\s*\{[\s\S]*display:\s*grid/);
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--phase1-dock\)/);
    expect(css).toMatch(/\.trading-section\s*\{[\s\S]*grid-column:\s*2/);
    expect(css).not.toMatch(/\.trading-section\s*\{[\s\S]*position:\s*absolute/);
  });

  it('keeps the chart contained inside the flexible workspace column', () => {
    expect(css).toMatch(/\.main\s*\{[\s\S]*position:\s*relative/);
    expect(css).toMatch(/#chart-container\s*\{[\s\S]*width:\s*100%[\s\S]*height:\s*100%/);
  });

  it('retains the existing chart, trading, replay and transport DOM contracts', () => {
    for (const id of ['chart-container', 'trading-panel', 'btn-buy', 'btn-sell']) {
      expect(workspace).toContain(`id="${id}"`);
    }
    for (const id of ['timeline-slider', 'btn-play', 'btn-step', 'btn-reset']) {
      expect(timeline).toContain(`id="${id}"`);
    }
  });

  it('has a real mobile sheet fallback instead of squeezing the desktop dock', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)/);
    expect(css).toMatch(/body\.drawer-open \.trading-section/);
    expect(css).toMatch(/position:\s*fixed/);
  });
});
