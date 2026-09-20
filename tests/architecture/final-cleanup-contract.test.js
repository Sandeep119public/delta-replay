import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('legacy session-state wrappers are removed', () => {
  const source = read('../../backend/app/services/session_state.py');
  assert.match(source, /def serialize_replay_session\(/);
  assert.match(source, /def restore_replay_session\(/);
  assert.doesNotMatch(source, /def serialize_session\(/);
  assert.doesNotMatch(source, /def restore_session\(/);
});

test('historical phase stylesheet stack is replaced by semantic layers', () => {
  const html = read('../../index.html');
  for (const path of ['phase1-chart-shell.css','phase2-replay-rail.css','phase3-trade-dock.css','phase4-position-activity.css','phase5-mobile-sheets.css','phase6-command-surface.css','phase7-final-system.css','phase8-responsive-final.css','phase9-screen-size-optimization.css','phase10-mobile-replay-polish.css']) {
    assert.doesNotMatch(html, new RegExp(path));
    assert.equal(fs.existsSync(new URL(`../../src/ui/${path}`, import.meta.url)), false, `obsolete stylesheet remains: ${path}`);
  }
  for (const path of ['replay.css','trading.css','mobile.css','system.css','responsive.css']) {
    assert.match(html, new RegExp(path));
  }
});

test('canonical replay symbol and market context APIs remain intentionally distinct', () => {
  const source = read('../../backend/app/services/replay_timeline.py');
  assert.match(source, /def latest_replay_symbol\(/);
  assert.match(source, /def latest_market_context_symbol\(/);
  assert.doesNotMatch(source, /latest_market_step_symbol|latest_market_event_symbol/);
});
