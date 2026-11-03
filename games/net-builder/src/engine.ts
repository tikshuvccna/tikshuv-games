import type { Rng } from '@tikshuv/core';
import type { LevelDef, NodeKind } from './levels';

export const PACKET_SPEED = 260; // world px per second
export const LINK_CAPACITY = 2; // packets on one cable at the same time
export const CABLE_PX_PER_UNIT = 25;
export const REPAIR_SECONDS = 2.5;
export const CUT_AUTOHEAL_SECONDS = 16;
const RETRY_DELAY = 0.25;
const COLLISION_CHANCE = 0.1;

export interface SimNode { id: string; kind: NodeKind; x: number; y: number; label: string; appearAt: number }

export interface SimLink {
  id: string;
  a: string;
  b: string;
  len: number;
  cost: number;
  cut: boolean;
  /** Seconds until a pending repair finishes (0 = not repairing). */
  repairLeft: number;
  cutAge: number;
}

export interface Packet {
  id: number;
  src: string;
  dest: string;
  at: string;
  /** Set while travelling on a cable. */
  link: SimLink | null;
  to: string | null;
  progress: number;
  age: number;
  wait: number;
  hue: number;
}

export type SimEvent =
  | { type: 'delivered'; packet: Packet }
  | { type: 'lost'; packet: Packet; reason: 'timeout' | 'cut' }
  | { type: 'collision'; at: string }
  | { type: 'cut'; link: SimLink }
  | { type: 'repaired'; link: SimLink }
  | { type: 'appeared'; node: SimNode };

export interface SimStats { sent: number; delivered: number; lost: number; collisions: number; cuts: number }

export type ActionResult = { ok: true } | { ok: false; reason: 'budget' | 'duplicate' | 'self' | 'missing' | 'locked' };

const isRelay = (k: NodeKind): boolean => k === 'hub' || k === 'switch';
const isEndpoint = (k: NodeKind): boolean => k === 'pc' || k === 'server' || k === 'printer';

export function linkCost(a: { x: number; y: number }, b: { x: number; y: number }): { len: number; cost: number } {
  const len = Math.hypot(a.x - b.x, a.y - b.y);
  return { len, cost: Math.max(1, Math.ceil(len / CABLE_PX_PER_UNIT)) };
}

export class Sim {
  time = 0;
  nodes: SimNode[];
  links: SimLink[] = [];
  packets: Packet[] = [];
  budgetLeft: number;
  stats: SimStats = { sent: 0, delivered: 0, lost: 0, collisions: 0, cuts: 0 };
  events: SimEvent[] = [];
  /** Hub ids that had a collision recently, with seconds left (for the painter). */
  flashes = new Map<string, number>();
  private nextId = 1;
  private spawnAt = new Map<string, number>();
  private cutIdx = 0;
  private seen = new Set<string>();

  constructor(readonly level: LevelDef, private readonly rng: Rng) {
    this.nodes = level.nodes.map((n) => ({ ...n }));
    this.budgetLeft = level.budget;
  }

  get finished(): boolean {
    return this.time >= this.level.duration;
  }

  node(id: string): SimNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  visible(n: SimNode): boolean {
    return n.appearAt <= this.time;
  }

  linkBetween(a: string, b: string): SimLink | undefined {
    return this.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
  }

  addLink(aId: string, bId: string): ActionResult {
    if (aId === bId) return { ok: false, reason: 'self' };
    const a = this.node(aId);
    const b = this.node(bId);
    if (!a || !b || !this.visible(a) || !this.visible(b)) return { ok: false, reason: 'missing' };
    if (this.linkBetween(aId, bId)) return { ok: false, reason: 'duplicate' };
    const { len, cost } = linkCost(a, b);
    if (cost > this.budgetLeft) return { ok: false, reason: 'budget' };
    this.budgetLeft -= cost;
    this.links.push({ id: `${aId}-${bId}`, a: aId, b: bId, len, cost, cut: false, repairLeft: 0, cutAge: 0 });
    return { ok: true };
  }

