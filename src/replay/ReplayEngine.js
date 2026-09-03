import { EventEmitter } from '../core/EventEmitter.js';
import { CandleValidator } from '../data/CandleValidator.js';
import { ReplayEvents } from './ReplayEvents.js';
import { ReplayStatus, ALLOWED_SPEEDS, createInitialState } from './ReplayState.js';
import { logger } from '../core/Logger.js';

/**
 * ReplayEngine - completely independent from DOM / Chart.
 *
 * Speed semantics: 1x = 1 candle per second, 2x = 2 candles per second, etc.
 * Scheduler uses single controlled timer (setTimeout loop), no duplicate timers.
 */
export class ReplayEngine extends EventEmitter {
  constructor() {
    super();
    // Datastore ownership note (Phase 6.6 audit):
    // CandleStore is the canonical historical source; ReplayEngine keeps a second full copy via _candles.
    // Duplication is intentional for mutation isolation: CandleStore is mutable via AppState/manager,
    // ReplayEngine must never be mutated by external store edits during replay. A read-only view would
    // break isolation if CandleStore is reloaded mid-replay. Keep two copies; AppState now proxies
    // to CandleStore without duplicating (see AppState.setCandleStore), so total copies remain 2
    // (CandleStore + ReplayEngine._candles) instead of 3. Safe read-only interface could eliminate
    // one copy but would require freeze/immutability guarantees and refactor risk; not done now.
    this._candles = []; // all loaded candles (private, never exposed fully during replay)
    this._symbol = null;
    this._actionGuards = [];
    this._state = createInitialState();
    this._timer = null;
    this._lastTick = null;
    this._accum = 0;
  }

  // ---------- Public API ----------

  registerActionGuard(guardFn) {
    if (typeof guardFn !== 'function') throw new Error('guardFn must be a function');
    this._actionGuards.push(guardFn);
    return () => {
      this._actionGuards = this._actionGuards.filter(g => g !== guardFn);
    };
  }

  _checkGuards(action, payload) {
    for (const guard of this._actionGuards) {
      try {
        const res = guard(action, payload);
        if (res && res.allowed === false) {
          return res;
        }
      } catch (err) {
        return { allowed: false, reason: err.message };
      }
    }
    return { allowed: true };
  }

  setSymbol(symbol) { this._symbol = symbol; }
  getSymbol() { return this._symbol; }

  _cloneCandle(c) {
    return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
  }

  load(candles, { symbol } = {}) {
    const check = this._checkGuards('load', { candles, symbol });
    if (!check.allowed) {
      return this.getState();
    }
    this._clearTimer();
    if (!Array.isArray(candles) || candles.length === 0) {
      throw new Error('load: candles must be a non-empty array');
    }
    // Validate batch: strictly increasing, OHLC rules, etc.
    let prev = null;
    for (let i = 0; i < candles.length; i++) {
      const res = CandleValidator.validate(candles[i], prev);
      if (!res.valid) {
        logger.warn(`Invalid candle at index ${i}: ${res.reason}`);
        throw new Error(`Invalid candle at index ${i}: ${res.reason}`);
      }
      prev = candles[i].time;
    }

    // Defensive deep clone: prevent caller mutation from reaching engine
    this._candles = candles.map(c => this._cloneCandle(c));
    this._symbol = symbol || candles[0]?.symbol || this._symbol || null;
    this._state = {
      ...createInitialState(),
      status: ReplayStatus.READY,
      totalCandles: candles.length,
      currentIndex: -1,
      startIndex: -1,
      speed: this._state.speed || 1
    };
    this._accum = 0;
    this.emit(ReplayEvents.LOADED, { totalCandles: candles.length });
    this.emit(ReplayEvents.STATE_CHANGED, this.getState());
    return this.getState();
  }

