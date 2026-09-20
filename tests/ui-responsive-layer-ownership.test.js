import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const ROOT = 'src/ui';
const htmlPath = 'index.html';

describe('UI responsive layer ownership', () => {
  it('keeps all responsive refinements in the consolidated layer', () => {
    const responsive = fs.readFileSync(`${ROOT}/responsive.css`, 'utf8');
    expect(responsive).toContain('Consolidated semantic layer');
    expect(responsive).toMatch(/--phase(?:8|9|10)-/);
    expect(responsive).toContain('.mobile-nav-toggle');
    expect(responsive).toContain('body.drawer-open .trading-section::before');
  });

  it('loads the responsive layer after the system layer', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const system = html.indexOf('/src/ui/system.css');
    const responsive = html.indexOf('/src/ui/responsive.css');
    expect(system).toBeGreaterThanOrEqual(0);
    expect(responsive).toBeGreaterThan(system);
    for (const legacy of ['phase8-responsive-final.css','phase9-screen-size-optimization.css','phase10-mobile-replay-polish.css']) {
      expect(html).not.toContain(legacy);
    }
  });
});
