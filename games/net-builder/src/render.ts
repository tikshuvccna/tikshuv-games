import { CUT_AUTOHEAL_SECONDS, REPAIR_SECONDS, type Sim, type SimLink, type SimNode } from './engine';
import { WORLD, type NodeKind } from './levels';

export interface View {
  selectedLink: string | null;
  selectedNode: string | null;
  hover: string | null;
  drag: { from: string; x: number; y: number; ok: boolean; cost: number } | null;
  /** Wall-clock seconds, for animation only. */
  clock: number;
}

export const NODE_R = 34;

const C = {
  bg0: '#0B1020', bg1: '#141C36', grid: 'rgba(120,150,220,.10)',
  cable: '#4A5B86', cableHi: '#7C90C4', cut: '#FF5C6C', repair: '#FFC857', ok: '#58E6B0',
  text: '#E8EEFF', mute: '#8FA0C8',
};

const KIND_COLOR: Record<NodeKind, string> = {
  pc: '#5B8DEF', server: '#B084FF', printer: '#F59E8B', hub: '#FFB347', switch: '#3DDBC2',
};

export const KIND_LABEL: Record<NodeKind, string> = {
  pc: 'מחשב', server: 'שרת', printer: 'מדפסת', hub: 'רכזת', switch: 'מתג',
};

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawIcon(ctx: CanvasRenderingContext2D, kind: NodeKind, glow: string): void {
  ctx.lineWidth = 2;
  ctx.strokeStyle = glow;
  ctx.fillStyle = '#0E1530';
  if (kind === 'pc') {
    rr(ctx, -17, -15, 34, 23, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = glow; ctx.globalAlpha = 0.28; rr(ctx, -13, -11, 26, 15, 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, 13); ctx.moveTo(-9, 14); ctx.lineTo(9, 14); ctx.stroke();
  } else if (kind === 'server') {
    for (let i = 0; i < 3; i++) {
      rr(ctx, -16, -17 + i * 12, 32, 10, 3); ctx.fillStyle = '#0E1530'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = i === 1 ? '#58E6B0' : glow; ctx.beginPath(); ctx.arc(-10, -12 + i * 12, 1.8, 0, 7); ctx.fill();
      ctx.fillRect(2, -13 + i * 12, 10, 2);
    }
  } else if (kind === 'printer') {
    rr(ctx, -16, -4, 32, 15, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#E8EEFF'; rr(ctx, -9, -15, 18, 12, 1); ctx.fill();
    ctx.fillStyle = '#0E1530'; ctx.fillRect(-9, 6, 18, 8); ctx.strokeRect(-9, 6, 18, 8);
  } else {
    rr(ctx, -19, -10, 38, 20, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = glow;
    for (let i = 0; i < 4; i++) ctx.fillRect(-14 + i * 8, 1, 5, 5);
    if (kind === 'switch') {
      ctx.beginPath();
      ctx.moveTo(-10, -5); ctx.lineTo(10, -5); ctx.moveTo(6, -8); ctx.lineTo(10, -5); ctx.lineTo(6, -2);
      ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(0, -4, 3, 0, 7); ctx.fill();
    }
  }
}

function nodePos(sim: Sim, id: string): SimNode {
  return sim.node(id) as SimNode;
}

export function linkAt(sim: Sim, x: number, y: number): SimLink | null {
  for (const l of sim.links) {
    const a = nodePos(sim, l.a);
    const b = nodePos(sim, l.b);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)) < 12) return l;
  }
  return null;
}

export function nodeAt(sim: Sim, x: number, y: number): SimNode | null {
  for (const n of sim.nodes) if (sim.visible(n) && Math.hypot(n.x - x, n.y - y) < NODE_R) return n;
  return null;
}

export function draw(ctx: CanvasRenderingContext2D, sim: Sim, v: View): void {
  const { w, h } = WORLD;
  const g = ctx.createRadialGradient(w / 2, h / 2, 60, w / 2, h / 2, 640);
  g.addColorStop(0, C.bg1); g.addColorStop(1, C.bg0);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = C.grid;
  for (let x = 20; x < w; x += 40) for (let y = 20; y < h; y += 40) ctx.fillRect(x, y, 2, 2);

  drawLinks(ctx, sim, v);
  drawDrag(ctx, sim, v);
  for (const n of sim.nodes) if (sim.visible(n)) drawNode(ctx, sim, n, v);
  drawPackets(ctx, sim, v);
  for (const [id, left] of sim.flashes) {
    const n = nodePos(sim, id);
    const k = 1 - left / 0.6;
    ctx.strokeStyle = `rgba(255,92,108,${1 - k})`; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(n.x, n.y, NODE_R + 8 + k * 40, 0, 7); ctx.stroke();
    ctx.fillStyle = `rgba(255,140,150,${1 - k})`; ctx.font = '700 16px Heebo, system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('התנגשות!', n.x, n.y - NODE_R - 14 - k * 18);
  }
}

