import { describe, expect, it, vi } from 'vitest';
import { DEMO, DEMO_CAPTIONS_HE, DEMO_LAYOUT, DEMO_TRACE } from './demo';
import { createManualClock, PlaybackController } from './controller';
import { computeScene, DEFAULT_DURATIONS, durationsFor, easeInOut, validateTrace } from './scene';

function mk(durations = [1000, 1000, 1000], reducedMotion = false) {
  const clock = createManualClock();
  const c = new PlaybackController({ durations, clock, reducedMotion });
  return { clock, c };
}

describe('PlaybackController', () => {
  it('starts paused at step 0', () => {
    const { c } = mk();
    expect(c.getState()).toMatchObject({ index: 0, progress: 0, playing: false, totalMs: 3000, ended: false });
    expect(c.stepCount).toBe(3);
  });

  it('advances deterministically with the clock', () => {
    const { c, clock } = mk();
    c.play();
    clock.advance(0); // first tick sets the origin
    clock.advance(1500);
    expect(c.getState()).toMatchObject({ index: 1, progress: 0.5, timeMs: 1500 });
  });

  it('respects speed', () => {
    const { c, clock } = mk();
    c.setSpeed(2);
    c.play();
    clock.advance(0);
    clock.advance(500);
    expect(c.getState().timeMs).toBe(1000);
    c.setSpeed(0.5);
    clock.advance(1000);
    expect(c.getState().timeMs).toBe(1500);
  });

  it('ends, fires onEnd once, and play restarts from 0', () => {
    const { c, clock } = mk();
    const end = vi.fn();
    c.onEnd(end);
    c.play();
    clock.advance(0);
    clock.advance(5000);
    expect(c.getState()).toMatchObject({ ended: true, playing: false, index: 2, progress: 1 });
    expect(end).toHaveBeenCalledTimes(1);
    c.play();
    expect(c.getState().timeMs).toBe(0);
    expect(c.getState().playing).toBe(true);
  });

  it('pause stops time', () => {
    const { c, clock } = mk();
    c.play();
    clock.advance(0);
    clock.advance(400);
    c.pause();
    clock.advance(4000);
    expect(c.getState().timeMs).toBe(400);
    c.pause(); // idempotent
    c.toggle();
    expect(c.getState().playing).toBe(true);
    c.toggle();
    expect(c.getState().playing).toBe(false);
  });

  it('steps forward/back and clamps', () => {
    const { c } = mk();
    c.stepForward();
    expect(c.getState().index).toBe(1);
    c.stepForward();
    c.stepForward();
    expect(c.getState()).toMatchObject({ index: 2, ended: true });
    c.stepBack(); // from ended: start of last step
    expect(c.getState()).toMatchObject({ index: 2, ended: false, progress: 0 });
    c.stepBack();
    c.stepBack();
    c.stepBack();
    expect(c.getState().index).toBe(0);
    expect(c.getState().timeMs).toBe(0);
  });

  it('stepTo is idempotent and pauses', () => {
    const { c } = mk();
    c.play();
    c.stepTo(2);
    c.stepTo(2);
    expect(c.getState()).toMatchObject({ index: 2, progress: 0, playing: false });
    c.stepTo(99);
    expect(c.getState().index).toBe(2);
    c.stepTo(-5);
    expect(c.getState().index).toBe(0);
  });

  it('seekTime clamps; restart rewinds paused', () => {
    const { c } = mk();
    c.seekTime(99999);
    expect(c.getState().ended).toBe(true);
    c.seekTime(-3);
    expect(c.getState().timeMs).toBe(0);
    c.seekTime(2500);
    c.restart();
    expect(c.getState()).toMatchObject({ timeMs: 0, playing: false });
  });

  it('notifies step and state subscribers, supports unsubscribe', () => {
    const { c, clock } = mk();
    const steps: number[] = [];
    const states = vi.fn();
    const offStep = c.onStep((i) => steps.push(i));
    const offState = c.subscribe(states);
    c.play();
    clock.advance(0);
    clock.advance(1200);
    clock.advance(1000);
    expect(steps).toEqual([1, 2]);
    expect(states).toHaveBeenCalled();
    offStep();
    offState();
    const n = states.mock.calls.length;
    c.stepTo(0);
    expect(states.mock.calls.length).toBe(n);
    expect(steps).toEqual([1, 2]);
  });

  it('reduced motion reports full progress (no tween)', () => {
    const { c } = mk([1000, 1000], true);
    c.seekTime(100);
    expect(c.getState().progress).toBe(1);
    c.seekTime(1100);
    expect(c.getState()).toMatchObject({ index: 1, progress: 1 });
  });

  it('handles an empty trace', () => {
    const { c } = mk([]);
    c.play();
    c.stepForward();
    c.stepBack();
    c.stepTo(1);
    expect(c.getState()).toMatchObject({ index: 0, playing: false, ended: false, stepCount: 0 });
  });

  it('destroy cancels the pending tick and drops subscribers', () => {
    const { c, clock } = mk();
    const fn = vi.fn();
    c.subscribe(fn);
    c.play();
    fn.mockClear();
    c.destroy();
    clock.advance(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('floors durations at 1ms', () => {
    const { c } = mk([0, 0]);
    expect(c.getState().totalMs).toBe(2);
  });

  it('manual clock ignores cancelled callbacks and reports now', () => {
    const clock = createManualClock();
    const cb = vi.fn();
    const id = clock.request(cb);
    clock.cancel(id);
    clock.advance(5);
    expect(cb).not.toHaveBeenCalled();
    expect(clock.now()).toBe(5);
  });
});

describe('scene', () => {
  it('interpolates a packet along its link', () => {
    const sc = computeScene(DEMO_TRACE, DEMO_LAYOUT, 0, 0.5);
    expect(sc.packet).toMatchObject({ kind: 'arp-request', x: 170, y: 140 });
    expect(sc.activeLink).toEqual(['pcA', 'sw1']);
    expect(sc.activeNodes).toEqual(['pcA', 'sw1']);
  });

  it('shows no packet for a table-update and marks the new row fresh', () => {
    const sc = computeScene(DEMO_TRACE, DEMO_LAYOUT, 1, 0.3);
    expect(sc.packet).toBeUndefined();
    expect(sc.tables.get('sw1')).toEqual([{ eventIndex: 1, text: DEMO_TRACE[1]!.label, fresh: true }]);
    expect(sc.activeNodes).toEqual(['sw1']);
  });

  it('accumulates table rows; older rows stop being fresh', () => {
    const sc = computeScene(DEMO_TRACE, DEMO_LAYOUT, 5, 1);
    const rows = sc.tables.get('sw1')!;
    expect(rows.map((r) => r.eventIndex)).toEqual([1, 4]);
    expect(rows.every((r) => !r.fresh)).toBe(true);
  });

  it('seeking backwards removes later rows', () => {
    expect(computeScene(DEMO_TRACE, DEMO_LAYOUT, 0, 1).tables.size).toBe(0);
  });

  it('places drops at the dropping node', () => {
    const trace = [{ t: 0, kind: 'drop' as const, from: 'sw1', to: 'sw1', label: 'TTL 0', fields: { ttl: 0 } }];
    const sc = computeScene(trace, DEMO_LAYOUT, 0, 1);
    expect(sc.drop).toEqual({ x: 260, y: 140, eventIndex: 0 });
    expect(sc.packet).toBeUndefined();
  });

  it('copes with out-of-range index and unknown nodes', () => {
    expect(computeScene(DEMO_TRACE, DEMO_LAYOUT, 99, 0).event).toBeUndefined();
    const bad = [{ t: 0, kind: 'packet' as const, from: 'x', to: 'y', label: '', fields: {} }];
    const sc = computeScene(bad, DEMO_LAYOUT, 0, 0);
    expect(sc.packet).toBeUndefined();
    expect(sc.activeNodes).toEqual([]);
    const nolink = [{ t: 0, kind: 'packet' as const, from: 'pcA', to: 'pcB', label: '', fields: {} }];
    const sc2 = computeScene(nolink, DEMO_LAYOUT, 0, 1);
    expect(sc2.packet).toMatchObject({ x: 440 });
    expect(sc2.activeLink).toBeUndefined();
  });

  it('easeInOut is clamped and monotone', () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
    expect(easeInOut(0.5)).toBe(0.5);
  });

  it('durationsFor uses defaults and overrides', () => {
    const d = durationsFor(DEMO_TRACE, (e) => (e.kind === 'icmp' ? 300 : undefined));
    expect(d[0]).toBe(DEFAULT_DURATIONS['arp-request']);
    expect(d[6]).toBe(300);
    expect(durationsFor(DEMO_TRACE)).toHaveLength(DEMO_TRACE.length);
  });
});

describe('validateTrace and demo data', () => {
  it('accepts the demo', () => {
    expect(validateTrace(DEMO.trace, DEMO.layout)).toEqual([]);
    expect(DEMO_CAPTIONS_HE).toHaveLength(DEMO_TRACE.length);
  });

  it('reports unknown nodes, duplicates, bad links and time going backwards', () => {
    const layout = {
      nodes: [
        { id: 'a', kind: 'host' as const, x: 0, y: 0, label: 'a' },
        { id: 'a', kind: 'host' as const, x: 0, y: 0, label: 'a' },
      ],
      links: [{ a: 'a', b: 'zz' }],
    };
    const trace = [
      { t: 5, kind: 'frame' as const, from: 'a', to: 'q', label: '', fields: {} },
      { t: 1, kind: 'frame' as const, from: 'nope', to: 'a', label: '', fields: {} },
    ];
    const errs = validateTrace(trace, layout);
    expect(errs).toHaveLength(5);
  });

  it('plays the whole demo headlessly', () => {
    const clock = createManualClock();
    const c = new PlaybackController({ durations: durationsFor(DEMO_TRACE), clock });
    const seen: number[] = [];
    c.onStep((i) => seen.push(i));
    c.play();
    clock.advance(0);
    for (let i = 0; i < 200 && c.getState().playing; i++) clock.advance(100);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(c.getState().ended).toBe(true);
  });
});
