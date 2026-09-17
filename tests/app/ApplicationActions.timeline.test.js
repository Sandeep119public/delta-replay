import assert from 'node:assert/strict';
import test from 'node:test';

import { createApplicationActions } from '../../src/app/ApplicationActions.js';

function makeDeps({ status = 'playing', currentIndex = 4 } = {}) {
  const calls = [];
  let state = { status, currentIndex };
  const commandController = {
    async pause() {
      calls.push('pause:start');
      state = { ...state, status: 'paused' };
      await Promise.resolve();
      calls.push('pause:end');
      return true;
    },
    async trySeek(index) {
      calls.push(`seek:${index}`);
      state = { ...state, currentIndex: index };
      return true;
    },
    startAt() {},
  };
  const replayPort = { getState: () => ({ ...state }) };
  const timeline = { setPosition: (index) => calls.push(`restore:${index}`) };
  const controls = { setStartIndex() {} };
  const appState = { setPendingStartIndex() {} };
  const statusView = { snapshot: () => ({}) };
  const modeBanner = { update() {} };
  const errorPanel = { show() {} };
  const replay = { preview: async () => true, load: async () => true, changeDataset() {} };

  return {
    calls,
    actions: createApplicationActions({ replay, commandController, replayPort, appState, statusView, modeBanner, timeline, controls, errorPanel }),
  };
}

test('commitTimeline waits for pause before seeking', async () => {
  const { actions, calls } = makeDeps();

  const ok = await actions.commitTimeline(9);

  assert.equal(ok, true);
  assert.deepEqual(calls, ['pause:start', 'pause:end', 'seek:9']);
});

test('commitTimeline does not seek when pause fails', async () => {
  const calls = [];
  let state = { status: 'playing', currentIndex: 4 };
  const commandController = {
    async pause() { calls.push('pause'); return false; },
    async trySeek() { calls.push('seek'); return true; },
  };
  const replayPort = { getState: () => ({ ...state }) };
  const timeline = { setPosition: (index) => calls.push(`restore:${index}`) };
  const actions = createApplicationActions({
    replay: { preview: async () => true, load: async () => true, changeDataset() {} },
    commandController,
    replayPort,
    appState: { setPendingStartIndex() {} },
    statusView: { snapshot: () => ({}) },
    modeBanner: { update() {} },
    timeline,
    controls: { setStartIndex() {} },
    errorPanel: { show() {} },
  });

  const ok = await actions.commitTimeline(9);

  assert.equal(ok, false);
  assert.deepEqual(calls, ['pause', 'restore:4']);
});
