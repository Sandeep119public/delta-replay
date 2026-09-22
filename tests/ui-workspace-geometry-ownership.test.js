import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const OWNER = 'src/ui/rebuild.css';

describe('rebuilt workspace geometry ownership', () => {
  const css = fs.readFileSync(OWNER, 'utf8');

  it('keeps the replay workspace in one presentation owner', () => {
    for (const selector of ['.replay-layout','.chart-workspace','.chart-stage','.chart-container','.trading-section']) {
      expect(css).toContain(selector);
    }
    expect(css).toContain('grid-template-columns:minmax(0,1fr) var(--trade)');
  });

  it('keeps the mobile trading drawer in the same owner', () => {
    expect(css).toContain('.drawer-open .trading-section');
    expect(css).toContain('position:fixed');
    expect(css).toContain('height:100dvh');
    expect(css).toContain('transform:translateX(105%)');
  });

  it('prevents the deleted phase stack from becoming a second source of truth', () => {
    for (const path of ['src/ui/index.css','src/ui/data-center.css','src/ui/replay.css','src/ui/trading.css','src/ui/mobile.css','src/ui/system.css','src/ui/responsive.css']) {
      expect(fs.existsSync(path), path + ' should be deleted with the old presentation stack').toBe(false);
    }
  });
});
