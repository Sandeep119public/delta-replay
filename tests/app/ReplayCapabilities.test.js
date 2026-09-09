import { describe, expect, it, vi } from 'vitest';
import { createReplayCapabilities } from '../../src/app/ReplayCapabilities.js';

describe('createReplayCapabilities', () => {
  it('is safe before a coordinator is attached', async () => {
    const runtime = createReplayCapabilities();

    expect(await runtime.capabilities.load()).toBeUndefined();
    expect(runtime.capabilities.preview(4)).toBeUndefined();
    expect(runtime.capabilities.changeDataset('symbol', 'BTCUSDT')).toBeUndefined();
  });

  it('forwards the stable capability contract after attachment', async () => {
    const coordinator = {
      loadAndPrepareReplay: vi.fn().mockResolvedValue('loaded'),
      updatePreviewWindow: vi.fn().mockReturnValue('previewed'),
      handleSymbolTimeframeChange: vi.fn().mockReturnValue('changed'),
    };
    const runtime = createReplayCapabilities();

    runtime.attach(coordinator);

    await expect(runtime.capabilities.load({ autoStart: false })).resolves.toBe('loaded');
    expect(runtime.capabilities.preview(7)).toBe('previewed');
    expect(runtime.capabilities.changeDataset('timeframe', '15m', 'select')).toBe('changed');
    expect(coordinator.loadAndPrepareReplay).toHaveBeenCalledWith({ autoStart: false });
    expect(coordinator.updatePreviewWindow).toHaveBeenCalledWith(7);
    expect(coordinator.handleSymbolTimeframeChange).toHaveBeenCalledWith('timeframe', '15m', 'select');
  });

  it('allows the coordinator to be replaced without changing the capability object', () => {
    const runtime = createReplayCapabilities();
    const first = { updatePreviewWindow: vi.fn() };
    const second = { updatePreviewWindow: vi.fn() };

    runtime.attach(first);
    runtime.capabilities.preview(1);
    runtime.attach(second);
    runtime.capabilities.preview(2);

    expect(first.updatePreviewWindow).toHaveBeenCalledWith(1);
    expect(second.updatePreviewWindow).toHaveBeenCalledWith(2);
  });
});
