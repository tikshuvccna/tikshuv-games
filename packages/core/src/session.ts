import { EventBus } from './bus.js';
import { schedule, systemClock, type Clock, type Scheduled } from './scheduler.js';
import type { Ms, Unsubscribe } from './index.js';

const MIN = 60_000;

export interface SessionConfig {
  /** Blackout time. null = off (never fires). Default 12 min (D7). */
  capMs: Ms | null;
  /** Warning time. null = no warning. Default 10 min. */
  warnAtMs: Ms | null;
}

export const SESSION_DEFAULTS: SessionConfig = { capMs: 12 * MIN, warnAtMs: 10 * MIN };

/** Presets: caps warn 2 min before; 'off' disables. */
export type SessionPreset = 10 | 12 | 15 | 'off';
export function sessionPreset(p: SessionPreset): SessionConfig {
  if (p === 'off') return { capMs: null, warnAtMs: null };
  return { capMs: p * MIN, warnAtMs: (p - 2) * MIN };
}

export type SessionPhase = 'idle' | 'running' | 'paused' | 'warned' | 'ended';

export interface SessionEvents {
  warning: { elapsedMs: Ms; remainingMs: Ms };
  blackout: { elapsedMs: Ms };
}

export interface SessionTimerOptions extends Partial<SessionConfig> {
  clock?: Clock;
  /** Auto pause/resume on document visibilitychange (browser only). Default false. */
  pauseWhenHidden?: boolean;
}

export class SessionTimer {
  private cfg: SessionConfig;
  private clock: Clock;
  private bus = new EventBus<SessionEvents>();
  private accumulated: Ms = 0;
  private startedAt: Ms | null = null; // non-null while counting
  private began = false;
  private warned = false;
  private ended = false;
  private timers: Scheduled[] = [];
  private visOff: Unsubscribe | undefined;

  constructor(opts: SessionTimerOptions = {}) {
    this.cfg = {
      capMs: opts.capMs !== undefined ? opts.capMs : SESSION_DEFAULTS.capMs,
      warnAtMs: opts.warnAtMs !== undefined ? opts.warnAtMs : SESSION_DEFAULTS.warnAtMs,
    };
    this.clock = opts.clock ?? systemClock;
    if (opts.pauseWhenHidden && typeof document !== 'undefined') {
      const h = () => (document.hidden ? this.pause() : this.resume());
      document.addEventListener('visibilitychange', h);
      this.visOff = () => document.removeEventListener('visibilitychange', h);
    }
  }

  get phase(): SessionPhase {
    if (this.ended) return 'ended';
    if (!this.began) return 'idle';
    if (this.startedAt === null) return 'paused';
    return this.warned ? 'warned' : 'running';
  }

  on<K extends keyof SessionEvents>(type: K, fn: (p: SessionEvents[K]) => void): Unsubscribe {
    return this.bus.on(type, fn);
  }

  elapsed(): Ms {
    return this.accumulated + (this.startedAt === null ? 0 : this.clock.now() - this.startedAt);
  }

  remaining(): Ms | null {
    return this.cfg.capMs === null ? null : Math.max(0, this.cfg.capMs - this.elapsed());
  }

  start(): void {
    if (this.began || this.ended) return;
    this.began = true;
    this.startedAt = this.clock.now();
    this.arm();
  }

  pause(): void {
    if (this.startedAt === null) return;
    this.accumulated = this.elapsed();
    this.startedAt = null;
    this.disarm();
  }

  resume(): void {
    if (!this.began || this.ended || this.startedAt !== null) return;
    this.startedAt = this.clock.now();
    this.arm();
  }

  /** Back to idle with zero elapsed; listeners are kept. */
  reset(): void {
    this.disarm();
    this.accumulated = 0;
    this.startedAt = null;
    this.began = this.warned = this.ended = false;
  }

  setConfig(c: Partial<SessionConfig>): void {
    this.cfg = { ...this.cfg, ...c };
    if (this.startedAt !== null) this.arm();
  }

  dispose(): void {
    this.disarm();
    this.visOff?.();
    this.bus.clear();
  }

  private disarm(): void {
    this.timers.forEach((t) => t.cancel());
    this.timers = [];
  }

  private arm(): void {
    this.disarm();
    const { capMs, warnAtMs } = this.cfg;
    const el = this.elapsed();
    if (warnAtMs !== null && !this.warned && !(capMs !== null && warnAtMs >= capMs)) {
      this.timers.push(schedule(warnAtMs - el, () => this.fireWarning()));
    }
    if (capMs !== null) this.timers.push(schedule(capMs - el, () => this.fireBlackout()));
  }

  private fireWarning(): void {
    if (this.warned || this.ended) return;
    this.warned = true;
    this.bus.emit('warning', { elapsedMs: this.elapsed(), remainingMs: this.remaining() ?? 0 });
  }

  private fireBlackout(): void {
    if (this.ended) return;
    this.ended = true;
    const elapsedMs = this.elapsed();
    this.pause();
    this.bus.emit('blackout', { elapsedMs });
  }
}
