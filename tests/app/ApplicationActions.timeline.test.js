import { describe, expect, it } from 'vitest';

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

describe('ApplicationActions timeline commits', () => {
  it('waits for pause before seeking', async () => {
    const { actions, calls } = makeDeps();

    const ok = await actions.commitTimeline(9);

    expect(ok).toBe(true);
    expect(calls).toEqual(['pause:start', 'pause:end', 'seek:9']);
  });

  it('does not seek when pause fails', async () => {
    const calls = [];
    const state = { status: 'playing', currentIndex: 4 };
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

    expect(ok).toBe(false);
    expect(calls).toEqual(['pause', 'restore:4']);
  });
});
