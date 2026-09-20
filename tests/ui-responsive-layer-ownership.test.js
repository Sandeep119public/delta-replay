import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const ROOT = 'src/ui';
const phase9Path = `${ROOT}/phase9-screen-size-optimization.css`;
const phase10Path = `${ROOT}/phase10-mobile-replay-polish.css`;
const htmlPath = 'index.html';

describe('UI responsive layer ownership', () => {
  it('keeps final mobile replay polish in Phase 10 only', () => {
    const phase9 = fs.readFileSync(phase9Path, 'utf8');
    const phase10 = fs.readFileSync(phase10Path, 'utf8');

    expect(phase9).not.toContain('Phase 10: mobile replay workspace polish');
    expect(phase9).not.toContain('--phase10-header-gutter');
    expect(phase10).toContain('.mobile-nav-toggle');
    expect(phase10).toContain('body.drawer-open .trading-section::before');
  });

  it('loads Phase 10 after the earlier responsive layers', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const phase8 = html.indexOf('/src/ui/phase8-responsive-final.css');
    const phase9 = html.indexOf('/src/ui/phase9-screen-size-optimization.css');
    const phase10 = html.indexOf('/src/ui/phase10-mobile-replay-polish.css');

    expect(phase8).toBeGreaterThanOrEqual(0);
    expect(phase9).toBeGreaterThan(phase8);
    expect(phase10).toBeGreaterThan(phase9);
  });
});
