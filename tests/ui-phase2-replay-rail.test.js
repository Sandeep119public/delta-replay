import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/phase2-replay-rail.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const timeline = fs.readFileSync('src/ui/paper/markup/Timeline.js', 'utf8');

describe('Phase 2 unified replay rail', () => {
  it('loads after the phase 1 shell layer', () => {
    expect(html.indexOf('src/ui/phase1-chart-shell.css')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('src/ui/phase2-replay-rail.css')).toBeGreaterThan(
      html.indexOf('src/ui/phase1-chart-shell.css'),
    );
  });

  it('leaves the replay page frame to Phase 1', () => {
    expect(css).not.toMatch(/#page-replay\.active\s*\{/);
    expect(css).not.toMatch(/#page-replay\.active[\s\S]*?grid-template-rows\s*:/);
    expect(css).not.toMatch(/#page-replay\.active[\s\S]*?grid-template-areas\s*:/);
  });

  it('treats timeline and transport as one shared surface', () => {
    expect(css).toMatch(/\.timeline-section\s*\{[\s\S]*display:\s*grid/);
    expect(css).toMatch(/\.timeline-section\s*\{[\s\S]*grid-template-areas:[\s\S]*"meta header spacer"/);
    expect(css).toMatch(/\.timeline-section\s*,\s*\.controls-section\s*\{[\s\S]*grid-area:\s*timeline/);
    expect(css).toMatch(/\.controls-section\s*\{[\s\S]*border:\s*0/);
  });

  it('keeps the replay interaction hooks stable', () => {
    for (const id of [
      'timeline-slider',
      'timeline-sparkline',
      'timeline-start-btn',
      'btn-play',
      'btn-pause',
      'btn-step',
      'btn-reset',
      'speed-select',
      'btn-follow',
      'replay-status',
    ]) {
      expect(timeline).toContain(`id="${id}"`);
    }
  });

  it('gives mobile a compact single-rail transport treatment', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)/);
    expect(css).toMatch(/\.timeline-section\s*\{[\s\S]*grid-template-columns:/);
    expect(css).toMatch(/\.controls-section\s*\{[\s\S]*position:\s*absolute/);
  });
});
