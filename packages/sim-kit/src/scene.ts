import type { SimEvent, SimEventKind, SimNodeId, SimTrace, TopologyLayout } from './types';

export const DEFAULT_DURATIONS: Record<SimEventKind, number> = {
  frame: 1200,
  packet: 1200,
  'arp-request': 1400,
  'arp-reply': 1400,
  icmp: 1200,
  drop: 1000,
  'table-update': 1000,
};

export function durationsFor(trace: SimTrace, override?: (e: SimEvent, i: number) => number | undefined): number[] {
  return trace.map((e, i) => override?.(e, i) ?? DEFAULT_DURATIONS[e.kind]);
}

/** Returns human-readable problems (empty when the trace fits the layout). */
export function validateTrace(trace: SimTrace, layout: TopologyLayout): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const n of layout.nodes) {
    if (ids.has(n.id)) errs.push(`duplicate node ${n.id}`);
    ids.add(n.id);
  }
  for (const l of layout.links) {
    if (!ids.has(l.a) || !ids.has(l.b)) errs.push(`link ${l.a}-${l.b} references an unknown node`);
  }
  let prev = -Infinity;
  trace.forEach((e, i) => {
    if (!ids.has(e.from)) errs.push(`event ${i}: unknown node ${e.from}`);
    if (!ids.has(e.to)) errs.push(`event ${i}: unknown node ${e.to}`);
    if (e.t < prev) errs.push(`event ${i}: t goes backwards`);
    prev = e.t;
  });
  return errs;
}

export interface ScenePacket {
  eventIndex: number;
  kind: SimEventKind;
  x: number;
  y: number;
  label: string;
}

export interface TableRow {
  eventIndex: number;
  text: string;
  /** True while the row's own step is the current one (pulse highlight). */
  fresh: boolean;
}

export interface Scene {
  event: SimEvent | undefined;
  /** In-flight (or just-arrived) packet; absent for table-update steps and drops. */
  packet?: ScenePacket;
  /** Drop marker position. */
  drop?: { x: number; y: number; eventIndex: number };
  /** Link carrying the current packet, as [a,b] ids when such a link exists. */
  activeLink?: [SimNodeId, SimNodeId];
  activeNodes: SimNodeId[];
  tables: Map<SimNodeId, TableRow[]>;
}

export function easeInOut(p: number): number {
  const c = Math.min(1, Math.max(0, p));
  return c * c * (3 - 2 * c);
}

/** Pure function of (trace, layout, step index, step progress): what the stage should show. */
export function computeScene(trace: SimTrace, layout: TopologyLayout, index: number, progress: number): Scene {
  const pos = new Map(layout.nodes.map((n) => [n.id, n] as const));
  const event = trace[index];
  const tables = new Map<SimNodeId, TableRow[]>();
  for (let i = 0; i <= index && i < trace.length; i++) {
    const e = trace[i];
    if (!e || e.kind !== 'table-update') continue;
    const node = e.to || e.from;
    const rows = tables.get(node) ?? [];
    rows.push({ eventIndex: i, text: e.label, fresh: i === index });
    tables.set(node, rows);
  }
  const scene: Scene = { event, activeNodes: [], tables };
  if (!event) return scene;
  const a = pos.get(event.from);
  const b = pos.get(event.to);
  if (a) scene.activeNodes.push(a.id);
  if (b && b.id !== a?.id) scene.activeNodes.push(b.id);
  if (event.kind === 'table-update') return scene;
  if (event.kind === 'drop') {
    const at = a ?? b;
    if (at) scene.drop = { x: at.x, y: at.y, eventIndex: index };
    return scene;
  }
  if (a && b) {
    const p = easeInOut(progress);
    scene.packet = {
      eventIndex: index,
      kind: event.kind,
      x: a.x + (b.x - a.x) * p,
      y: a.y + (b.y - a.y) * p,
      label: event.label,
    };
    if (layout.links.some((l) => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id))) {
      scene.activeLink = [a.id, b.id];
    }
  }
  return scene;
}
