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
});
