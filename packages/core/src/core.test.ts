import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus, SessionTimer, createFsm, schedule, sessionPreset } from './index.js';

const MIN = 60_000;
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('EventBus', () => {
  it('on/emit/unsubscribe/once', () => {
    const bus = new EventBus<{ a: number }>();
    const f = vi.fn();
    const g = vi.fn();
    const off = bus.on('a', f);
    bus.once('a', g);
    bus.emit('a', 1);
    off();
    bus.emit('a', 2);
    expect(f).toHaveBeenCalledTimes(1);
    expect(g).toHaveBeenCalledTimes(1);
    bus.on('a', f);
    bus.clear();
    bus.emit('a', 3);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('fsm', () => {
  it('transitions and ignores invalid events', () => {
    const log: string[] = [];
    const m = createFsm<'a' | 'b', 'go'>({
      initial: 'a',
      transitions: { a: { go: 'b' } },
      onChange: (f, t) => log.push(`${f}>${t}`),
    });
    expect(m.can('go')).toBe(true);
    expect(m.send('go')).toBe(true);
    expect(m.state).toBe('b');
    expect(m.send('go')).toBe(false);
    expect(log).toEqual(['a>b']);
  });
});

describe('schedule', () => {
  it('fires and cancels', () => {
    const f = vi.fn();
    schedule(100, f);
    schedule(100, f).cancel();
    vi.advanceTimersByTime(100);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('SessionTimer', () => {
  it('warns at 10:00 and blackout at 12:00', () => {
    const t = new SessionTimer();
    const w = vi.fn();
    const b = vi.fn();
    t.on('warning', w);
    t.on('blackout', b);
    t.start();
    vi.advanceTimersByTime(10 * MIN - 1);
    expect(w).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(w).toHaveBeenCalledWith({ elapsedMs: 10 * MIN, remainingMs: 2 * MIN });
    expect(t.phase).toBe('warned');
    vi.advanceTimersByTime(2 * MIN);
    expect(b).toHaveBeenCalledWith({ elapsedMs: 12 * MIN });
    expect(t.phase).toBe('ended');
    vi.advanceTimersByTime(60 * MIN);
    expect(w).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('off never fires', () => {
    const t = new SessionTimer(sessionPreset('off'));
    const f = vi.fn();
    t.on('warning', f);
    t.on('blackout', f);
    t.start();
    vi.advanceTimersByTime(5 * 60 * MIN);
    expect(f).not.toHaveBeenCalled();
    expect(t.remaining()).toBeNull();
    expect(t.elapsed()).toBe(5 * 60 * MIN);
  });

  it('pause stops the clock; resume continues', () => {
    const t = new SessionTimer();
    const w = vi.fn();
    t.on('warning', w);
    t.start();
    vi.advanceTimersByTime(9 * MIN);
    t.pause();
    expect(t.phase).toBe('paused');
    vi.advanceTimersByTime(30 * MIN);
    expect(t.elapsed()).toBe(9 * MIN);
    expect(w).not.toHaveBeenCalled();
    t.resume();
    vi.advanceTimersByTime(MIN);
    expect(w).toHaveBeenCalledTimes(1);
  });

  it('presets, setConfig, reset, guards', () => {
    expect(sessionPreset(15)).toEqual({ capMs: 15 * MIN, warnAtMs: 13 * MIN });
    const t = new SessionTimer(sessionPreset(10));
    expect(t.phase).toBe('idle');
    t.resume();
    expect(t.phase).toBe('idle');
    const b = vi.fn();
    t.on('blackout', b);
    t.start();
    t.start();
    vi.advanceTimersByTime(3000);
    expect(t.elapsed()).toBe(3000);
    t.setConfig({ capMs: 20_000, warnAtMs: null });
    vi.advanceTimersByTime(17_000);
    expect(b).toHaveBeenCalledTimes(1);
    t.reset();
    expect(t.phase).toBe('idle');
    expect(t.elapsed()).toBe(0);
    t.start();
    expect(t.remaining()).toBe(20_000);
    t.dispose();
  });
});
