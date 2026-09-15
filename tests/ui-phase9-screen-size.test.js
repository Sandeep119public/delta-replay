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

  it('covers tablet through very narrow mobile', () => {
    expect(css).toContain('@media (min-width: 841px) and (max-width: 1024px)');
    expect(css).toContain('@media (min-width: 641px) and (max-width: 840px)');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('@media (max-width: 420px)');
    expect(css).toContain('@media (max-width: 360px)');
  });

  it('does not redefine page-frame or workspace geometry owned by Phase 1', () => {
    expect(css).not.toMatch(/(?:^|\n)\s*#page-replay\.active\s*\{/);
    expect(css).not.toMatch(/(?:^|\n)\s*\.main-layout\s*\{/);
    expect(css).not.toMatch(/(?:^|\n)\s*\.main\s*\{/);
    expect(css).not.toMatch(/(?:^|\n)\s*\.chart-stage\s*\{/);
    expect(css).not.toMatch(/(?:^|\n)\s*#chart-container\s*\{/);
    expect(css).not.toMatch(/(?:^|\n)\s*\.trading-section\s*\{/);
    expect(css).not.toContain('--phase9-dock');
  });

  it('keeps core compact-screen controls touch-sized', () => {
    expect(css).toContain('--phase9-touch: 44px');
    expect(css).toMatch(/\.phase6-command-trigger[\s\S]*min-height:\s*var\(--phase9-touch\)/);
    expect(css).toMatch(/\.controls-row button,[\s\S]*min-height:\s*var\(--phase9-touch\)/);
  });

  it('keeps the mobile replay setup in one bounded header row', () => {
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto auto/);
    expect(css).toMatch(/\.topbar-center[\s\S]*max-width:\s*min\(232px, 64vw\)/);
    expect(css).toMatch(/#header-start-replay-btn[\s\S]*width:\s*var\(--phase9-touch\)/);
    expect(css).toMatch(/\.topbar-right \.paper-badge,\s*\n\s*\.topbar-right #data-status \{\s*display:\s*none/);
  });

  it('does not hide replay secondary transport controls', () => {
    expect(css).not.toMatch(/\.controls-row \.replay-secondary\s*\{\s*display:\s*none/);
  });

  it('handles landscape mobile separately', () => {
    expect(css).toContain('@media (orientation: landscape) and (max-width: 840px)');
  });

  it('avoids raw viewport-width sizing', () => {
    const rawViewportWidth = css.split('\n').some((line) => /^\s*(width|max-width):\s*100vw/.test(line));
    expect(rawViewportWidth).toBe(false);
  });
});
