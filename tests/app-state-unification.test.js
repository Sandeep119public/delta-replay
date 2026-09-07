import { describe, it, expect, vi } from 'vitest';
import { AppState } from '../src/state/AppState.js';
import { LoadingState } from '../src/data/DataError.js';

describe('AppState — Unification & Central Reactivity', () => {
  it('initializes with IDLE loading state and default attributes', () => {
    const state = new AppState();
    expect(state.loadingState).toBe(LoadingState.IDLE);
    expect(state.loading).toBe(false);
    expect(state.dataError).toBeNull();
    expect(state.pendingStartIndex).toBe(0);
    expect(state.retryCount).toBe(0);
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

  it('snapshot includes all unified state fields', () => {
    const state = new AppState();
    state.setPendingStartIndex(10);
    state.setRetryCount(2);
    state.transitionLoading(LoadingState.SUCCESS);

    const snap = state.snapshot();
    expect(snap.pendingStartIndex).toBe(10);
    expect(snap.retryCount).toBe(2);
    expect(snap.loadingState).toBe(LoadingState.SUCCESS);
  });

  it('snapshot is deeply immutable and cannot mutate nested replay or error state', () => {
    const state = new AppState();
    const error = { userMessage: 'Failed network', context: { status: 503 } };
    const replay = { status: 'paused', currentIndex: 7 };
    state.transitionLoading(LoadingState.NETWORK_ERROR, error);
    state.setReplayState(replay);

    const snap = state.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.dataError)).toBe(true);
    expect(Object.isFrozen(snap.dataError.context)).toBe(true);
    expect(Object.isFrozen(snap.replayState)).toBe(true);
    expect(() => { snap.dataError.context.status = 200; }).toThrow();
    expect(() => { snap.replayState.currentIndex = 99; }).toThrow();
    expect(state.dataError.context.status).toBe(503);
    expect(state.replayState.currentIndex).toBe(7);
  });

  it('candle compatibility reads return frozen copies', () => {
    const state = new AppState();
    state.setCandles([{ time: 1000, open: 100, high: 105, low: 95, close: 102 }]);

    const candles = state.candles;
    const candle = state.getCandle(0);
    const window = state.sliceWindow(0, 1);

    expect(Object.isFrozen(candles)).toBe(true);
    expect(Object.isFrozen(candles[0])).toBe(true);
    expect(Object.isFrozen(candle)).toBe(true);
    expect(Object.isFrozen(window)).toBe(true);
    expect(Object.isFrozen(window[0])).toBe(true);
    expect(() => { candle.close = 999; }).toThrow();
    expect(state.getCandle(0).close).toBe(102);
  });
});
