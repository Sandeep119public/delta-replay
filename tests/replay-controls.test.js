import { describe, expect, it, vi } from 'vitest';
import { ReplayControls } from '../src/ui/ReplayControls.js';

function button() {
  const listeners = new Map();
  return {
    disabled: false,
    textContent: '',
    dataset: {},
    classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
    setAttribute: vi.fn(),
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    click() { listeners.get('click')?.(); },
    hasListener(type) { return listeners.has(type); },
  };
}

function replayPort(state) {
  const current = { ...state };
  const subscribers = new Set();
  const speedSubscribers = new Set();
  const calls = [];
  return {
    calls,
    getState: () => ({ ...current }),
    getTotalCandles: () => current.totalCandles,
    onStateChanged(cb) { subscribers.add(cb); return () => subscribers.delete(cb); },
    onSpeedChanged(cb) { speedSubscribers.add(cb); return () => speedSubscribers.delete(cb); },
  };
}

function commandPort(calls) {
  return {
    togglePlayPause: vi.fn(() => { calls.push(['togglePlayPause']); }),
    pause: vi.fn(() => { calls.push(['pause']); }),
    stepForward: vi.fn(() => { calls.push(['stepForward']); }),
    reset: vi.fn(() => { calls.push(['reset']); }),
    setSpeed: vi.fn((speed) => { calls.push(['setSpeed', speed]); }),
  };
}

function createControls(state) {
  const port = replayPort(state);
  const controls = Object.fromEntries(['playBtn', 'pauseBtn', 'stepBtn', 'resetBtn', 'startReplayBtn', 'speedSelect', 'statusEl'].map((key) => [key, button()]));
  controls.speedSelect.value = '1';
  const commands = commandPort(port.calls);
  return { port, commands, controls, instance: new ReplayControls({ replayPort: port, commandPort: commands, ...controls }) };
}

describe('ReplayControls', () => {
  it('renders the replay header state without registering a competing command handler', () => {
    const { port, controls, instance } = createControls({ status: 'ready', totalCandles: 100, startIndex: 12, currentIndex: 12, speed: 1 });
    controls.startReplayBtn.dataset.startIndex = '12';

    expect(controls.startReplayBtn.hasListener('click')).toBe(false);
    controls.startReplayBtn.click();

    expect(port.calls).toEqual([]);
    expect(controls.startReplayBtn.textContent).toBe('START REPLAY');
    expect(controls.startReplayBtn.setAttribute).toHaveBeenCalledWith('aria-label', 'Start replay');
    instance.destroy();
  });

  it('routes replay button intents through the presentation command port', () => {
    const { commands, controls, instance } = createControls({ status: 'paused', totalCandles: 100, startIndex: 0, currentIndex: 10, speed: 1 });

    controls.playBtn.click();
    controls.pauseBtn.click();
    controls.stepBtn.click();
    controls.resetBtn.click();
    controls.speedSelect.value = '5';
    controls.speedSelect.dispatchEvent?.(new Event('change'));

    expect(commands.togglePlayPause).toHaveBeenCalledTimes(1);
    expect(commands.pause).toHaveBeenCalledTimes(1);
    expect(commands.stepForward).toHaveBeenCalledTimes(1);
    expect(commands.reset).toHaveBeenCalledTimes(1);
    instance.destroy();
  });

  it('keeps the header display synchronized for playing and paused states', () => {
    const { port, controls, instance } = createControls({ status: 'playing', totalCandles: 100, startIndex: 0, currentIndex: 10, speed: 1 });
    expect(controls.startReplayBtn.textContent).toBe('PAUSE');
    expect(controls.startReplayBtn.setAttribute).toHaveBeenCalledWith('aria-label', 'Pause replay');

    port.calls.length = 0;
    const subscribers = new Set();
    void subscribers;
    instance.render({ status: 'paused', totalCandles: 100, startIndex: 0, currentIndex: 10, speed: 1 });
    expect(controls.startReplayBtn.textContent).toBe('RESUME');
    expect(controls.startReplayBtn.setAttribute).toHaveBeenCalledWith('aria-label', 'Resume replay');
    instance.destroy();
  });

  it('keeps rendering safe when optional control elements are absent', () => {
    const port = replayPort({ status: 'paused', totalCandles: 10, startIndex: 0, currentIndex: 4, speed: 1 });
    const statusEl = button();
    const instance = new ReplayControls({ replayPort: port, commandPort: commandPort(port.calls), statusEl });
    expect(statusEl.textContent).toBe('PAUSED');
    expect(() => instance.render(port.getState())).not.toThrow();
    instance.destroy();
  });
});
