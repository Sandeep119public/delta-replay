/**
 * Minimal synchronous EventEmitter with safe async-handler handling.
 * No DOM/BOM dependency. Suitable for core/replay/trading modules.
 *
 * Errors are recorded locally and optionally reported through an injected
 * reporter so the emitter stays environment-agnostic and reusable in
 * browsers, Node, workers, and tests.
 */
export class EventEmitter {
  constructor({ errorReporter } = {}) {
    this._listeners = new Map();
    this._errorReporter = typeof errorReporter === 'function' ? errorReporter : null;
    this._listenerErrors = [];
  }

  on(event, handler) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const set = this._listeners.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this._listeners.delete(event);
  }

  once(event, handler) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    const wrapper = (...args) => {
      this.off(event, wrapper);
      return handler(...args);
    };
    return this.on(event, wrapper);
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;

    for (const fn of [...set]) {
      try {
        const result = fn(payload);
        if (result && typeof result.then === 'function') {
          result.catch(err => this._reportError(event, err, 'async'));
        }
      } catch (err) {
        this._reportError(event, err, 'sync');
      }
    }
  }

  getLastListenerErrors() {
    return [...this._listenerErrors];
  }

  removeAllListeners(event) {
    if (event) this._listeners.delete(event);
    else this._listeners.clear();
  }

  listenerCount(event) {
    return this._listeners.get(event)?.size ?? 0;
  }

  _reportError(event, err, phase) {
    this._listenerErrors.push({ event, error: err, phase, at: Date.now() });
    if (this._listenerErrors.length > 20) this._listenerErrors.shift();
    if (!this._errorReporter) return;
    try {
      this._errorReporter(err, { event, phase });
    } catch (reporterError) {
      this._listenerErrors.push({ event, error: reporterError, phase: 'reporter', at: Date.now() });
      if (this._listenerErrors.length > 20) this._listenerErrors.shift();
    }
  }
}
