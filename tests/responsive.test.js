import { describe, it, expect } from 'vitest';
import fs from 'fs';

// Paper UI v1 consolidates all stylesheets into a single bundle.
const CSS_PATH = 'src/ui/index.css';

describe('Responsive UI regression', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf-8');
  const html = fs.readFileSync('index.html', 'utf-8');

  it('uses the single Paper UI stylesheet', () => {
    expect(html).toMatch(/src\/ui\/index\.css/);
    expect(css).toMatch(/PAPER UI v1/);
  });

  it('contains required breakpoint anchors', () => {
    for (const bp of ['640px', '1024px']) {
      expect(css, `missing breakpoint ${bp}`).toMatch(bp);
    }
  });

  it('uses CSS grid for desktop chart+trading side-by-side', () => {
    expect(css).toMatch(/\.main-layout/);
    expect(css).toMatch(/grid-template-columns/);
    // Page owns the viewport grid: header / status / workspace / timeline / controls
    expect(css).toMatch(/"header"/);
    expect(css).toMatch(/"workspace"/);
    expect(css).toMatch(/\.trading-section/);
  });

  it('chart fills its workspace pane without overflow', () => {
    expect(css).toMatch(/\.main/);
    expect(css).toMatch(/\.chart-container/);
    expect(css).toMatch(/100dvh/);
    expect(css).toMatch(/minmax\(0, 1fr\)/);
  });

  it('trading panel docks as a bottom drawer on small screens', () => {
    expect(css).toMatch(/\.trading-section/);
    // single column workspace collapse at tablet width
    expect(css).toMatch(/@media.*1024px/);
    // drawer reveal hook
    expect(css).toMatch(/drawer-open/);
  });

  it('no fixed 100vw causing overflow', () => {
    // allow max-width: 100vw / calc(100vw - ...) (used for .error-panel), forbid raw width: 100vw
    const hasRaw = css.split('\n').some(l => l.trim().startsWith('width:') && l.includes('100vw'));
    expect(hasRaw).toBe(false);
  });

  it('primary trade buttons meet the 44px touch target', () => {
    expect(css).toMatch(/\.btn-buy-main/);
    expect(css).toMatch(/\.btn-sell-main/);
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
