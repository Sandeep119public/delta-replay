import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('replay and trading remote engines share the session mutation pipeline', () => {
  const replay = read('../../src/app/RemoteReplayEngine.js');
  const trading = read('../../src/app/RemoteTradingEngine.js');
  assert.match(replay, /SessionMutationPipeline/);
  assert.match(trading, /SessionMutationPipeline/);
  assert.match(replay, /this\.mutationPipeline\.run/);
  assert.match(trading, /this\.mutationPipeline\.run/);
});

test('legacy session request queue is absent', () => {
  assert.equal(fs.existsSync(new URL('../../src/app/SessionRequestQueue.js', import.meta.url)), false);
});

test('application runtime creates exactly one mutation pipeline', () => {
  const source = read('../../src/app/createCoreServices.js');
  assert.equal((source.match(/new SessionMutationPipeline\(\)/g) || []).length, 1);
  assert.match(source, /new RemoteReplayEngine\([^;]*mutationPipeline/);
  assert.match(source, /new RemoteTradingEngine\([^;]*mutationPipeline/);
});
