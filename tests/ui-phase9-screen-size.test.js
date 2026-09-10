import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/phase9-screen-size-optimization.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

describe('Phase 9 screen-size optimization', () => {
  it('loads after the previous responsive layers', () => {
    expect(html.indexOf('src/ui/phase9-screen-size-optimization.css')).toBeGreaterThan(
      html.indexOf('src/ui/phase8-responsive-final.css'),
    );
  });

  it('covers wide desktop through very narrow mobile', () => {
    expect(css).toContain('@media (min-width: 1440px)');
    expect(css).toContain('@media (min-width: 1025px) and (max-width: 1439px)');
    expect(css).toContain('@media (min-width: 841px) and (max-width: 1024px)');
    expect(css).toContain('@media (min-width: 641px) and (max-width: 840px)');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('@media (max-width: 420px)');
    expect(css).toContain('@media (max-width: 360px)');
  });

  it('keeps the main layout shrink-safe', () => {
    for (const selector of ['.main-layout', '.main', '.chart-stage', '#chart-container', '.trading-section', '.topbar']) {
      expect(css).toMatch(new RegExp(`${selector.replace('.', '\\.') }[\\s\\S]*min-width:\\s*0`));
    }
  });

  it('keeps the trading desk in its own desktop grid column', () => {
    expect(css).toMatch(/\.main-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--phase9-dock\)/);
    expect(css).toMatch(/\.trading-section\s*\{[\s\S]*grid-column:\s*2/);
    expect(css).toMatch(/\.trading-section\s*\{[\s\S]*width:\s*auto\s*!important/);
    expect(css).toMatch(/\.trading-section\s*\{[\s\S]*position:\s*relative\s*!important/);
  });

  it('clips chart rendering to the allocated chart lane', () => {
    expect(css).toMatch(/\.main\s*\{[\s\S]*overflow:\s*hidden/);
    expect(css).toMatch(/#chart-container\s*\{[\s\S]*overflow:\s*hidden/);
    expect(css).toMatch(/#chart-container canvas,[\s\S]*max-width:\s*100%/);
  });

  it('keeps core compact-screen controls touch-sized', () => {
    expect(css).toContain('--phase9-touch: 44px');
    expect(css).toMatch(/\.phase6-command-trigger[\s\S]*min-height:\s*var\(--phase9-touch\)/);
    expect(css).toMatch(/\.controls-row button,[\s\S]*min-height:\s*var\(--phase9-touch\)/);
  });

  it('handles landscape mobile separately', () => {
    expect(css).toContain('@media (orientation: landscape) and (max-width: 840px)');
  });

  it('avoids raw viewport-width sizing', () => {
    const rawViewportWidth = css.split('\n').some((line) => /^\s*(width|max-width):\s*100vw/.test(line));
    expect(rawViewportWidth).toBe(false);
  });
});
