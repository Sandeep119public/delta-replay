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

const PAGE_SHELL_SELECTORS = [
  '#page-replay.active',
];

const WORKSPACE_SELECTORS = [
  '.main-layout',
  '.main',
  '.chart-stage',
  '.chart-container',
  '#chart-container',
  '.trading-section',
];

const OWNED_SELECTORS = [...PAGE_SHELL_SELECTORS, ...WORKSPACE_SELECTORS];

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

const AT_RULE_BLOCKS = /^(?:@media|@supports|@container|@layer|@scope|@document|@starting-style)\b/i;

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function findMatchingBrace(source, openIndex, end) {
  let depth = 1;
  let quote = null;
  for (let i = openIndex + 1; i < end; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unclosed CSS block at index ${openIndex}`);
}

function cssRules(css) {
  const source = stripComments(css);
  const rules = [];

  function walk(start, end) {
    let cursor = start;
    while (cursor < end) {
      while (cursor < end && /[\s;]/.test(source[cursor])) cursor += 1;
      if (cursor >= end) break;

      const open = source.indexOf('{', cursor);
      if (open === -1 || open >= end) break;
      const close = findMatchingBrace(source, open, end);
      const header = source.slice(cursor, open).trim();
      const body = source.slice(open + 1, close);

      if (AT_RULE_BLOCKS.test(header)) walk(open + 1, close);
      else rules.push({ selector: header, declarations: body });

      cursor = close + 1;
    }
  }

  walk(0, source.length);
  return rules;
}

function selectorContainsOwnedGeometry(selector) {
  return OWNED_SELECTORS.some((token) =>
    selector.split(',').some((part) => {
      const normalized = part.trim();
      return normalized === token || normalized.endsWith(` ${token}`);
    }),
  );
}

function geometryProperties(declarations) {
  return GEOMETRY_PROPERTIES.filter((property) =>
    new RegExp(`(?:^|[\\n;])\\s*${property.replace('-', '\\-')}\\s*:`, 'm').test(declarations),
  );
}

function findRule(rules, selector) {
  return rules.find(({ selector: candidate }) =>
    candidate.split(',').some((part) => part.trim() === selector),
  );
}

describe('workspace geometry ownership', () => {
  it('keeps the replay page frame in Phase 1', () => {
    const rules = cssRules(fs.readFileSync(OWNER, 'utf8'));
    const pageFrame = findRule(rules, '#page-replay.active');

    expect(pageFrame, `${OWNER} must define #page-replay.active`).toBeTruthy();
    expect(pageFrame?.declarations).toMatch(/display\s*:\s*grid/);
    expect(pageFrame?.declarations).toMatch(/grid-template-rows\s*:/);
    expect(pageFrame?.declarations).toMatch(/grid-template-areas\s*:/);
  });

  it('keeps the desktop workspace geometry in Phase 1', () => {
    const rules = cssRules(fs.readFileSync(OWNER, 'utf8'));
    for (const selector of WORKSPACE_SELECTORS) {
      expect(findRule(rules, selector), `${OWNER} must define ${selector}`).toBeTruthy();
    }

    expect(findRule(rules, '.main-layout')?.declarations).toMatch(/grid-template-columns\s*:/);
    expect(findRule(rules, '.main')?.declarations).toMatch(/grid-column\s*:\s*1/);
    expect(findRule(rules, '.trading-section')?.declarations).toMatch(/grid-column\s*:\s*2/);
    expect(findRule(rules, '.trading-section')?.declarations).toMatch(/grid-row\s*:\s*1/);
  });

  it('keeps mobile drawer geometry in Phase 1', () => {
    const rules = cssRules(fs.readFileSync(OWNER, 'utf8'));
    const mobileDrawer = findRule(rules, 'body.drawer-open .trading-section');
    expect(mobileDrawer).toBeTruthy();
    expect(mobileDrawer?.declarations).toMatch(/position\s*:\s*fixed/);
    expect(mobileDrawer?.declarations).toMatch(/width\s*:/);
    expect(mobileDrawer?.declarations).toMatch(/height\s*:/);
  });

  it('prevents later UI phases from adding page-frame or workspace geometry', () => {
    for (const path of NON_OWNER_STYLES) {
      const violations = cssRules(fs.readFileSync(path, 'utf8'))
        .filter(({ selector }) => selectorContainsOwnedGeometry(selector))
        .map(({ selector, declarations }) => ({ selector, properties: geometryProperties(declarations) }))
        .filter(({ properties }) => properties.length > 0);

      expect(violations, `${path} adds owned geometry outside Phase 1`).toEqual([]);
    }
  });
});