  removeLink(id: string): ActionResult {
    const i = this.links.findIndex((l) => l.id === id);
    const l = this.links[i];
    if (!l) return { ok: false, reason: 'missing' };
    this.links.splice(i, 1);
    this.budgetLeft += l.cost;
    this.dropOn(l, 'cut');
    return { ok: true };
  }

  upgrade(id: string): ActionResult {
    const n = this.node(id);
    const cost = this.level.upgradeCost;
    if (!n || n.kind !== 'hub') return { ok: false, reason: 'missing' };
    if (cost === null) return { ok: false, reason: 'locked' };
    if (cost > this.budgetLeft) return { ok: false, reason: 'budget' };
    this.budgetLeft -= cost;
    n.kind = 'switch';
    n.label = 'מתג';
    return { ok: true };
  }

  startRepair(id: string): ActionResult {
    const l = this.links.find((x) => x.id === id);
    if (!l || !l.cut) return { ok: false, reason: 'missing' };
    if (l.repairLeft === 0) l.repairLeft = REPAIR_SECONDS;
    return { ok: true };
  }

  /** Breadth-first route over working cables. Only hubs and switches forward traffic. */
  route(from: string, dest: string): string[] | null {
    const prev = new Map<string, string>();
    const queue = [from];
    const seen = new Set([from]);
    while (queue.length) {
      const cur = queue.shift() as string;
      if (cur === dest) {
        const path = [cur];
        let p = cur;
        while (prev.has(p)) {
          p = prev.get(p) as string;
          path.unshift(p);
        }
        return path;
      }
      const curNode = this.node(cur);
      if (!curNode || (cur !== from && !isRelay(curNode.kind))) continue;
      for (const l of this.links) {
        if (l.cut) continue;
        const other = l.a === cur ? l.b : l.b === cur ? l.a : null;
        if (!other || seen.has(other)) continue;
        const on = this.node(other);
        if (!on || !this.visible(on)) continue;
        seen.add(other);
        prev.set(other, cur);
        queue.push(other);
      }
    }
    return null;
  }

  step(dt: number): void {
    if (this.finished) return;
    this.time += dt;
    for (const [k, v] of this.flashes) {
      if (v - dt <= 0) this.flashes.delete(k);
      else this.flashes.set(k, v - dt);
    }
    this.announceNewNodes();
    this.runCuts();
    this.tickLinks(dt);
    this.spawn();
    for (const p of [...this.packets]) this.stepPacket(p, dt);
  }

  private announceNewNodes(): void {
    for (const n of this.nodes) {
      if (this.visible(n) && !this.seen.has(n.id)) {
        this.seen.add(n.id);
        if (n.appearAt > 0) this.events.push({ type: 'appeared', node: n });
      }
    }
  }

  private runCuts(): void {
    const c = this.level.cuts[this.cutIdx];
    if (!c || c.at > this.time) return;
    this.cutIdx++;
    const pool = this.links.filter((l) => !l.cut && (!c.near || l.a === c.near || l.b === c.near));
    if (!pool.length) return;
    const link = this.rng.pick(pool);
    link.cut = true;
    link.cutAge = 0;
    this.stats.cuts++;
    this.dropOn(link, 'cut');
    this.events.push({ type: 'cut', link });
  }

  private tickLinks(dt: number): void {
    for (const l of this.links) {
      if (!l.cut) continue;
      l.cutAge += dt;
      if (l.repairLeft > 0) {
        l.repairLeft -= dt;
        if (l.repairLeft <= 0) this.heal(l);
      } else if (l.cutAge >= CUT_AUTOHEAL_SECONDS) {
        this.heal(l);
      }
    }
  }

  private heal(l: SimLink): void {
    l.cut = false;
    l.repairLeft = 0;
    l.cutAge = 0;
    this.events.push({ type: 'repaired', link: l });
  }

