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
    start(index) { calls.push(['start', index]); current.status = 'playing'; subscribers.forEach((cb) => cb({ ...current })); return Promise.resolve({ ...current }); },
    play() { calls.push(['play']); current.status = 'playing'; subscribers.forEach((cb) => cb({ ...current })); return Promise.resolve({ ...current }); },
    pause() { calls.push(['pause']); current.status = 'paused'; subscribers.forEach((cb) => cb({ ...current })); return Promise.resolve({ ...current }); },
    stepForward() { calls.push(['stepForward']); return Promise.resolve(); },
    reset() { calls.push(['reset']); current.status = 'ready'; return Promise.resolve({ ...current }); },
    setSpeed(speed) { calls.push(['setSpeed', speed]); current.speed = Number(speed); speedSubscribers.forEach((cb) => cb({ speed: current.speed })); return Promise.resolve(); },
  };
}

function createControls(state) {
  const port = replayPort(state);
  const controls = Object.fromEntries(['playBtn', 'pauseBtn', 'stepBtn', 'resetBtn', 'startReplayBtn', 'speedSelect', 'statusEl'].map((key) => [key, button()]));
  controls.speedSelect.value = '1';
  return { port, controls, instance: new ReplayControls({ replayPort: port, ...controls }) };
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

  it('keeps the header display synchronized for playing and paused states', () => {
    const { port, controls, instance } = createControls({ status: 'playing', totalCandles: 100, startIndex: 0, currentIndex: 10, speed: 1 });
    expect(controls.startReplayBtn.textContent).toBe('PAUSE');
    expect(controls.startReplayBtn.setAttribute).toHaveBeenCalledWith('aria-label', 'Pause replay');

    port.pause();
    expect(controls.startReplayBtn.textContent).toBe('RESUME');
    expect(controls.startReplayBtn.setAttribute).toHaveBeenCalledWith('aria-label', 'Resume replay');
    instance.destroy();
  });

  it('keeps rendering safe when optional control elements are absent', () => {
    const port = replayPort({ status: 'paused', totalCandles: 10, startIndex: 0, currentIndex: 4, speed: 1 });
    const statusEl = button();
    const instance = new ReplayControls({ replayPort: port, statusEl });
    expect(statusEl.textContent).toBe('PAUSED');
    expect(() => instance.render(port.getState())).not.toThrow();
    instance.destroy();
  });
});
