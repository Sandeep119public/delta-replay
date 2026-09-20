export class SessionMutationPipeline {
  constructor() {
    this._tail = null;
    this._generation = 0;
    this._destroyed = false;
  }

  generation() {
    return this._generation;
  }

  invalidate() {
    this._generation += 1;
    return this._generation;
  }

  run(operation, {
    generation = this._generation,
    apply = null,
    canExecute = null,
  } = {}) {
    if (this._destroyed) {
      return Promise.resolve({ applied: false, stale: true, response: null });
    }

    const execute = async () => {
      if (this._destroyed || (typeof canExecute === 'function' && !canExecute())) {
        return { applied: false, stale: true, response: null };
      }

      const response = await operation();
      const applied = !this._destroyed && generation === this._generation;
      if (applied && typeof apply === 'function') apply(response);
      return { applied, stale: !applied, response };
    };

    const next = this._tail ? this._tail.then(execute, execute) : execute();
    this._tail = next.catch(() => undefined);
    return next;
  }

  destroy() {
    this._destroyed = true;
    this._generation += 1;
    this._tail = null;
  }
}