  private spawn(): void {
    const dests = this.nodes.filter((n) => this.visible(n) && (n.kind === 'server' || n.kind === 'printer'));
    if (!dests.length) return;
    const servers = dests.filter((n) => n.kind === 'server');
    for (const n of this.nodes) {
      if (n.kind !== 'pc' || !this.visible(n)) continue;
      const due = this.spawnAt.get(n.id) ?? n.appearAt + 1 + this.rng.next() * this.level.spawnEvery;
      if (this.time < due) {
        this.spawnAt.set(n.id, due);
        continue;
      }
      this.spawnAt.set(n.id, this.time + this.level.spawnEvery * (0.7 + this.rng.next() * 0.6));
      const pool = this.rng.next() < 0.25 ? dests : servers.length ? servers : dests;
      const dest = this.rng.pick(pool);
      this.packets.push({
        id: this.nextId++, src: n.id, dest: dest.id, at: n.id, link: null, to: null,
        progress: 0, age: 0, wait: 0, hue: this.hueOf(n.id),
      });
      this.stats.sent++;
    }
  }

  private hueOf(id: string): number {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  private load(l: SimLink): number {
    return this.packets.reduce((n, p) => n + (p.link === l ? 1 : 0), 0);
  }

  /** Packets moving on any cable that touches this hub. */
  private hubBusy(hubId: string): Packet[] {
    return this.packets.filter((p) => p.link && (p.link.a === hubId || p.link.b === hubId));
  }

  private lose(p: Packet, reason: 'timeout' | 'cut'): void {
    this.packets = this.packets.filter((x) => x !== p);
    this.stats.lost++;
    this.events.push({ type: 'lost', packet: p, reason });
  }

  private dropOn(l: SimLink, reason: 'cut'): void {
    for (const p of this.packets.filter((x) => x.link === l)) this.lose(p, reason);
  }

  private stepPacket(p: Packet, dt: number): void {
    if (!this.packets.includes(p)) return;
    p.age += dt;
    if (p.age > this.level.patience) return this.lose(p, 'timeout');

    if (p.link) {
      p.progress += PACKET_SPEED * dt;
      if (p.progress < p.link.len) return;
      p.at = p.to as string;
      p.link = null;
      p.to = null;
      p.progress = 0;
      if (p.at === p.dest) {
        this.packets = this.packets.filter((x) => x !== p);
        this.stats.delivered++;
        this.events.push({ type: 'delivered', packet: p });
      }
      return;
    }

    p.wait -= dt;
    if (p.wait > 0) return;
    const path = this.route(p.at, p.dest);
    const nextId = path?.[1];
    if (!nextId) return;
    const link = this.linkBetween(p.at, nextId);
    if (!link || this.load(link) >= LINK_CAPACITY) return;

    for (const relayId of [p.at, nextId]) {
      const relay = this.node(relayId);
      if (!relay || relay.kind !== 'hub') continue;
      const busy = this.hubBusy(relayId);
      if (!busy.length) continue;
      if (this.rng.next() < COLLISION_CHANCE) return this.collide(p, busy, relayId);
      p.wait = RETRY_DELAY;
      return;
    }
    p.link = link;
    p.to = nextId;
    p.progress = 0;
  }

  private collide(p: Packet, busy: Packet[], hubId: string): void {
    this.stats.collisions++;
    this.flashes.set(hubId, 0.6);
    this.events.push({ type: 'collision', at: hubId });
    p.wait = 0.6 + this.rng.next() * 0.9;
    for (const v of busy) {
      // the packet already on the wire is garbled and goes back to its sender to try again
      v.at = v.link ? (v.link.a === v.to ? v.link.b : v.link.a) : v.at;
      v.link = null;
      v.to = null;
      v.progress = 0;
      v.wait = 0.6 + this.rng.next() * 0.9;
    }
  }

  result(): { ratio: number; stars: 0 | 1 | 2 | 3 } {
    const done = this.stats.delivered + this.stats.lost;
    const ratio = done === 0 ? 0 : this.stats.delivered / done;
    const [one, two, three] = this.level.stars;
    return { ratio, stars: ratio >= three ? 3 : ratio >= two ? 2 : ratio >= one ? 1 : 0 };
  }

  drain(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  isEndpoint(id: string): boolean {
    const n = this.node(id);
    return !!n && isEndpoint(n.kind);
  }
}
