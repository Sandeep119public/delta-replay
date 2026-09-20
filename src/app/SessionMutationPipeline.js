export class SessionMutationPipeline {
  constructor() {
    this._tail = null;
    this._generation = 0;
    this._destroyed = false;
    this._nextSequence = 0;
    this._latestSequence = new Map();
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
    scope = 'default',
    serialize = true,
    canExecute = null,
  } = {}) {
    if (this._destroyed) return Promise.resolve({ applied: false, stale: true, response: null });

    const sequence = ++this._nextSequence;
    const execute = async () => {
      if (this._destroyed || (typeof canExecute === 'function' && !canExecute())) {
        return { applied: false, stale: true, response: null };
      }

      const response = await operation();
      const latestSequence = this._latestSequence.get(scope) || 0;
      const stale = !serialize && sequence < latestSequence;
      const applied = !this._destroyed && !stale && generation === this._generation;

      if (!stale && !this._destroyed) this._latestSequence.set(scope, sequence);
      if (applied && typeof apply === 'function') apply(response);
      return { applied, stale, response };
    };

    if (!serialize) return execute();

    if (!this._tail) {
      const next = execute();
      const tracked = next.catch(() => undefined);
      this._tail = tracked;
      return next;
    }

    const next = this._tail.then(execute, execute);
    const tracked = next.catch(() => undefined);
    this._tail = tracked;
    return next;
  }

  destroy() {
    this._destroyed = true;
    this._generation += 1;
    this._tail = null;
    this._latestSequence.clear();
  }
}
