import { describe, expect, it, vi } from 'vitest';
import { ReplayControls } from '../src/ui/ReplayControls.js';

function button() {
  const listeners = new Map();
  return {
    disabled: false,
    textContent: '',
    classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
    setAttribute: vi.fn(),
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    click() { listeners.get('click')?.(); },
    emit(type) { listeners.get(type)?.(); },
  };
}

function replayPort(state) {
  const current = { ...state };
  const subscribers = new Set();
  const speedSubscribers = new Set();
  return {
    getState: () => ({ ...current }),
    getTotalCandles: () => current.totalCandles,
    onStateChanged(cb) { subscribers.add(cb); return () => subscribers.delete(cb); },
    onSpeedChanged(cb) { speedSubscribers.add(cb); return () => speedSubscribers.delete(cb); },
  };
}

function commands() {
  return {
    togglePlayPause: vi.fn(),
    pause: vi.fn(),
    stepForward: vi.fn(),
    reset: vi.fn(),
    setSpeed: vi.fn(),
  };
}

function createControls(state) {
  const port = replayPort(state);
  const controls = Object.fromEntries(['playBtn', 'pauseBtn', 'stepBtn', 'resetBtn', 'speedSelect', 'statusEl'].map((key) => [key, button()]));
  controls.speedSelect.value = '1';
  const commandHandlers = commands();
  return { port, commandHandlers, controls, instance: new ReplayControls({ replayPort: port, commands: commandHandlers, ...controls }) };
}

describe('ReplayControls', () => {
  it('routes replay button intents through direct command handlers', () => {
    const { commandHandlers, controls, instance } = createControls({ status: 'paused', totalCandles: 100, startIndex: 0, currentIndex: 10, speed: 1 });

    controls.playBtn.click();
    controls.pauseBtn.click();
    controls.stepBtn.click();
    controls.resetBtn.click();
    controls.speedSelect.value = '5';
    controls.speedSelect.emit('change');

    expect(commandHandlers.togglePlayPause).toHaveBeenCalledTimes(1);
    expect(commandHandlers.pause).toHaveBeenCalledTimes(1);
    expect(commandHandlers.stepForward).toHaveBeenCalledTimes(1);
    expect(commandHandlers.reset).toHaveBeenCalledTimes(1);
    expect(commandHandlers.setSpeed).toHaveBeenCalledWith('5');
    instance.destroy();
  });

  it('keeps rendering safe when optional control elements are absent', () => {
    const port = replayPort({ status: 'paused', totalCandles: 10, startIndex: 0, currentIndex: 4, speed: 1 });
    const statusEl = button();
    const instance = new ReplayControls({ replayPort: port, commands: commands(), statusEl });
    expect(statusEl.textContent).toBe('PAUSED');
    expect(() => instance.render(port.getState())).not.toThrow();
    instance.destroy();
  });
});
