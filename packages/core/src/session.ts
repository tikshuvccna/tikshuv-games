import { EventBus } from './bus.js';
import { schedule, systemClock, type Clock, type Scheduled } from './scheduler.js';
import type { Ms, Unsubscribe } from './index.js';

const MIN = 60_000;
/** A tick gap longer than this means the machine slept or the clock jumped: that time is not play time. */
const MAX_GAP_MS = 60_000;
const HEARTBEAT_MS = 1000;
/** Spec 01 section 3.7: a new session starts after this much inactivity. */
export const SESSION_IDLE_RESET_MS = 30 * MIN;

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
export type PauseReason = 'menu' | 'hidden' | 'cutscene';

export interface SessionEvents {
  warning: { elapsedMs: Ms; remainingMs: Ms };
  blackout: { elapsedMs: Ms };
}

/** Serialisable state; the game persists it to save.session (on warning, blackout, hidden, every 15 s). */
export interface SessionSnapshot {
  elapsedMs: Ms;
  warned: boolean;
  ended: boolean;
}

export interface SessionTimerOptions extends Partial<SessionConfig> {
  clock?: Clock;
  /** Auto pause/resume on document visibilitychange (browser only). Default true. */
  pauseWhenHidden?: boolean;
  /** restore after a reload (see sessionResume) */
  initialElapsedMs?: Ms;
  warned?: boolean;
  ended?: boolean;
}

/**
 * Decide whether a saved session continues or a new one starts (idle >= 30 min).
 * `nowEpochMs` is wall-clock (Date.now()); `lastActiveAt` is the ISO string stored in save.session.
 */
export function sessionResume(
  saved: { elapsedMs: Ms; warned?: boolean; ended?: boolean; lastActiveAt?: string | undefined } | undefined,
  nowEpochMs: number,
): Pick<SessionTimerOptions, 'initialElapsedMs' | 'warned' | 'ended'> {
  if (!saved) return {};
  const last = saved.lastActiveAt ? Date.parse(saved.lastActiveAt) : Number.NaN;
  if (Number.isFinite(last) && nowEpochMs - last >= SESSION_IDLE_RESET_MS) return {};
  return { initialElapsedMs: saved.elapsedMs, warned: !!saved.warned, ended: !!saved.ended };
}

export class SessionTimer {
  private cfg: SessionConfig;
  private clock: Clock;
  private bus = new EventBus<SessionEvents>();
  private accumulated: Ms;
  private startedAt: Ms | null = null; // non-null while counting
  private lastTick: Ms = 0;
  private began = false;
  private warned: boolean;
  private ended: boolean;
  private reasons = new Set<PauseReason>();
  private timers: Scheduled[] = [];
  private visOff: Unsubscribe | undefined;

  constructor(opts: SessionTimerOptions = {}) {
    const cap = opts.capMs !== undefined ? opts.capMs : SESSION_DEFAULTS.capMs;
    this.cfg = {
      capMs: cap,
      // M1: a custom cap without an explicit warning warns 2 min before it.
      warnAtMs:
        opts.warnAtMs !== undefined
          ? opts.warnAtMs
          : opts.capMs !== undefined
            ? cap === null ? null : Math.max(0, cap - 2 * MIN)
            : SESSION_DEFAULTS.warnAtMs,
    };
    this.clock = opts.clock ?? systemClock;
    this.accumulated = Math.max(0, opts.initialElapsedMs ?? 0);
    this.warned = !!opts.warned;
    this.ended = !!opts.ended;
    if (opts.pauseWhenHidden !== false && typeof document !== 'undefined') {
      const h = () => (document.hidden ? this.pause('hidden') : this.resume('hidden'));
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

  /** Drop time that passed while timers were frozen (sleep) or the clock jumped. Returns true if it shifted. */
  private sync(): boolean {
    if (this.startedAt === null) return false;
    const now = this.clock.now();
    const gap = now - this.lastTick;
    this.lastTick = now;
    if (gap > MAX_GAP_MS || gap < 0) {
      this.startedAt += gap;
      return true;
    }
    return false;
  }

  elapsed(): Ms {
    this.sync();
    return this.accumulated + (this.startedAt === null ? 0 : this.clock.now() - this.startedAt);
  }

  remaining(): Ms | null {
    return this.cfg.capMs === null ? null : Math.max(0, this.cfg.capMs - this.elapsed());
  }

  snapshot(): SessionSnapshot {
    return { elapsedMs: this.elapsed(), warned: this.warned, ended: this.ended };
  }

  start(): void {
    if (this.began || this.ended) return;
    this.began = true;
    // M1: a timer started while the tab is hidden must not count that time
    if (this.visOff && typeof document !== 'undefined' && document.hidden) this.reasons.add('hidden');
    this.count();
  }

  private count(): void {
    if (this.reasons.size > 0 || this.startedAt !== null) return;
    this.startedAt = this.clock.now();
    this.lastTick = this.startedAt;
    this.arm();
  }

  pause(reason: PauseReason = 'menu'): void {
    this.reasons.add(reason);
    this.halt();
  }

  private halt(): void {
    if (this.startedAt === null) return;
    this.accumulated = this.elapsed();
    this.startedAt = null;
    this.disarm();
  }

  /**
   * Remove one pause reason; counting restarts only when none remain, so returning to a
   * hidden-then-visible tab does not un-pause a menu. Without a reason, clears every reason.
   */
  resume(reason?: PauseReason): void {
    if (reason === undefined) this.reasons.clear();
    else this.reasons.delete(reason);
    if (!this.began || this.ended) return;
    this.count();
  }

  /** Teacher mode: add time to the cap (and warning). Also revives a session that already ended. */
  extend(ms: Ms): void {
    const { capMs, warnAtMs } = this.cfg;
    this.cfg = { capMs: capMs === null ? null : capMs + ms, warnAtMs: warnAtMs === null ? null : warnAtMs + ms };
    if (this.ended) {
      if (this.cfg.capMs !== null && this.cfg.capMs <= this.accumulated) return;
      this.ended = false;
      this.warned = this.cfg.warnAtMs !== null && this.accumulated >= this.cfg.warnAtMs;
      this.count();
    } else if (this.startedAt !== null) {
      this.arm();
    }
  }

  /** Back to idle with zero elapsed; listeners are kept. */
  reset(): void {
    this.disarm();
    this.accumulated = 0;
    this.startedAt = null;
    this.reasons.clear();
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
    this.timers.push(schedule(HEARTBEAT_MS, () => this.beat()));
  }

  /** 1 Hz heartbeat: lets sync() notice a sleep or clock jump even when nobody reads elapsed(). */
  private beat(): void {
    if (this.startedAt === null) return;
    this.sync();
    this.arm();
  }

  private fireWarning(): void {
    if (this.warned || this.ended) return;
    const { warnAtMs } = this.cfg;
    if (warnAtMs !== null && this.elapsed() < warnAtMs) return this.arm(); // fired early after a sleep
    this.warned = true;
    this.bus.emit('warning', { elapsedMs: this.elapsed(), remainingMs: this.remaining() ?? 0 });
  }

  private fireBlackout(): void {
    if (this.ended) return;
    const { capMs } = this.cfg;
    if (capMs !== null && this.elapsed() < capMs) return this.arm();
    this.ended = true;
    const elapsedMs = this.elapsed();
    this.halt();
    this.bus.emit('blackout', { elapsedMs });
  }
}
