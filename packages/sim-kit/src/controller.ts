/** Headless, deterministic playback controller. No DOM; time comes from an injectable clock. */

export interface Clock {
  /** Schedule `cb` for the next tick; it receives a monotonic timestamp in ms. Returns a handle. */
  request(cb: (nowMs: number) => void): number;
  cancel(handle: number): void;
}

export type SimSpeed = 0.5 | 1 | 2;
export const SIM_SPEEDS: readonly SimSpeed[] = [0.5, 1, 2];

export interface PlaybackState {
  /** Virtual time in ms, 0..totalMs. */
  timeMs: number;
  totalMs: number;
  /** Step (event) index. */
  index: number;
  stepCount: number;
  /** Progress inside the current step, 0..1. Always 1 under reduced motion (no tween). */
  progress: number;
  playing: boolean;
  speed: SimSpeed;
  ended: boolean;
}

export interface PlaybackOptions {
  /** Nominal duration of each step at speed 1. */
  durations: readonly number[];
  clock: Clock;
  reducedMotion?: boolean;
  speed?: SimSpeed;
}

export class PlaybackController {
  private readonly starts: number[] = [];
  private readonly total: number;
  private readonly clock: Clock;
  private readonly reduced: boolean;
  private readonly durations: readonly number[];
  private time = 0;
  private speed: SimSpeed;
  private playing = false;
  private handle: number | null = null;
  private last: number | null = null;
  private lastIndex = 0;
  private endedFired = false;
  private readonly subs = new Set<(s: PlaybackState) => void>();
  private readonly stepSubs = new Set<(i: number) => void>();
  private readonly endSubs = new Set<() => void>();

  constructor(o: PlaybackOptions) {
    this.durations = o.durations.map((d) => Math.max(1, d));
    let acc = 0;
    for (const d of this.durations) {
      this.starts.push(acc);
      acc += d;
    }
    this.total = acc;
    this.clock = o.clock;
    this.reduced = o.reducedMotion ?? false;
    this.speed = o.speed ?? 1;
  }

  get stepCount(): number {
    return this.durations.length;
  }
  get stepIndex(): number {
    return this.indexAt(this.time);
  }

  private indexAt(t: number): number {
    const n = this.durations.length;
    if (n === 0) return 0;
    if (t >= this.total) return n - 1;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.starts[mid] ?? 0) <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  getState(): PlaybackState {
    const index = this.indexAt(this.time);
    const ended = this.total > 0 && this.time >= this.total;
    const start = this.starts[index] ?? 0;
    const dur = this.durations[index] ?? 1;
    const raw = this.durations.length === 0 ? 1 : Math.min(1, Math.max(0, (this.time - start) / dur));
    return {
      timeMs: this.time,
      totalMs: this.total,
      index,
      stepCount: this.durations.length,
      progress: this.reduced || ended ? 1 : raw,
      playing: this.playing,
      speed: this.speed,
      ended,
    };
  }

  subscribe(fn: (s: PlaybackState) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  onStep(cb: (i: number) => void): () => void {
    this.stepSubs.add(cb);
    return () => this.stepSubs.delete(cb);
  }
  onEnd(cb: () => void): () => void {
    this.endSubs.add(cb);
    return () => this.endSubs.delete(cb);
  }

  play(): void {
    if (this.playing || this.durations.length === 0) return;
    if (this.time >= this.total) this.time = 0;
    this.playing = true;
    this.endedFired = false;
    this.last = null;
    this.schedule();
    this.emit();
  }
  pause(): void {
    if (!this.playing) return;
    this.halt();
    this.emit();
  }
  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }
  /** Back to the very start, paused. */
  restart(): void {
    this.halt();
    this.endedFired = false;
    this.time = 0;
    this.emit();
  }
  setSpeed(s: SimSpeed): void {
    this.speed = s;
    this.emit();
  }
  seekTime(ms: number): void {
    this.halt();
    this.time = Math.min(this.total, Math.max(0, ms));
    this.endedFired = this.time >= this.total;
    this.emit();
  }
  /** Idempotent jump to the start of step i; pauses. */
  stepTo(i: number): void {
    const n = this.durations.length;
    if (n === 0) return;
    const c = Math.min(n - 1, Math.max(0, Math.trunc(i)));
    this.seekTime(this.starts[c] ?? 0);
  }
  stepForward(): void {
    const n = this.durations.length;
    if (n === 0) return;
    const i = this.indexAt(this.time);
    if (i >= n - 1) this.seekTime(this.total);
    else this.stepTo(i + 1);
  }
  stepBack(): void {
    if (this.durations.length === 0) return;
    const i = this.indexAt(this.time);
    if (this.time >= this.total) this.stepTo(i);
    else this.stepTo(i - 1);
  }
  destroy(): void {
    this.halt();
    this.subs.clear();
    this.stepSubs.clear();
    this.endSubs.clear();
  }

  private halt(): void {
    this.playing = false;
    if (this.handle !== null) this.clock.cancel(this.handle);
    this.handle = null;
    this.last = null;
  }
  private schedule(): void {
    this.handle = this.clock.request((now) => this.tick(now));
  }
  private tick(now: number): void {
    this.handle = null;
    if (!this.playing) return;
    const dt = this.last === null ? 0 : Math.max(0, now - this.last);
    this.last = now;
    this.time = Math.min(this.total, this.time + dt * this.speed);
    if (this.time >= this.total) {
      this.halt();
      this.emit();
      return;
    }
    this.schedule();
    this.emit();
  }
  private emit(): void {
    const s = this.getState();
    if (s.index !== this.lastIndex) {
      this.lastIndex = s.index;
      for (const cb of [...this.stepSubs]) cb(s.index);
    }
    for (const fn of [...this.subs]) fn(s);
    if (s.ended && !this.endedFired) {
      this.endedFired = true;
      for (const cb of [...this.endSubs]) cb();
    }
  }
}

/** Deterministic clock for tests and headless use: time moves only through advance(). */
export interface ManualClock extends Clock {
  now(): number;
  advance(ms: number): void;
}

export function createManualClock(): ManualClock {
  let now = 0;
  let next = 1;
  const pending = new Map<number, (n: number) => void>();
  return {
    now: () => now,
    request(cb) {
      const id = next++;
      pending.set(id, cb);
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
    advance(ms) {
      now += ms;
      const cbs = [...pending.entries()];
      pending.clear();
      for (const [, cb] of cbs) cb(now);
    },
  };
}

export function createRafClock(): Clock {
  return {
    request: (cb) => requestAnimationFrame((t) => cb(t)),
    cancel: (h) => cancelAnimationFrame(h),
  };
}
