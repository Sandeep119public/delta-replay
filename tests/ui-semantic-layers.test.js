import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('replay layer owns replay and timeline geometry', () => {
  const css = read('../../src/ui/replay.css');
  assert.match(css, /\.main-layout\s*\{[\s\S]*display:\s*grid/);
  assert.match(css, /\.timeline-section\s*\{[\s\S]*display:\s*grid/);
  assert.match(css, /\.controls-section\s*\{[\s\S]*position:\s*absolute/);
});

test('trading layer owns trading workspace styling', () => {
  const css = read('../../src/ui/trading.css');
  assert.match(css, /\.side-actions\s*\{[\s\S]*gap:\s*9px/);
  assert.match(css, /\.position-card\s*\{[\s\S]*border-color:/);
  assert.match(css, /\.flatten-button\s*\{[\s\S]*min-height:/);
});

test('mobile layer owns touch and safe-area adaptations', () => {
  const css = read('../../src/ui/mobile.css');
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /--phase5-touch:\s*44px/);
  assert.match(css, /min-height:\s*var\(--phase5-touch\)/);
});

test('system layer owns command-surface and accessibility polish', () => {
  const css = read('../../src/ui/system.css');
  assert.match(css, /\.phase6-command-item[\s\S]*min-height:\s*44px/);
  assert.match(css, /button:focus-visible/);
});

test('responsive layer owns viewport-specific refinements', () => {
  const css = read('../../src/ui/responsive.css');
  for (const media of [
    '@media (min-width: 641px) and (max-width: 1024px)',
    '@media (max-width: 640px)',
    '@media (max-width: 420px)',
    '@media (max-width: 360px)',
  ]) assert.ok(css.includes(media), `missing responsive media query: ${media}`);
  assert.match(css, /\.mobile-nav-toggle/);
  assert.match(css, /body\.drawer-open \.trading-section::before/);
});

test('HTML loads semantic layers in cascade order', () => {
  const html = read('../../index.html');
  const layers = ['index.css', 'data-center.css', 'replay.css', 'trading.css', 'mobile.css', 'system.css', 'responsive.css'];
  let previous = -1;
  for (const layer of layers) {
    const index = html.indexOf(`/src/ui/${layer}`);
    assert.ok(index > previous, `stylesheet order is wrong for ${layer}`);
    previous = index;
  }
});