function drawLinks(ctx: CanvasRenderingContext2D, sim: Sim, v: View): void {
  for (const l of sim.links) {
    const a = nodePos(sim, l.a);
    const b = nodePos(sim, l.b);
    const sel = v.selectedLink === l.id;
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    if (l.cut) {
      ctx.strokeStyle = l.repairLeft > 0 ? C.repair : C.cut; ctx.lineWidth = 5; ctx.setLineDash([10, 12]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const pulse = 1 + Math.sin(v.clock * 9) * 0.15;
      ctx.fillStyle = l.repairLeft > 0 ? C.repair : C.cut;
      ctx.beginPath(); ctx.arc(mx, my, 15 * pulse, 0, 7); ctx.fill();
      ctx.fillStyle = '#1A0A10'; ctx.font = '700 18px Heebo, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(l.repairLeft > 0 ? '⏳' : '✂', mx, my + 1);
      if (l.repairLeft > 0) {
        ctx.strokeStyle = C.ok; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(mx, my, 20, -Math.PI / 2, -Math.PI / 2 + (1 - l.repairLeft / REPAIR_SECONDS) * Math.PI * 2); ctx.stroke();
      } else if (l.cutAge > CUT_AUTOHEAL_SECONDS - 4) {
        ctx.fillStyle = C.mute; ctx.font = '12px Heebo, system-ui'; ctx.fillText('מתחבר מחדש…', mx, my + 30);
      }
      continue;
    }
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(a.x, a.y + 3); ctx.lineTo(b.x, b.y + 3); ctx.stroke();
    ctx.strokeStyle = sel ? '#FFFFFF' : C.cable; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = sel ? C.ok : C.cableHi; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
}

function drawDrag(ctx: CanvasRenderingContext2D, sim: Sim, v: View): void {
  if (!v.drag) return;
  const a = nodePos(sim, v.drag.from);
  ctx.strokeStyle = v.drag.ok ? C.ok : C.cut; ctx.lineWidth = 4; ctx.setLineDash([9, 8]); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(v.drag.x, v.drag.y); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = v.drag.ok ? C.ok : C.cut; ctx.font = '700 15px Heebo, system-ui'; ctx.textAlign = 'center';
  ctx.fillText(`${v.drag.cost} יח׳`, v.drag.x, v.drag.y - 16);
}

function drawNode(ctx: CanvasRenderingContext2D, sim: Sim, n: SimNode, v: View): void {
  const age = sim.time - n.appearAt;
  const s = n.appearAt > 0 && age < 0.6 ? Math.max(0.01, easeOutBack(age / 0.6)) : 1;
  const col = KIND_COLOR[n.kind];
  const sel = v.selectedNode === n.id || v.hover === n.id;
  ctx.save();
  ctx.translate(n.x, n.y);
  ctx.scale(s, s);
  const connected = sim.links.some((l) => l.a === n.id || l.b === n.id);
  if (!connected && (n.kind === 'pc' || n.kind === 'printer')) {
    const k = (v.clock * 1.4) % 1;
    ctx.strokeStyle = `rgba(255,200,87,${0.7 * (1 - k)})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, NODE_R + k * 18, 0, 7); ctx.stroke();
  }
  ctx.shadowColor = col; ctx.shadowBlur = sel ? 26 : 14;
  ctx.fillStyle = '#10183A'; ctx.beginPath(); ctx.arc(0, 0, NODE_R, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = col; ctx.lineWidth = sel ? 4 : 3; ctx.stroke();
  drawIcon(ctx, n.kind, col);
  ctx.fillStyle = C.text; ctx.font = '600 14px Heebo, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(n.label, 0, NODE_R + 18);
  ctx.restore();
}

function drawPackets(ctx: CanvasRenderingContext2D, sim: Sim, v: View): void {
  const waiting = new Map<string, number>();
  for (const p of sim.packets) {
    let x: number;
    let y: number;
    if (p.link && p.to) {
      const from = p.to === p.link.b ? nodePos(sim, p.link.a) : nodePos(sim, p.link.b);
      const to = nodePos(sim, p.to);
      const t = Math.min(1, p.progress / p.link.len);
      x = from.x + (to.x - from.x) * t;
      y = from.y + (to.y - from.y) * t;
    } else {
      const n = nodePos(sim, p.at);
      const i = waiting.get(p.at) ?? 0;
      waiting.set(p.at, i + 1);
      const ang = -Math.PI / 2 + i * 0.9 + 0.5;
      x = n.x + Math.cos(ang) * (NODE_R + 9);
      y = n.y + Math.sin(ang) * (NODE_R + 9);
    }
    const urgent = p.age > sim.level.patience * 0.7;
    const col = urgent ? C.cut : `hsl(${p.hue},85%,64%)`;
    ctx.shadowColor = col; ctx.shadowBlur = 12;
    ctx.fillStyle = col; rr(ctx, x - 7, y - 5, 14, 10, 3); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x - 6, y - 4); ctx.lineTo(x, y + 1); ctx.lineTo(x + 6, y - 4); ctx.stroke();
    if (urgent && Math.sin(v.clock * 12) > 0) { ctx.strokeStyle = C.cut; ctx.strokeRect(x - 10, y - 8, 20, 16); }
  }
}
