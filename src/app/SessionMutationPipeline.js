export class SessionMutationPipeline {
  constructor() {
    this._tail = Promise.resolve();
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
    this._latestSequence.set(scope, sequence);
    const execute = async () => {
      if (this._destroyed || (typeof canExecute === 'function' && !canExecute())) {
        return { applied: false, stale: true, response: null };
      }

      const response = await operation();
      const latestSequence = this._latestSequence.get(scope) || 0;
      const stale = sequence !== latestSequence;
      const applied = !this._destroyed && !stale && generation === this._generation;

      if (applied && typeof apply === 'function') apply(response);

      return { applied, stale, response };
    };

    if (!serialize) return execute();

    const next = this._tail.then(execute, execute);
    this._tail = next.catch(() => undefined);
    return next;
  }

  destroy() {
    this._destroyed = true;
    this._generation += 1;
    this._tail = Promise.resolve();
    this._latestSequence.clear();
  }
}
