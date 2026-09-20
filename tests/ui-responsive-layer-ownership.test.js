import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const ROOT = 'src/ui';
const responsivePath = `${ROOT}/responsive.css`;
const htmlPath = 'index.html';

describe('UI responsive layer ownership', () => {
  it('keeps the responsive layers consolidated in one stylesheet', () => {
    const responsive = fs.readFileSync(responsivePath, 'utf8');

    expect(responsive).toContain('Phase 10: mobile replay interaction polish');
    expect(responsive).toContain('.mobile-nav-toggle');
    expect(responsive).toContain('body.drawer-open .trading-section::before');
  });

  it('loads responsive styles after the semantic system layer', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const system = html.indexOf('/src/ui/system.css');
    const responsive = html.indexOf('/src/ui/responsive.css');
    expect(system).toBeGreaterThanOrEqual(0);
    expect(responsive).toBeGreaterThan(system);
    expect(html).not.toContain('/src/ui/phase8-responsive-final.css');
    expect(html).not.toContain('/src/ui/phase9-screen-size-optimization.css');
    expect(html).not.toContain('/src/ui/phase10-mobile-replay-polish.css');
  });
});
