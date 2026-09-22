import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const CSS = 'src/ui/rebuild.css';

describe('rebuilt semantic presentation owner', () => {
  const css = fs.readFileSync(CSS, 'utf8');

  it('owns replay workspace geometry and timeline controls', () => {
    for (const selector of ['.replay-layout','.chart-workspace','.chart-stage','.chart-container','.timeline-section','.controls-section']) {
      expect(css).toContain(selector);
    }
  });

  it('owns trading presentation and risk controls', () => {
    for (const selector of ['.trading-section','.side-actions','.position-card','.flatten-button']) {
      expect(css).toContain(selector);
    }
  });

  it('owns mobile navigation, drawer, and accessibility polish', () => {
    expect(css).toContain('.mobile-nav-toggle');
    expect(css).toContain('.drawer-open .trading-section');
    expect(css).toContain('button:focus-visible');
  });

  it('owns data-page presentation in the same shell', () => {
    for (const selector of ['.data-page','.data-card-grid','.data-panel','.data-table-wrap']) {
      expect(css).toContain(selector);
    }
  });
});
