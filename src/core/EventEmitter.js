/**
 * Minimal synchronous EventEmitter.
 * No DOM dependency. Suitable for ReplayEngine events.
 */
export class EventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    // return unsubscribe
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const set = this._listeners.get(event);
    if (set) set.delete(handler);
  }

  once(event, handler) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      handler(...args);
    };
    this.on(event, wrapper);
    return () => this.off(event, wrapper);
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    // copy to avoid mutation during iteration
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        // Do not swallow - log then continue
        console.error(`[EventEmitter] handler error for "${event}":`, err);
      }
    }
  }

  removeAllListeners(event) {
    if (event) this._listeners.delete(event);
    else this._listeners.clear();
  }
}
