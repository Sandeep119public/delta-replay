import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const CSS_PATH = 'src/ui/rebuild.css';

describe('Rebuilt responsive UI regression', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');

  it('loads one rebuilt UI stylesheet', () => {
    expect(html).toMatch(/src\/ui\/rebuild\.css/);
    for (const legacy of ['index.css','data-center.css','replay.css','trading.css','mobile.css','system.css','responsive.css']) {
      expect(html).not.toContain('/src/ui/' + legacy);
    }
  });

  it('contains the responsive breakpoints used by the rebuilt shell', () => {
    for (const bp of ['900px','640px','380px']) expect(css).toContain(bp);
  });

  it('uses a bounded desktop chart/trading grid', () => {
    expect(css).toContain('.replay-layout');
    expect(css).toContain('grid-template-columns:minmax(0,1fr) var(--trade)');
    expect(css).toContain('.chart-workspace');
    expect(css).toContain('.trading-section');
  });

  it('keeps the chart inside a viewport-sized workspace without raw 100vw width', () => {
    expect(css).toContain('100dvh');
    expect(css).toContain('.chart-container{width:100%;height:100%}');
    const hasRaw = css.split('}').some(block => /(^|;)width:100vw(?:;|$)/.test(block));
    expect(hasRaw).toBe(false);
  });

  it('uses an explicit mobile trading drawer and navigation surface', () => {
    expect(css).toContain('.drawer-open .trading-section');
    expect(css).toContain('#drawer-scrim');
    expect(css).toContain('.mobile-nav-toggle');
    expect(css).toContain('.nav-open .app-sidebar');
  });

  it('keeps primary trading controls touch-sized and keyboard-visible', () => {
    expect(css).toContain('.btn-buy-main');
    expect(css).toContain('.btn-sell-main');
    expect(css).toContain('min-height:42px');
    expect(css).toContain('button:focus-visible');
  });

  it('keeps the viewport meta contract', () => {
    expect(html).toMatch(/name="viewport"/);
  });

  it('ChartManager still owns resize lifecycle', () => {
    const cm = fs.readFileSync('src/chart/ChartManager.js', 'utf8');
    expect(cm).toMatch(/ResizeObserver/);
    expect(cm).toMatch(/disconnect/);
  });

  it('prevents horizontal overflow in the rebuilt shell', () => {
    expect(css).toContain('min-width:0');
  });
});
