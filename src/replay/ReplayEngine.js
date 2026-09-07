import { EventEmitter } from '../core/EventEmitter.js';
import { CandleValidator } from '../data/CandleValidator.js';
import { ReplayEvents } from './ReplayEvents.js';
import { ReplayStatus, ALLOWED_SPEEDS, createInitialState } from './ReplayState.js';
import { logger } from '../core/Logger.js';

/**
 * ReplayEngine - completely independent from DOM / Chart.
 *
 * Speed semantics: 1x = 1 candle per second, 2x = 2 candles per second, etc.
 * Scheduler uses one controlled timeout loop. destroy() provides an explicit
 * lifecycle boundary for SPA/page teardown and removes all subscriptions.
 */
export class ReplayEngine extends EventEmitter {
  constructor() {
    super();
    this._candles = [];
    this._symbol = null;
    this._actionGuards = [];
    this._state = createInitialState();
    this._timer = null;
    this._lastTick = null;
    this._accum = 0;
    this._destroyed = false;
  }

  _assertAlive() {
    if (this._destroyed) throw new Error('ReplayEngine has been destroyed');
  }

  registerActionGuard(guardFn) {
    this._assertAlive();
    if (typeof guardFn !== 'function') throw new Error('guardFn must be a function');
    this._actionGuards.push(guardFn);
    return () => {
      this._actionGuards = this._actionGuards.filter((g) => g !== guardFn);
    };
  }

  _checkGuards(action, payload) {
    for (const guard of this._actionGuards) {
      try {
        const res = guard(action, payload);
        if (res && res.allowed === false) return res;
      } catch (err) {
        return { allowed: false, reason: err.message };
      }
    }
    return { allowed: true };
  }

  setSymbol(symbol) {
    this._assertAlive();
    this._symbol = symbol;
  }

  getSymbol() {
    return this._symbol;
  }

  _cloneCandle(c) {
    return {
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    };
  }

  load(candles, meta = {}) {
    this._assertAlive();
    const opts = typeof meta === 'string' ? { symbol: meta } : (meta ?? {});
    const symbol = opts.symbol ?? null;
    const check = this._checkGuards('load', { candles, symbol });
    if (!check.allowed) return this.getState();
    this._clearTimer();
    if (!Array.isArray(candles) || candles.length === 0) throw new Error('load: candles must be a non-empty array');

    let prev = null;
    for (let i = 0; i < candles.length; i += 1) {
      const res = CandleValidator.validate(candles[i], prev);
      if (!res.valid) {
        logger.warn(`Invalid candle at index ${i}: ${res.reason}`);
        throw new Error(`Invalid candle at index ${i}: ${res.reason}`);
      }
      prev = candles[i].time;
    }

    this._candles = candles.map((c) => Object.freeze(this._cloneCandle(c)));
    this._symbol = symbol || candles[0]?.symbol || this._symbol || null;
    this._state = {
      ...createInitialState(),
      status: ReplayStatus.READY,
      totalCandles: candles.length,
      currentIndex: -1,
      startIndex: -1,
      speed: this._state.speed || 1,
    };
    this._accum = 0;
    this.emit(ReplayEvents.LOADED, { totalCandles: candles.length });
    this.emit(ReplayEvents.STATE_CHANGED, this.getState());
    return this.getState();
  }

