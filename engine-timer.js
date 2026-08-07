/**
 * Two timers with different jobs:
 *   - Stopwatch measures how long a student spent on one question. It
 *     pauses when the tab is hidden, so walking away does not pollute
 *     the average-time statistic.
 *   - Countdown drives timed mode.
 */

export class Stopwatch {
  constructor() { this.reset(); this._bindVisibility(); }

  reset() {
    this.elapsed = 0;
    this.startedAt = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.startedAt = performance.now();
    this.running = true;
  }

  pause() {
    if (!this.running) return;
    this.elapsed += performance.now() - this.startedAt;
    this.running = false;
  }

  /** Milliseconds of *attentive* time. */
  read() {
    return Math.round(this.elapsed + (this.running ? performance.now() - this.startedAt : 0));
  }

  stop() { this.pause(); const ms = this.read(); this.reset(); return ms; }

  _bindVisibility() {
    this._onVisibility = () => {
      if (document.hidden) this.pause();
      else if (this.startedAt !== null) this.start();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  destroy() { document.removeEventListener('visibilitychange', this._onVisibility); }
}

export class Countdown {
  /**
   * @param {number} seconds
   * @param {{onTick?:(s:number)=>void, onExpire?:()=>void}} handlers
   */
  constructor(seconds, { onTick, onExpire } = {}) {
    this.total = seconds;
    this.remaining = seconds;
    this.onTick = onTick;
    this.onExpire = onExpire;
    this._interval = null;
  }

  start() {
    this.stop();
    this._deadline = Date.now() + this.remaining * 1000;
    this._interval = setInterval(() => {
      this.remaining = Math.max(0, Math.round((this._deadline - Date.now()) / 1000));
      this.onTick?.(this.remaining);
      if (this.remaining <= 0) { this.stop(); this.onExpire?.(); }
    }, 250);
    this.onTick?.(this.remaining);
  }

  pause() {
    if (!this._interval) return;
    clearInterval(this._interval);
    this._interval = null;
    this.remaining = Math.max(0, Math.round((this._deadline - Date.now()) / 1000));
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
    this._interval = null;
  }

  reset(seconds = this.total) {
    this.stop();
    this.remaining = seconds;
    this.onTick?.(this.remaining);
  }

  /** 'normal' | 'warning' | 'danger' — drives the timer pill colour. */
  get state() {
    const ratio = this.remaining / this.total;
    if (ratio <= 0.1) return 'danger';
    if (ratio <= 0.25) return 'warning';
    return 'normal';
  }
}

export const formatClock = (seconds) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
