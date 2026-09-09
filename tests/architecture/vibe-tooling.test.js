import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function runNode(script, args = []) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args]);
  assert.equal(stderr, '');
  return stdout;
}

test('vibe context JSON exposes the architecture source of truth', async () => {
  const context = JSON.parse(await runNode('scripts/vibe-context.mjs', ['--json']));

  assert.ok(context.ownership['src/app/']);
  assert.ok(context.ownership['src/strategy/']);
  assert.deepEqual(context.layers.includes('ports'), true);
  assert.deepEqual(context.allowedDependencies.core, []);
  assert.deepEqual(context.allowedDependencies.ui, ['ports', 'utils']);
  assert.ok(context.rules.length >= 5);
  assert.equal(context.checks['fast loop'], 'npm run vibe:fast');
});

test('changed-file routing returns stable machine-readable shape', async () => {
  const payload = JSON.parse(await runNode('scripts/vibe-changed.mjs', ['--json']));

  assert.equal(typeof payload.base, 'string');
  assert.ok(Array.isArray(payload.changedFiles));
  assert.ok(Array.isArray(payload.checks));
  assert.equal(payload.defaultCheck, 'npm run vibe:fast');
  for (const check of payload.checks) {
    assert.equal(typeof check.label, 'string');
    assert.equal(typeof check.command, 'string');
  }
});
