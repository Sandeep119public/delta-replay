import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const OWNER = 'src/ui/phase1-chart-shell.css';
const NON_OWNER_STYLES = [
  'src/ui/phase2-replay-rail.css',
  'src/ui/phase3-trade-dock.css',
  'src/ui/phase4-position-activity.css',
  'src/ui/phase5-mobile-sheets.css',
  'src/ui/phase6-command-surface.css',
  'src/ui/phase7-final-system.css',
  'src/ui/phase8-responsive-final.css',
  'src/ui/phase9-screen-size-optimization.css',
];

const WORKSPACE_SELECTORS = [
  '.main-layout',
  '.main',
  '.chart-stage',
  '.chart-container',
  '#chart-container',
  '.trading-section',
];

const GEOMETRY_PROPERTIES = [
  'display',
  'position',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'margin',
  'grid-column',
  'grid-row',
  'grid-template-columns',
  'grid-template-rows',
  'grid-template-areas',
];

function cssBlocks(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    declarations: match[2],
  }));
}

function selectorContainsWorkspace(selector) {
  return WORKSPACE_SELECTORS.some((token) => selector.split(',').some((part) => part.trim().endsWith(token)));
}

function geometryProperties(declarations) {
  const found = [];
  for (const property of GEOMETRY_PROPERTIES) {
    const pattern = new RegExp(`(?:^|\\n|;)\\s*${property.replace('-', '\\-')}\\s*:`, 'm');
    if (pattern.test(declarations)) found.push(property);
  }
  return found;
}

describe('workspace geometry ownership', () => {
  it('keeps the chart/trading workspace geometry in Phase 1', () => {
    const css = fs.readFileSync(OWNER, 'utf8');
    const blocks = cssBlocks(css);
    for (const selector of WORKSPACE_SELECTORS) {
      expect(blocks.some(({ selector: blockSelector }) => blockSelector.split(',').some((part) => part.trim() === selector))).toBe(true);
    }
  });

  it('prevents later UI phases from adding workspace geometry', () => {
    for (const path of NON_OWNER_STYLES) {
      const css = fs.readFileSync(path, 'utf8');
      const violations = [];

      for (const { selector, declarations } of cssBlocks(css)) {
        if (!selectorContainsWorkspace(selector)) continue;
        const properties = geometryProperties(declarations);
        if (properties.length) violations.push({ selector, properties });
      }

      expect(violations, `${path} adds workspace geometry outside Phase 1`).toEqual([]);
    }
  });
});
