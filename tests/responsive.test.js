import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('Responsive UI regression', () => {
  const css = fs.readFileSync('src/styles.css', 'utf-8');
  const html = fs.readFileSync('index.html', 'utf-8');

  it('contains required breakpoint anchors', () => {
    for (const bp of ['320px', '640px', '768px', '900px', '1024px']) {
      expect(css, `missing breakpoint ${bp}`).toMatch(bp);
    }
  });

  it('uses CSS grid for desktop chart+trading side-by-side', () => {
    expect(css).toMatch(/grid-template-areas/);
    expect(css).toMatch(/grid-template-columns/);
    expect(css).toMatch(/chart trading/);
  });

  it('chart has responsive height via clamp', () => {
    expect(css).toMatch(/clamp\(/);
    expect(css).toMatch(/\.main/);
    expect(css).toMatch(/\.chart-container/);
  });

  it('trading panel responsive grid', () => {
    expect(css).toMatch(/\.trading-grid/);
    // should have single column on mobile
    expect(css).toMatch(/@media.*480px/);
  });

  it('no fixed 100vw causing overflow', () => {
    // allow max-width: 100vw (used for #app), forbid raw width: 100vw
    const hasRaw = css.split('\n').some(l => l.trim().startsWith('width:') && l.includes('100vw'));
    expect(hasRaw).toBe(false);
  });

  it('timeline slider touch target min 44px for coarse pointer', () => {
    expect(css).toMatch(/pointer:\s*coarse/);
    expect(css).toMatch(/min-height:\s*44px/);
  });

  it('html has viewport meta', () => {
    expect(html).toMatch(/name="viewport"/);
  });

  it('ChartManager uses ResizeObserver', () => {
    const cm = fs.readFileSync('src/chart/ChartManager.js', 'utf-8');
    expect(cm).toMatch(/ResizeObserver/);
    expect(cm).toMatch(/disconnect/);
  });

  it('no horizontal overflow: min-width 0 on grid/flex children', () => {
    expect(css).toMatch(/min-width:\s*0/);
  });
});