  start(startIndex) {
    const check = this._checkGuards('start', { startIndex });
    if (!check.allowed) {
      return this.getState();
    }
    if (this._candles.length === 0) throw new Error('No candles loaded');
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= this._candles.length) {
      throw new Error(`Invalid startIndex: ${startIndex}`);
    }
    this._clearTimer();
    this._state.startIndex = startIndex;
    this._state.currentIndex = startIndex;
    // If starting at last candle, immediately ended
    if (startIndex >= this._candles.length - 1) {
      this._state.status = ReplayStatus.ENDED;
    } else {
      this._state.status = ReplayStatus.PAUSED;
    }
    this._accum = 0;

    const candle = this._candles[startIndex];
    this.emit(ReplayEvents.STARTED, { index: startIndex, candle: this._cloneCandle(candle) });
    this._emitCandle(candle, startIndex);
    this.emit(ReplayEvents.STATE_CHANGED, this.getState());

    // If ended immediately, emit ended
    if (this._state.status === ReplayStatus.ENDED) {
      this.emit(ReplayEvents.ENDED, this.getState());
    }
    return this.getState();
  }

  play() {
    if (this._state.status === ReplayStatus.PLAYING) return this.getState(); // idempotent
    if (this._state.status === ReplayStatus.IDLE) throw new Error('Cannot play: no data. Call load() and start() first');
    if (this._state.status === ReplayStatus.READY) throw new Error('Cannot play: call start(index) first');
    if (this._state.status === ReplayStatus.ENDED) return this.getState(); // no progression after ended
    if (this._state.status !== ReplayStatus.PAUSED) return this.getState();

    if (this._state.currentIndex >= this._candles.length - 1) {
      this._state.status = ReplayStatus.ENDED;
      this.emit(ReplayEvents.ENDED, this.getState());
      this.emit(ReplayEvents.STATE_CHANGED, this.getState());
      return this.getState();
    }

    this._state.status = ReplayStatus.PLAYING;
    this.emit(ReplayEvents.PLAYED, this.getState());
    this.emit(ReplayEvents.STATE_CHANGED, this.getState());
    this._schedule();
    return this.getState();
  }

  pause() {
    if (this._state.status !== ReplayStatus.PLAYING) return this.getState();
    this._clearTimer();
    this._state.status = ReplayStatus.PAUSED;
    this.emit(ReplayEvents.PAUSED, this.getState());
    this.emit(ReplayEvents.STATE_CHANGED, this.getState());
    return this.getState();
  }

  toggle() {
    if (this._state.status === ReplayStatus.PLAYING) return this.pause();
    if (this._state.status === ReplayStatus.PAUSED) return this.play();
    return this.getState();
  }

  stepForward() {
    if (this._candles.length === 0) throw new Error('No candles loaded');
    if (this._state.status === ReplayStatus.IDLE || this._state.status === ReplayStatus.READY) {
      throw new Error('Cannot step: replay not started');
    }
    if (this._state.currentIndex >= this._candles.length - 1) {
      // already at end
      this._state.status = ReplayStatus.ENDED;
      this.emit(ReplayEvents.ENDED, this.getState());
      this.emit(ReplayEvents.STATE_CHANGED, this.getState());
      return this.getState();
    }
    this._state.currentIndex += 1;
    const candle = this._candles[this._state.currentIndex];
    this.emit(ReplayEvents.STEPPED, { index: this._state.currentIndex, candle: this._cloneCandle(candle) });
    this._emitCandle(candle, this._state.currentIndex);
    // Check if reached end
    if (this._state.currentIndex >= this._candles.length - 1) {
      this._clearTimer();
      this._state.status = ReplayStatus.ENDED;
      this.emit(ReplayEvents.ENDED, this.getState());
    }
    this.emit(ReplayEvents.STATE_CHANGED, this.getState());
    return this.getState();
  }

  seek(index) {
    const check = this._checkGuards('seek', { index });
    if (!check.allowed) {
      return this.getState();
    }
    if (this._candles.length === 0) throw new Error('No candles loaded');
    if (!Number.isInteger(index) || index < 0 || index >= this._candles.length) {
      throw new Error(`Invalid seek index: ${index}`);
    }
    // seeking is allowed in paused/playing/ended; will pause if playing
    const wasPlaying = this._state.status === ReplayStatus.PLAYING;
    if (wasPlaying) this._clearTimer();

    this._state.currentIndex = index;
    // if startIndex not set, set it? But seek after start. Keep startIndex.
    // Status logic: if at end => ended, else paused (even if was playing, pause after seek)
    if (index >= this._candles.length - 1) {
      this._state.status = ReplayStatus.ENDED;
    } else {
      this._state.status = ReplayStatus.PAUSED;
    }
    if (this._state.startIndex === -1) this._state.startIndex = index;

    const candle = this._candles[index];
    this.emit(ReplayEvents.SEEKED, { index, candle: this._cloneCandle(candle), visibleCandles: this.getVisibleCandles() });
    this._emitCandle(candle, index);
    this.emit(ReplayEvents.STATE_CHANGED, this.getState());
    if (this._state.status === ReplayStatus.ENDED) this.emit(ReplayEvents.ENDED, this.getState());
    return this.getState();
  }

  setSpeed(speed) {
    const s = Number(speed);
    if (!ALLOWED_SPEEDS.includes(s)) {
      throw new Error(`Invalid speed: ${speed}. Allowed: ${ALLOWED_SPEEDS.join(', ')}`);
    }
    const wasPlaying = this._state.status === ReplayStatus.PLAYING;
    if (wasPlaying) this._clearTimer();
    this._state.speed = s;
    this.emit(ReplayEvents.SPEED_CHANGED, { speed: s });
    this.emit(ReplayEvents.STATE_CHANGED, this.getState());
    if (wasPlaying) this._schedule();
    return this.getState();
  }

  stop() {
    this._clearTimer();
    this._state.status = this._candles.length > 0 ? ReplayStatus.READY : ReplayStatus.IDLE;
    this._state.currentIndex = -1;
    this._state.startIndex = -1;
    this._accum = 0;
    this.emit(ReplayEvents.STOPPED, this.getState());
    this.emit(ReplayEvents.STATE_CHANGED, this.getState());
    return this.getState();
  }

  reset() {
    const check = this._checkGuards('reset', {});
    if (!check.allowed) {
      return this.getState();
    }
    // Reset to startIndex if exists, otherwise to initial ready
    if (this._candles.length === 0) {
      return this.stop();
    }
    this._clearTimer();
    if (this._state.startIndex >= 0) {
      // Go back to startIndex
      this._state.currentIndex = this._state.startIndex;
      if (this._state.currentIndex >= this._candles.length - 1) {
        this._state.status = ReplayStatus.ENDED;
      } else {
        this._state.status = ReplayStatus.PAUSED;
      }
      // Emit RESET with visibleCandles for chart rebuild; do not emit duplicate SEEKED
      this.emit(ReplayEvents.RESET, { ...this.getState(), visibleCandles: this.getVisibleCandles(), index: this._state.currentIndex });
      this._emitCandle(this._candles[this._state.currentIndex], this._state.currentIndex);
      this.emit(ReplayEvents.STATE_CHANGED, this.getState());
      if (this._state.status === ReplayStatus.ENDED) this.emit(ReplayEvents.ENDED, this.getState());
    } else {
      // No start defined, go to READY
      this._state.status = ReplayStatus.READY;
      this._state.currentIndex = -1;
      this.emit(ReplayEvents.RESET, this.getState());
      this.emit(ReplayEvents.STATE_CHANGED, this.getState());
    }
    this._accum = 0;
    return this.getState();
  }

  getState() {
    return { ...this._state };
  }

  /**
   * Returns ONLY visible candles (0 .. currentIndex inclusive).
   * During replay, future candles are never exposed.
   * If not started (currentIndex -1), returns empty array.
   */
  getVisibleCandles() {
    if (this._state.currentIndex < 0) return [];
    return this._candles.slice(0, this._state.currentIndex + 1).map(c => this._cloneCandle(c));
  }

  /**
   * Returns the current candle at cursor index or null.
   */
  getCurrentCandle() {
    if (this._state.currentIndex < 0 || this._state.currentIndex >= this._candles.length) return null;
    return this._cloneCandle(this._candles[this._state.currentIndex]);
  }

  /**
   * Returns visible index and time range metadata without cloning candle objects.
   */
  getVisibleRange() {
    if (this._state.currentIndex < 0) {
      return { fromIndex: -1, toIndex: -1, fromTime: null, toTime: null, count: 0 };
    }
    return {
      fromIndex: 0,
      toIndex: this._state.currentIndex,
      fromTime: this._candles[0]?.time ?? null,
      toTime: this._candles[this._state.currentIndex]?.time ?? null,
      count: this._state.currentIndex + 1,
    };
  }

  /**
   * Returns bounded window of up to `size` visible candles, avoiding O(N) full clones.
   */
  getVisibleWindow(size = 1000) {
    if (this._state.currentIndex < 0) return [];
    const from = Math.max(0, this._state.currentIndex - size + 1);
    return this._candles.slice(from, this._state.currentIndex + 1).map(c => this._cloneCandle(c));
  }

  /**
   * Returns context candles that existed prior to replay start (0 .. startIndex - 1).
   */
  getContextCandles() {
    if (this._state.startIndex <= 0) return [];
    return this._candles.slice(0, this._state.startIndex).map(c => this._cloneCandle(c));
  }

  /**
   * Returns candles revealed exclusively during replay progression (startIndex .. currentIndex).
   */
  getRevealedCandles() {
    if (this._state.startIndex < 0 || this._state.currentIndex < this._state.startIndex) return [];
    return this._candles.slice(this._state.startIndex, this._state.currentIndex + 1).map(c => this._cloneCandle(c));
  }

  /**
   * For internal/debug only: total candles count without exposing future via visible API.
   * Tests should verify future not exposed via getVisibleCandles.
   */
  getTotalCandles() {
    return this._candles.length;
  }

  // ---------- Private ----------

  _emitCandle(candle, index) {
    const cloned = this._cloneCandle(candle);
    const payload = {
      symbol: this._symbol || candle.symbol || null,
      candle: cloned,
      index,
      timestamp: cloned.time,
      replayState: this.getState()
    };
    this.emit(ReplayEvents.CANDLE, payload);
    this.emit(ReplayEvents.MARKET_CANDLE, payload);
  }

  _clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _schedule() {
    this._clearTimer();
    if (this._state.status !== ReplayStatus.PLAYING) return;

    // Use timeout loop. Interval = 1000ms / speed, but handle fractional cleanly via scheduler.
    // Instead of fixed interval per candle, compute delay = 1000 / speed.
    // For speeds <1, delay >1000 (e.g. 0.25x => 4000ms)
    const delayMs = 1000 / this._state.speed;

    this._timer = setTimeout(() => {
      this._timer = null;
      if (this._state.status !== ReplayStatus.PLAYING) return;
      // Advance one candle per tick. Since delay already accounts for speed, one step per tick is correct.
      if (this._state.currentIndex >= this._candles.length - 1) {
        this._state.status = ReplayStatus.ENDED;
        this.emit(ReplayEvents.ENDED, this.getState());
        this.emit(ReplayEvents.STATE_CHANGED, this.getState());
        return;
      }
      this._state.currentIndex += 1;
      const candle = this._candles[this._state.currentIndex];
      this.emit(ReplayEvents.STEPPED, { index: this._state.currentIndex, candle: this._cloneCandle(candle) });
      this._emitCandle(candle, this._state.currentIndex);

      if (this._state.currentIndex >= this._candles.length - 1) {
        this._state.status = ReplayStatus.ENDED;
        this.emit(ReplayEvents.ENDED, this.getState());
        this.emit(ReplayEvents.STATE_CHANGED, this.getState());
        return;
      }
      this.emit(ReplayEvents.STATE_CHANGED, this.getState());
      this._schedule();
    }, delayMs);
  }
}
