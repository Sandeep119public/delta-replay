import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const CSS = 'src/ui/rebuild.css';

describe('rebuilt UI layer ownership', () => {
  const css = fs.readFileSync(CSS, 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');

  it('has one presentation owner for replay, trading, responsive, and accessibility styling', () => {
    expect(html).toContain('/src/ui/rebuild.css');
    expect(css).toContain('.replay-layout');
    expect(css).toContain('.trading-section');
    expect(css).toContain('.mobile-nav-toggle');
    expect(css).toContain('button:focus-visible');
  });

  it('keeps the old layered stylesheet stack out of the shell and source tree', () => {
    for (const legacy of ['index.css','data-center.css','replay.css','trading.css','mobile.css','system.css','responsive.css']) {
      expect(html).not.toContain('/src/ui/' + legacy);
      expect(fs.existsSync('src/ui/' + legacy)).toBe(false);
    }
  });

  it('keeps responsive rules in the rebuilt presentation owner', () => {
    expect(css).toContain('@media(max-width:900px)');
    expect(css).toContain('@media(max-width:640px)');
    expect(css).toContain('@media(max-width:380px)');
    expect(css).toContain('.drawer-open .trading-section');
    expect(css).toContain('.nav-open .app-sidebar');
  });
});
