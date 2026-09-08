import assert from 'node:assert/strict';
import test from 'node:test';

import { paperMarkup } from '../../src/ui/paperMarkup.js';
import { headerMarkup } from '../../src/ui/paper/markup/Header.js';
import { timelineMarkup } from '../../src/ui/paper/markup/Timeline.js';
import { workspaceMarkup } from '../../src/ui/paper/markup/Workspace.js';

test('paper UI exposes required replay and trading controls', () => {
  const html = paperMarkup();
  for (const id of [
    'page-replay', 'chart-container', 'trading-panel', 'trade-tab', 'account-tab',
    'tab-view-trade', 'tab-view-account', 'btn-play', 'btn-pause', 'btn-step',
    'btn-reset', 'speed-select', 'btn-follow', 'btn-trading-drawer', 'drawer-scrim',
  ]) assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
});

test('inactive account panel starts from the CSS/controller visibility contract', () => {
  const html = workspaceMarkup();
  assert.match(html, /id="trade-tab"[^>]*aria-selected="true"/);
  assert.match(html, /id="account-tab"[^>]*aria-selected="false"/);
  assert.match(html, /id="tab-view-trade"[^>]*aria-labelledby="trade-tab"/);
  assert.match(html, /id="tab-view-account"[^>]*aria-labelledby="account-tab"/);
});

test('legacy compatibility controls are explicitly marked as non-interactive', () => {
  const html = `${headerMarkup()}${timelineMarkup()}`;
  for (const id of ['from-date', 'from-time', 'to-date', 'to-time', 'load-btn', 'jump-date', 'jump-time', 'jump-btn', 'start-replay-btn']) {
    const match = html.match(new RegExp(`<[^>]*id=["']${id}["'][^>]*>`));
    assert.ok(match, `missing #${id}`);
    assert.match(match[0], /class="compat-control"/);
    assert.match(match[0], /aria-hidden="true"/);
    assert.match(match[0], /tabindex="-1"/);
  }
});

test('primary replay control stays available for ready and ended states', () => {
  const html = timelineMarkup();
  assert.match(html, /id="btn-play"[^>]*class="replay-play"/);
  assert.doesNotMatch(html, /id="btn-play"[^>]*disabled/);
});
