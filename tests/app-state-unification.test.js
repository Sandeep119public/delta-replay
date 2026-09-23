import { describe, it, expect, vi } from 'vitest';
import { AppState } from '../src/state/AppState.js';
import { LoadingState } from '../src/data/DataError.js';

describe('AppState', () => {
  it('initializes with IDLE loading state and default attributes', () => {
    const state = new AppState();
    expect(state.loadingState).toBe(LoadingState.IDLE);
    expect(state.loading).toBe(false);
    expect(state.dataError).toBeNull();
    expect(state.pendingStartIndex).toBe(0);
    expect(state.retryCount).toBe(0);
  });

  it('does not own historical candle data', () => {
    const state = new AppState();
    expect('candleStore' in state).toBe(false);
    expect('_store' in state).toBe(false);
    expect('candles' in state).toBe(false);
    expect('totalCandles' in state).toBe(false);
    expect(typeof state.setCandles).toBe('undefined');
    expect(typeof state.setCandleStore).toBe('undefined');
  });

  it('transitionLoading updates loadingState, error, and emits loadingStateChanged', () => {
    const state = new AppState();
    const handler = vi.fn();
    state.on('loadingStateChanged', handler);
    state.transitionLoading(LoadingState.LOADING);
    expect(state.loadingState).toBe(LoadingState.LOADING);
    expect(state.loading).toBe(true);
    expect(handler).toHaveBeenCalledWith({ loadingState: LoadingState.LOADING, dataError: null });

    const mockError = { userMessage: 'Failed network', category: 'NETWORK' };
    state.transitionLoading(LoadingState.NETWORK_ERROR, mockError);
    expect(state.loadingState).toBe(LoadingState.NETWORK_ERROR);
    expect(state.loading).toBe(false);
    expect(state.error).toBe('Failed network');
    expect(state.dataError).toBe(mockError);
  });

  it('setPendingStartIndex updates cursor and emits pendingStartIndexChanged', () => {
    const state = new AppState();
    const handler = vi.fn();
    state.on('pendingStartIndexChanged', handler);
    state.setPendingStartIndex(42);
    expect(state.pendingStartIndex).toBe(42);
    expect(handler).toHaveBeenCalledWith(42);
  });

  it('snapshot is deeply immutable', () => {
    const state = new AppState();
    const error = { userMessage: 'Failed network', context: { status: 503 } };
    const replay = { status: 'paused', currentIndex: 7, totalCandles: 10 };
    state.transitionLoading(LoadingState.NETWORK_ERROR, error);
    state.setReplayState(replay);

    const snap = state.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.dataError.context)).toBe(true);
    expect(Object.isFrozen(snap.replayState)).toBe(true);
    expect(() => { snap.dataError.context.status = 200; }).toThrow();
    expect(() => { snap.replayState.currentIndex = 99; }).toThrow();
    expect(state.dataError.context.status).toBe(503);
    expect(state.replayState.currentIndex).toBe(7);
  });
});
