export class SessionMutationPipeline {
  constructor() {
    this._tail = Promise.resolve();
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

  run(operation, { generation = this._generation, apply = null } = {}) {
    if (this._destroyed) return Promise.resolve({ applied: false, response: null });
    const execute = async () => {
      if (this._destroyed || generation !== this._generation) {
        return { applied: false, response: null };
      }
      const response = await operation();
      const applied = !this._destroyed && generation === this._generation;
      if (applied && typeof apply === 'function') apply(response);
      return { applied, response };
    };
    const next = this._tail.then(execute, execute);
    this._tail = next.catch(() => undefined);
    return next;
  }

  destroy() {
    this._destroyed = true;
    this._generation += 1;
    this._tail = Promise.resolve();
  }
}
