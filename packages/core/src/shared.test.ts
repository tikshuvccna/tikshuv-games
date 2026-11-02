import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SessionTimer, VOICE_IDS, createLoop, createRng, createScope, err, ok, sessionResume,
} from './index.js';

const MIN = 60_000;

describe('Scope', () => {
  it('disposes in reverse order, idempotently, including children', () => {
    const log: string[] = [];
    const s = createScope();
    s.add(() => log.push('a'));
    s.add(() => log.push('b'));
    const c = s.child();
    c.add(() => log.push('child'));
    s.dispose();
    s.dispose();
    expect(log).toEqual(['child', 'b', 'a']);
  });
  it('late add on a disposed scope runs immediately; child of disposed is disposed', () => {
    const s = createScope();
    s.dispose();
    const f = vi.fn();
    s.add(f);
    expect(f).toHaveBeenCalledTimes(1);
    const g = vi.fn();
    s.child().add(g);
    expect(g).toHaveBeenCalledTimes(1);
  });
  it('a throwing disposer does not block the rest; a disposed child leaves the parent', () => {
    const s = createScope();
    const ok1 = vi.fn();
    s.add(ok1);
    s.add(() => {
      throw new Error('x');
    });
    expect(() => s.dispose()).toThrow('x');
    expect(ok1).toHaveBeenCalled();
    const p = createScope();
    const k = p.child();
    const f = vi.fn();
    k.add(f);
    k.dispose();
    p.dispose();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('Rng', () => {
  it('matches the mulberry32 golden sequence', () => {
    const r = createRng(1);
    expect([r.next(), r.next(), r.next()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
    expect(createRng(42).shuffle([1, 2, 3, 4, 5, 6])).toEqual([2, 1, 5, 6, 3, 4]);
  });
  it('is deterministic; fork is order-independent and label-specific', () => {
    const a = createRng('seed');
    const b = createRng('seed');
    a.next();
    expect(a.fork('x').next()).toBe(b.fork('x').next());
    expect(b.fork('x').next()).not.toBe(b.fork('y').next());
    expect(createRng('a').fork('x').next()).toBe(0.23708467837423086);
  });
  it('int/pick/shuffle stay in range and do not mutate', () => {
    const r = createRng(7);
    for (let i = 0; i < 200; i++) {
      const n = r.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
    const src = [1, 2, 3, 4];
    expect([...r.shuffle(src)].sort()).toEqual([1, 2, 3, 4]);
    expect(src).toEqual([1, 2, 3, 4]);
    expect(src).toContain(r.pick(src));
    expect(() => r.pick([])).toThrow();
  });
});

describe('Loop', () => {
  function rig(hidden = false) {
    let t = 0;
    let cbs: Array<(t: number) => void> = [];
    let nextId = 1;
    const cancelled = new Set<number>();
    const ids: number[] = [];
    const handlers = new Set<() => void>();
    const doc = {
      hidden,
      addEventListener: (_: string, f: () => void) => void handlers.add(f),
      removeEventListener: (_: string, f: () => void) => void handlers.delete(f),
    };
    const frames: number[] = [];
    const loop = createLoop({
      onFrame: (dt) => frames.push(dt),
      raf: (cb) => {
        cbs.push(cb);
        ids.push(nextId);
        return nextId++;
      },
      caf: (id) => {
        const i = ids.indexOf(id);
        if (i >= 0) {
          cbs.splice(i, 1);
          ids.splice(i, 1);
        }
        cancelled.add(id);
      },
      now: () => t,
      doc,
    });
    return {
      loop, frames, doc, handlers,
      tick(dt: number) {
        t += dt;
        const run = cbs;
        cbs = [];
        ids.length = 0;
        run.forEach((c) => c(t));
      },
      advance(dt: number) { t += dt; },
      pending: () => cbs.length,
    };
  }
  it('runs frames with clamped dt and stops', () => {
    const r = rig();
    r.loop.start();
    expect(r.loop.running).toBe(true);
    r.tick(16);
    r.tick(500);
    expect(r.frames).toEqual([16, 100]);
    r.loop.stop();
    expect(r.loop.running).toBe(false);
    expect(r.pending()).toBe(0);
  });
  it('pauses while hidden and resumes without a dt spike', () => {
    const r = rig();
    r.loop.start();
    r.tick(16);
    r.doc.hidden = true;
    r.handlers.forEach((h) => h());
    expect(r.pending()).toBe(0);
    r.advance(60_000);
    r.doc.hidden = false;
    r.handlers.forEach((h) => h());
    r.tick(16);
    expect(r.frames).toEqual([16, 16]);
  });
  it('start while hidden waits; dispose detaches', () => {
    const r = rig(true);
    r.loop.start();
    expect(r.pending()).toBe(0);
    r.doc.hidden = false;
    r.handlers.forEach((h) => h());
    expect(r.pending()).toBe(1);
    r.loop.dispose();
    expect(r.handlers.size).toBe(0);
    expect(r.pending()).toBe(0);
  });
});

describe('types', () => {
  it('Result helpers and voice ids', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('x')).toEqual({ ok: false, error: 'x' });
    expect(VOICE_IDS).toHaveLength(6);
  });
});

describe('SessionTimer persistence and pausing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('snapshot then restore continues the same 12-minute cap (F5 does not reset)', () => {
    const t = new SessionTimer({ pauseWhenHidden: false });
    t.start();
    vi.advanceTimersByTime(7 * MIN);
    const snap = t.snapshot();
    expect(snap).toEqual({ elapsedMs: 7 * MIN, warned: false, ended: false });
    t.dispose();

    const t2 = new SessionTimer({ pauseWhenHidden: false, initialElapsedMs: snap.elapsedMs, warned: snap.warned });
    const w = vi.fn();
    const b = vi.fn();
    t2.on('warning', w);
    t2.on('blackout', b);
    t2.start();
    expect(t2.elapsed()).toBe(7 * MIN);
    vi.advanceTimersByTime(3 * MIN);
    expect(w).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2 * MIN);
    expect(b).toHaveBeenCalledTimes(1);
    expect(t2.snapshot()).toEqual({ elapsedMs: 12 * MIN, warned: true, ended: true });
  });

  it('a restored warned timer does not warn twice; a restored ended timer stays ended', () => {
    const t = new SessionTimer({ pauseWhenHidden: false, initialElapsedMs: 11 * MIN, warned: true });
    const w = vi.fn();
    t.on('warning', w);
    t.start();
    vi.advanceTimersByTime(MIN);
    expect(w).not.toHaveBeenCalled();
    const e = new SessionTimer({ pauseWhenHidden: false, initialElapsedMs: 12 * MIN, warned: true, ended: true });
    e.start();
    expect(e.phase).toBe('ended');
  });

  it('sessionResume: continues inside 30 min of inactivity, starts fresh after', () => {
    const now = Date.parse('2026-11-02T12:00:00Z');
    const saved = { elapsedMs: 5 * MIN, warned: false, lastActiveAt: '2026-11-02T11:45:00Z' };
    expect(sessionResume(saved, now)).toEqual({ initialElapsedMs: 5 * MIN, warned: false, ended: false });
    expect(sessionResume({ ...saved, lastActiveAt: '2026-11-02T11:30:00Z' }, now)).toEqual({});
    expect(sessionResume(undefined, now)).toEqual({});
    expect(sessionResume({ elapsedMs: 1, warned: true, ended: true }, now)).toEqual({ initialElapsedMs: 1, warned: true, ended: true });
  });

  it('pause reasons: hidden then visible does not un-pause a menu pause', () => {
    const doc = new EventTarget() as EventTarget & { hidden: boolean };
    doc.hidden = false;
    vi.stubGlobal('document', doc);
    const t = new SessionTimer();
    t.start();
    vi.advanceTimersByTime(MIN);
    t.pause('menu');
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(5 * MIN);
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(t.phase).toBe('paused');
    vi.advanceTimersByTime(5 * MIN);
    expect(t.elapsed()).toBe(MIN);
    t.resume('menu');
    expect(t.phase).toBe('running');
    vi.advanceTimersByTime(MIN);
    expect(t.elapsed()).toBe(2 * MIN);
    t.dispose();
  });

  it('pauses automatically when hidden by default', () => {
    const doc = new EventTarget() as EventTarget & { hidden: boolean };
    doc.hidden = false;
    vi.stubGlobal('document', doc);
    const t = new SessionTimer();
    t.start();
    vi.advanceTimersByTime(MIN);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(20 * MIN);
    expect(t.elapsed()).toBe(MIN);
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(MIN);
    expect(t.elapsed()).toBe(2 * MIN);
    t.dispose();
  });

  it('a timer started while hidden does not count that time', () => {
    const doc = new EventTarget() as EventTarget & { hidden: boolean };
    doc.hidden = true;
    vi.stubGlobal('document', doc);
    const t = new SessionTimer();
    t.start();
    vi.advanceTimersByTime(5 * MIN);
    expect(t.elapsed()).toBe(0);
    expect(t.phase).toBe('paused');
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(MIN);
    expect(t.elapsed()).toBe(MIN);
    t.dispose();
  });

  it('machine sleep: a tick gap over 60 s is not play time (no instant blackout)', () => {
    let now = 0;
    const clock = { now: () => now };
    const t = new SessionTimer({ clock, pauseWhenHidden: false });
    const b = vi.fn();
    t.on('blackout', b);
    t.start();
    vi.advanceTimersByTime(5 * MIN); // timers run but our clock stands still: emulate by stepping now
    now = 5 * MIN;
    // heartbeat ticks saw now=0 for 5 min of timer time, so the first sync after reading sees a 5 min gap
    expect(t.elapsed()).toBe(0);
    expect(b).not.toHaveBeenCalled();
    // sleep: clock jumps 2 hours with no timers firing
    now += 120 * MIN;
    expect(t.elapsed()).toBe(0);
    now += 30_000;
    expect(t.elapsed()).toBe(30_000);
  });

  it('negative clock jump is absorbed', () => {
    let now = 10_000;
    const t = new SessionTimer({ clock: { now: () => now }, pauseWhenHidden: false });
    t.start();
    now += 2000;
    expect(t.elapsed()).toBe(2000);
    now -= 100_000;
    expect(t.elapsed()).toBe(2000);
  });

  it('setConfig lowering the cap below elapsed blacks out at once', () => {
    const t = new SessionTimer({ pauseWhenHidden: false });
    const b = vi.fn();
    t.on('blackout', b);
    t.start();
    vi.advanceTimersByTime(5 * MIN);
    t.setConfig({ capMs: 3 * MIN });
    vi.advanceTimersByTime(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(t.phase).toBe('ended');
  });

  it('M1: a custom cap derives the warning 2 min before; extend() revives and shifts', () => {
    const t = new SessionTimer({ capMs: 8 * MIN, pauseWhenHidden: false });
    const w = vi.fn();
    const b = vi.fn();
    t.on('warning', w);
    t.on('blackout', b);
    t.start();
    vi.advanceTimersByTime(6 * MIN);
    expect(w).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2 * MIN);
    expect(b).toHaveBeenCalledTimes(1);
    t.extend(5 * MIN); // teacher mode
    expect(t.phase).toBe('running');
    expect(t.remaining()).toBe(5 * MIN);
    vi.advanceTimersByTime(5 * MIN);
    expect(b).toHaveBeenCalledTimes(2);
    expect(new SessionTimer({ capMs: null, pauseWhenHidden: false }).remaining()).toBeNull();
    const k = new SessionTimer({ capMs: null, pauseWhenHidden: false });
    k.extend(MIN);
    expect(k.remaining()).toBeNull();
  });

  it('extend while running re-arms; extend on an ended timer that is still over the cap stays ended', () => {
    const t = new SessionTimer({ pauseWhenHidden: false });
    const b = vi.fn();
    t.on('blackout', b);
    t.start();
    vi.advanceTimersByTime(9 * MIN);
    t.extend(MIN);
    vi.advanceTimersByTime(2 * MIN);
    expect(b).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2 * MIN);
    expect(b).toHaveBeenCalledTimes(1);
    t.extend(-2 * MIN);
    expect(t.phase).toBe('ended');
  });

  it('hard resume() clears every pause reason; pause before start is honoured', () => {
    const t = new SessionTimer({ pauseWhenHidden: false });
    t.pause('cutscene');
    t.start();
    expect(t.phase).toBe('paused');
    vi.advanceTimersByTime(MIN);
    expect(t.elapsed()).toBe(0);
    t.resume();
    vi.advanceTimersByTime(MIN);
    expect(t.elapsed()).toBe(MIN);
    t.reset();
    expect(t.phase).toBe('idle');
  });
});
