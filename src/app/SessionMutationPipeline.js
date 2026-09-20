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
    mode = 'serial',
    canExecute = null,
  } = {}) {
    if (mode !== 'serial' && mode !== 'latest') {
      throw new TypeError('session mutation mode must be serial or latest');
    }
    if (this._destroyed) {
      return Promise.resolve({ applied: false, stale: true, response: null });
    }

    const sequence = ++this._nextSequence;
    const execute = async () => {
      if (this._destroyed || (typeof canExecute === 'function' && !canExecute())) {
        return { applied: false, stale: true, response: null };
      }

      const response = await operation();
      const latestSequence = this._latestSequence.get(scope) || 0;
      const stale = mode === 'latest' && sequence < latestSequence;
      const applied = !this._destroyed && !stale && generation === this._generation;

      if (mode === 'latest' && !stale && !this._destroyed) {
        this._latestSequence.set(scope, sequence);
      }
      if (applied && typeof apply === 'function') apply(response);
      return { applied, stale, response };
    };

    if (mode === 'latest') return execute();

    const next = this._tail ? this._tail.then(execute, execute) : execute();
    this._tail = next.catch(() => undefined);
    return next;
  }

  destroy() {
    this._destroyed = true;
    this._generation += 1;
    this._tail = null;
    this._latestSequence.clear();
  }
}