  start(startIndex) {
    this._assertAlive();
    const check = this._checkGuards('start', { startIndex });
    if (!check.allowed) return this.getState();
    if (!this._candles.length) throw new Error('No candles loaded');
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= this._candles.length) {
      throw new Error(`Invalid startIndex: ${startIndex}`);
    }
    this._clearTimer();
    this._state.startIndex = startIndex;
    this._state.currentIndex = startIndex;
    this._state.status = startIndex >= this._candles.length - 1 ? ReplayStatus.ENDED : ReplayStatus.PAUSED;
    this._accum = 0;
    const candle = this._candles[startIndex];
    this.emit(ReplayEvents.STARTED, { index: startIndex, candle: this._cloneCandle(candle) });
    this._emitCandle(candle, startIndex, true);
    this.emit(ReplayEvents.STATE_CHANGED, this.getState());
    if (this._state.status === ReplayStatus.ENDED) this.emit(ReplayEvents.ENDED, this.getState());
    return this.getState();
  }

  play() {
    this._assertAlive();
    if (this._state.status === ReplayStatus.PLAYING) return this.getState();
    if (this._state.status === ReplayStatus.IDLE) throw new Error('Cannot play: no data. Call load() and start() first');
    if (this._state.status === ReplayStatus.READY) throw new Error('Cannot play: call start(index) first');
    if (this._state.status === ReplayStatus.ENDED) return this.getState();
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
    this._assertAlive();
    if (this._state.status !== ReplayStatus.PLAYING) return this.getState();
    this._clearTimer();
    this._state.status = ReplayStatus.PAUSED;
    this.emit(ReplayEvents.PAUSED, this.getState());
    this.emit(ReplayEvents.STATE_CHANGED, this.getState());
    return this.getState();
  }

  toggle() {
    this._assertAlive();
    if (this._state.status === ReplayStatus.PLAYING) return this.pause();
    if (this._state.status === ReplayStatus.PAUSED) return this.play();
    return this.getState();
  }

  stepForward() {
    this._assertAlive();
    if (!this._candles.length) throw new Error('No candles loaded');
    if (this._state.status === ReplayStatus.IDLE || this._state.status === ReplayStatus.READY) throw new Error('Cannot step: replay not started');
    if (this._state.currentIndex >= this._candles.length - 1) {
      this._state.status = ReplayStatus.ENDED;
      this.emit(ReplayEvents.ENDED, this.getState());
      this.emit(ReplayEvents.STATE_CHANGED, this.getState());
      return this.getState();
    }
    this._state.currentIndex += 1;
    const candle = this._candles[this._state.currentIndex];
    this.emit(ReplayEvents.STEPPED, { index: this._state.currentIndex, candle: this._cloneCandle(candle) });
    this._emitCandle(candle, this._state.currentIndex, true);
    if (this._state.currentIndex >= this._candles.length - 1) {
      this._clearTimer();
      this._state.status = ReplayStatus.ENDED;
      this.emit(ReplayEvents.ENDED, this.getState());
    }
    this.emit(ReplayEvents.STATE_CHANGED, this.getState());
    return this.getState();
  }

  step() {
    return this.stepForward();
  }

  stepCount(count = 1) {
    this._assertAlive();
    if (!Number.isInteger(count) || count < 0) throw new Error(`Invalid step count: ${count}. Must be a non-negative integer.`);
    let state = this.getState();
    for (let i = 0; i < count; i += 1) {
      if (this._state.status === ReplayStatus.ENDED) break;
      state = this.stepForward();
    }
    return state;
  }

  stepTo(targetIndex) {
    this._assertAlive();
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= this._candles.length) throw new Error(`Invalid targetIndex: ${targetIndex}`);
    if (targetIndex < this._state.currentIndex) throw new Error(`Cannot stepTo backwards (target: ${targetIndex}, current: ${this._state.currentIndex}). Use seek() for backwards navigation.`);
    let state = this.getState();
    while (this._state.currentIndex < targetIndex && this._state.status !== ReplayStatus.ENDED) state = this.stepForward();
    return state;
  }

  seek(index) {
    this._assertAlive();
    const check = this._checkGuards('seek', { index });
    if (!check.allowed) return this.getState();
    if (!this._candles.length) throw new Error('No candles loaded');
    if (!Number.isInteger(index) || index < 0 || index >= this._candles.length) throw new Error(`Invalid seek index: ${index}`);
    if (this._state.status === ReplayStatus.PLAYING) this._clearTimer();
    this._state.currentIndex = index;
    this._state.status = index >= this._candles.length - 1 ? ReplayStatus.ENDED : ReplayStatus.PAUSED;
    if (this._state.startIndex === -1) this._state.startIndex = index;
    const candle = this._candles[index];
    this.emit(ReplayEvents.SEEKED, { index, candle: this._cloneCandle(candle), visibleCandles: this.getVisibleCandles() });
    this.emit(ReplayEvents.STATE_CHANGED, this.getState());
    if (this._state.status === ReplayStatus.ENDED) this.emit(ReplayEvents.ENDED, this.getState());
    return this.getState();
  }

  setSpeed(speed) {
    this._assertAlive();
    const s = Number(speed);
    if (!ALLOWED_SPEEDS.includes(s)) throw new Error(`Invalid speed: ${speed}. Allowed: ${ALLOWED_SPEEDS.join(', ')}`);
    const wasPlaying = this._state.status === ReplayStatus.PLAYING;
    if (wasPlaying) this._clearTimer();
    this._state.speed = s;
    this.emit(ReplayEvents.SPEED_CHANGED, { speed: s });
    this.emit(ReplayEvents.STATE_CHANGED, this.getState());
    if (wasPlaying) this._schedule();
    return this.getState();
  }

  stop() {
    this._assertAlive();
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
    this._assertAlive();
    const check = this._checkGuards('reset', {});
    if (!check.allowed) return this.getState();
    if (!this._candles.length) return this.stop();
    this._clearTimer();
    if (this._state.startIndex >= 0) {
      this._state.currentIndex = this._state.startIndex;
      this._state.status = this._state.currentIndex >= this._candles.length - 1 ? ReplayStatus.ENDED : ReplayStatus.PAUSED;
      this.emit(ReplayEvents.RESET, {
        ...this.getState(),
        visibleCandles: this.getVisibleCandles(),
        index: this._state.currentIndex,
      });
      this.emit(ReplayEvents.STATE_CHANGED, this.getState());
      if (this._state.status === ReplayStatus.ENDED) this.emit(ReplayEvents.ENDED, this.getState());
    } else {
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

  getVisibleCandles() {
    if (this._state.currentIndex < 0) return [];
    return this._candles.slice(0, this._state.currentIndex + 1).map((c) => this._cloneCandle(c));
  }

  getCurrentCandle() {
    if (this._state.currentIndex < 0 || this._state.currentIndex >= this._candles.length) return null;
    return this._cloneCandle(this._candles[this._state.currentIndex]);
  }

  getVisibleRange() {
    if (this._state.currentIndex < 0) return { fromIndex: -1, toIndex: -1, fromTime: null, toTime: null, count: 0 };
    return {
      fromIndex: 0,
      toIndex: this._state.currentIndex,
      fromTime: this._candles[0]?.time ?? null,
      toTime: this._candles[this._state.currentIndex]?.time ?? null,
      count: this._state.currentIndex + 1,
    };
  }

  getVisibleWindow(size = 1000) {
    if (this._state.currentIndex < 0) return [];
    const from = Math.max(0, this._state.currentIndex - size + 1);
    return this._candles.slice(from, this._state.currentIndex + 1).map((c) => this._cloneCandle(c));
  }

  getContextCandles() {
    if (this._state.startIndex <= 0) return [];
    return this._candles.slice(0, this._state.startIndex).map((c) => this._cloneCandle(c));
  }

  getRevealedCandles() {
    if (this._state.startIndex < 0 || this._state.currentIndex < this._state.startIndex) return [];
    return this._candles.slice(this._state.startIndex, this._state.currentIndex + 1).map((c) => this._cloneCandle(c));
  }

  getTotalCandles() {
    return this._candles.length;
  }

  destroy() {
    if (this._destroyed) return;
    this._clearTimer();
    this._actionGuards.length = 0;
    this._candles = [];
    this._state = createInitialState();
    this._symbol = null;
    this._lastTick = null;
    this._accum = 0;
    this._destroyed = true;
    this.removeAllListeners();
  }

  _emitCandle(candle, index, execution = false) {
    const cloned = this._cloneCandle(candle);
    const payload = {
      symbol: this._symbol || candle.symbol || null,
      candle: cloned,
      index,
      timestamp: cloned.time,
      replayState: this.getState(),
    };
    this.emit(ReplayEvents.CANDLE, payload);
    if (execution) this.emit(ReplayEvents.MARKET_CANDLE, payload);
  }

  _clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _schedule() {
    this._clearTimer();
    if (this._state.status !== ReplayStatus.PLAYING || this._destroyed) return;
    const delayMs = 1000 / this._state.speed;
    this._timer = setTimeout(() => {
      this._timer = null;
      if (this._destroyed || this._state.status !== ReplayStatus.PLAYING) return;
      if (this._state.currentIndex >= this._candles.length - 1) {
        this._state.status = ReplayStatus.ENDED;
        this.emit(ReplayEvents.ENDED, this.getState());
        this.emit(ReplayEvents.STATE_CHANGED, this.getState());
        return;
      }
      this._state.currentIndex += 1;
      const candle = this._candles[this._state.currentIndex];
      this.emit(ReplayEvents.STEPPED, { index: this._state.currentIndex, candle: this._cloneCandle(candle) });
      this._emitCandle(candle, this._state.currentIndex, true);
      if (this._state.currentIndex >= this._candles.length - 1) {
        this._clearTimer();
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
