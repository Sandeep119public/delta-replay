import assert from 'node:assert/strict';
import test from 'node:test';

import { terminalMarkup } from '../../src/ui/rebuildMarkup.js';

test('rebuilt UI exposes required replay and trading controls', () => {
  const html = terminalMarkup();
  for (const id of ['page-replay','chart-container','trading-panel','trade-tab','account-tab','tab-view-trade','tab-view-account','btn-play','btn-pause','btn-step','btn-reset','speed-select','btn-follow','btn-trading-drawer','drawer-scrim']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
});

test('application shell exposes stable page and navigation contracts', () => {
  const html = terminalMarkup();
  for (const page of ['dashboard','replay','downloads','datasets','validation','storage','experiments','strategies','journal','jobs','system']) {
    assert.match(html, new RegExp(`id=["']page-${page}["']`), `missing page-${page}`);
    assert.match(html, new RegExp(`class=["'][^"']*nav-link[^"']*["'][^>]*data-page=["']${page}["']`), `missing nav link for ${page}`);
  }
  assert.match(html, /id="mobile-nav-toggle"[^>]*aria-controls="app-sidebar"/);
});

test('account panel starts inactive while trade panel is active', () => {
  const html = terminalMarkup();
  assert.match(html, /id="trade-tab"[^>]*aria-selected="true"/);
  assert.match(html, /id="account-tab"[^>]*aria-selected="false"/);
  assert.match(html, /id="tab-view-trade"[^>]*aria-labelledby="trade-tab"/);
  assert.match(html, /id="tab-view-account"[^>]*aria-labelledby="account-tab"/);
});

test('trading panel exposes a stable accessible name', () => {
  const html = terminalMarkup();
  assert.match(html, /id="trading-panel"[^>]*aria-labelledby="trading-panel-title"/);
  assert.match(html, /<h2 id="trading-panel-title">Trading desk<\/h2>/);
});

test('interactive controls declare button type explicitly', () => {
  const html = terminalMarkup();
  const ids = ['live-mode-btn','replay-mode-btn','replay-dataset-refresh','header-start-replay-btn','timeline-start-btn','btn-play','btn-pause','btn-step','btn-reset','btn-follow','btn-buy','btn-sell','btn-close','btn-reset-acct','btn-trading-drawer'];
  for (const id of ids) {
    const match = html.match(new RegExp(`<button[^>]*id=["']${id}["'][^>]*>`));
    assert.ok(match, `missing button #${id}`);
    assert.match(match[0], /type="button"/);
  }
});

test('rebuilt shell contains no legacy compatibility controls', () => {
  const html = terminalMarkup();
  for (const id of ['from-date','from-time','to-date','to-time','load-btn','jump-date','jump-time','jump-btn','start-replay-btn','replay-date','replay-time']) {
    assert.doesNotMatch(html, new RegExp(`id=["']${id}["']`), `legacy control survived: #${id}`);
  }
});

test('primary replay control and playback ladder remain available', () => {
  const html = terminalMarkup();
  assert.match(html, /id="btn-play"[^>]*class="replay-play"/);
  for (const speed of ['0.25','0.5','1','2','5','10']) assert.match(html, new RegExp(`<option value="${speed}"`));
});
