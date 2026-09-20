import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const ROOT = 'src/ui';
const phase9Path = `${ROOT}/responsive.css`;
const phase10Path = `${ROOT}/responsive.css`;
const htmlPath = 'index.html';

describe('UI responsive layer ownership', () => {
  it('keeps final mobile replay polish in Phase 10 only', () => {
    const responsive = fs.readFileSync(phase9Path, 'utf8');

    expect(responsive).toContain('Phase 10: mobile replay workspace polish');
    expect(responsive).toContain('--phase10-header-gutter');
    expect(responsive).toContain('.mobile-nav-toggle');
    expect(responsive).toContain('body.drawer-open .trading-section::before');
  });

  it('loads Phase 10 after the earlier responsive layers', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const phase8 = html.indexOf('/src/ui/system.css');
    const phase9 = html.indexOf('/src/ui/responsive.css');
    const phase10 = html.indexOf('/src/ui/responsive.css');

    expect(phase8).toBeGreaterThanOrEqual(0);
    expect(phase9).toBeGreaterThan(phase8);
    expect(phase10).toBeGreaterThan(phase9);
  });
});
