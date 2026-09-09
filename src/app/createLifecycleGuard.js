/**
 * Small lifecycle guard used by application composition roots.
 * Keeping start/destroy semantics here makes orchestration safer for agents to edit.
 */
export function createLifecycleGuard({ start, destroy }) {
  let started = false;
  let destroyed = false;

  return Object.freeze({
    start() {
      if (destroyed || started) return;
      started = true;
      return start();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      return destroy();
    },
    get started() { return started; },
    get destroyed() { return destroyed; },
  });
}
