/**
 * Minimal synchronous EventEmitter with safe async-handler handling.
 * No DOM dependency. Suitable for core/replay/trading modules.
 */
export class EventEmitter {
  constructor() {
    this._listeners = new Map();
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
    const wrapper = (...args) => {
      this.off(event, wrapper);
      handler(...args);
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
          result.catch(err => {
            console.error(`[EventEmitter] async handler error for "${event}":`, err);
          });
        }
      } catch (err) {
        console.error(`[EventEmitter] handler error for "${event}":`, err);
      }
    }
  }

  removeAllListeners(event) {
    if (event) this._listeners.delete(event);
    else this._listeners.clear();
  }

  listenerCount(event) {
    return this._listeners.get(event)?.size ?? 0;
  }
}
