import { describe, expect, it } from 'vitest';
import { createRng } from '@tikshuv/core';
import { Sim } from './engine';
import { LEVELS } from './levels';

const level = (id: string) => LEVELS.find((l) => l.id === id)!;
const make = (id: string, seed = 1) => new Sim(level(id), createRng(seed));

function run(sim: Sim, seconds: number, dt = 0.05): void {
  for (let t = 0; t < seconds; t += dt) sim.step(dt);
}

function wireStar(sim: Sim, centre: string): void {
  for (const n of sim.nodes) if (n.id !== centre) sim.addLink(centre, n.id);
}

describe('building', () => {
  it('charges by cable length and refuses when the budget is short', () => {
    const sim = make('hub');
    const before = sim.budgetLeft;
    expect(sim.addLink('H', 'S')).toEqual({ ok: true });
    expect(sim.budgetLeft).toBeLessThan(before);
    expect(sim.addLink('H', 'S')).toEqual({ ok: false, reason: 'duplicate' });
    expect(sim.addLink('H', 'H')).toEqual({ ok: false, reason: 'self' });
    sim.budgetLeft = 1;
    expect(sim.addLink('H', 'P1')).toEqual({ ok: false, reason: 'budget' });
  });

  it('does not allow cables to a device that has not appeared yet', () => {
    const sim = make('hub');
    expect(sim.addLink('H', 'P5')).toEqual({ ok: false, reason: 'missing' });
  });

  it('refunds a removed cable', () => {
    const sim = make('hub');
    const before = sim.budgetLeft;
    sim.addLink('H', 'S');
    sim.removeLink('H-S');
    expect(sim.budgetLeft).toBe(before);
  });

  it('upgrades a hub to a switch only where the level allows it', () => {
    expect(make('hub').upgrade('H')).toEqual({ ok: false, reason: 'locked' });
    const sim = make('switch');
    expect(sim.upgrade('H')).toEqual({ ok: true });
    expect(sim.node('H')?.kind).toBe('switch');
    expect(sim.upgrade('H')).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('routing', () => {
  it('forwards through hubs and switches but never through a computer', () => {
    const sim = make('hub');
    sim.addLink('P1', 'H');
    sim.addLink('H', 'S');
    expect(sim.route('P1', 'S')).toEqual(['P1', 'H', 'S']);
    const bad = make('hub');
    bad.addLink('P1', 'P2');
    bad.addLink('P2', 'S');
    expect(bad.route('P1', 'S')).toBeNull();
  });

  it('routes around a cut cable when another path exists', () => {
    const sim = make('mesh');
    sim.addLink('S', 'A');
    sim.addLink('S', 'B');
    sim.addLink('A', 'B');
    sim.links.find((l) => l.id === 'S-A')!.cut = true;
    expect(sim.route('A', 'S')).toEqual(['A', 'B', 'S']);
  });
});

describe('traffic', () => {
  it('delivers packets in a wired star with a switch', () => {
    const sim = make('switch');
    sim.upgrade('H');
    wireStar(sim, 'H');
    run(sim, 8);
    expect(sim.stats.delivered).toBeGreaterThan(0);
    expect(sim.stats.collisions).toBe(0);
  });

  it('loses everything when nothing is connected', () => {
    const sim = make('hub');
    run(sim, 40);
    expect(sim.stats.delivered).toBe(0);
    expect(sim.stats.lost).toBeGreaterThan(0);
    expect(sim.result().stars).toBe(0);
  });

  it('a hub produces collisions that a switch does not', () => {
    const hub = make('switch', 7);
    wireStar(hub, 'H');
    run(hub, 80);
    const sw = make('switch', 7);
    sw.upgrade('H');
    wireStar(sw, 'H');
    run(sw, 80);
    expect(hub.stats.collisions).toBeGreaterThan(0);
    expect(sw.stats.collisions).toBe(0);
    expect(sw.result().ratio).toBeGreaterThan(hub.result().ratio);
  });
});

describe('failures', () => {
  it('cuts a cable on schedule, drops packets on it and lets the player repair it', () => {
    const sim = make('switch', 3);
    sim.upgrade('H');
    wireStar(sim, 'H');
    run(sim, 36);
    const cut = sim.links.find((l) => l.cut);
    expect(cut).toBeDefined();
    expect(sim.stats.cuts).toBe(1);
    expect(sim.startRepair(cut!.id)).toEqual({ ok: true });
    run(sim, 3);
    expect(cut!.cut).toBe(false);
    expect(sim.drain().some((e) => e.type === 'repaired')).toBe(true);
  });

  it('a cut heals by itself after a while', () => {
    const sim = make('switch', 3);
    sim.upgrade('H');
    wireStar(sim, 'H');
    run(sim, 36);
    const cut = sim.links.find((l) => l.cut)!;
    run(sim, 17);
    expect(cut.cut).toBe(false);
  });

  it('targets a cable that touches the named node', () => {
    const sim = make('mesh', 5);
    sim.addLink('S', 'A');
    sim.addLink('S', 'B');
    sim.addLink('A', 'B');
    sim.addLink('A', 'P1');
    run(sim, 29);
    const cut = sim.links.find((l) => l.cut)!;
    expect([cut.a, cut.b]).toContain('S');
  });

  it('cannot repair a cable that is not cut', () => {
    const sim = make('hub');
    sim.addLink('H', 'S');
    expect(sim.startRepair('H-S')).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('scoring', () => {
  it('awards stars from the delivery ratio', () => {
    const sim = make('hub');
    sim.stats = { sent: 10, delivered: 8, lost: 2, collisions: 0, cuts: 0 };
    expect(sim.result().stars).toBe(2);
    sim.stats = { sent: 20, delivered: 19, lost: 1, collisions: 0, cuts: 0 };
    expect(sim.result().stars).toBe(3);
    sim.stats = { sent: 10, delivered: 4, lost: 6, collisions: 0, cuts: 0 };
    expect(sim.result().stars).toBe(0);
  });

  it('finishes at the level duration', () => {
    const sim = make('hub');
    run(sim, sim.level.duration + 1);
    expect(sim.finished).toBe(true);
  });
});

describe('levels', () => {
  it('every level has a check question with a valid answer', () => {
    for (const l of LEVELS) {
      expect(l.check.options[l.check.correct]).toBeTruthy();
      expect(l.stars[0]).toBeLessThan(l.stars[1]);
      expect(l.stars[1]).toBeLessThan(l.stars[2]);
    }
  });
});
