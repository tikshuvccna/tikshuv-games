/** DOM/SVG layer of the sim stage. All logic lives in controller.ts and scene.ts; this only paints. */
import { h, prefersReducedMotion } from '@tikshuv/ui';
import './sim-kit.css';
import { createRafClock, PlaybackController, SIM_SPEEDS, type Clock, type PlaybackState } from './controller';
import { computeScene, durationsFor, validateTrace } from './scene';
import { SIM_STRINGS_HE, type SimStrings } from './strings';
import type { SimEvent, SimEventKind, SimLayoutNode, SimTrace, TopologyLayout } from './types';

const NS = 'http://www.w3.org/2000/svg';

function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | undefined> = {},
  ...kids: Array<SVGElement | string>
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, String(v));
  for (const c of kids) el.append(c);
  return el;
}

export interface SimStageOptions {
  layout: TopologyLayout;
  trace: SimTrace;
  /** Caption (Hebrew, from the caller) per step. Shown and announced through a live region. */
  caption?: (event: SimEvent, index: number) => string | undefined;
  strings?: SimStrings;
  clock?: Clock;
  /** Defaults to the app setting (prefersReducedMotion()). Steps then jump without tween. */
  reducedMotion?: boolean;
  durationOf?: (e: SimEvent, i: number) => number | undefined;
  autoplay?: boolean;
}

export interface SimStageHandle {
  readonly element: HTMLElement;
  readonly controller: PlaybackController;
  inspect(open?: boolean): void;
  destroy(): void;
}

const KIND_SHAPE: Record<SimEventKind, string> = {
  frame: 'M-9,-6h18v12h-18z',
  packet: 'M0,-9L9,0L0,9L-9,0z',
  'arp-request': 'M0,-9L9,7h-18z',
  'arp-reply': 'M0,9L9,-7h-18z',
  icmp: 'M-9,-3h18v6h-18z',
  drop: 'M-8,-8L8,8M8,-8L-8,8',
  'table-update': 'M-9,-6h18v12h-18z',
};

const NODE_SHAPE: Record<SimLayoutNode['kind'], (x: number, y: number) => SVGElement> = {
  host: (x, y) =>
    s('g', {}, s('rect', { x: x - 22, y: y - 17, width: 44, height: 28, class: 'sk-node__body' }), s('path', { d: `M${x - 12},${y + 17}h24M${x},${y + 11}v6`, class: 'sk-node__stroke' })),
  switch: (x, y) =>
    s(
      'g',
      {},
      s('rect', { x: x - 30, y: y - 12, width: 60, height: 24, class: 'sk-node__body' }),
      s('path', { d: `M${x - 20},${y}h4M${x - 8},${y}h4M${x + 4},${y}h4M${x + 16},${y}h4`, class: 'sk-node__stroke' }),
    ),
  router: (x, y) =>
    s(
      'g',
      {},
      s('path', { d: `M${x - 18},${y - 18}h36l12,18l-12,18h-36l-12,-18z`, class: 'sk-node__body' }),
      s('path', { d: `M${x - 8},${y}h16M${x},${y - 8}v16`, class: 'sk-node__stroke' }),
    ),
};

const FIELD_ORDER = ['srcMac', 'dstMac', 'srcIp', 'dstIp', 'ttl'] as const;

export function mountSimStage(host: HTMLElement, o: SimStageOptions): SimStageHandle {
  const str = o.strings ?? SIM_STRINGS_HE;
  const problems = validateTrace(o.trace, o.layout);
  if (problems.length) throw new Error(`sim-kit: invalid trace: ${problems.join('; ')}`);
  const reduced = o.reducedMotion ?? prefersReducedMotion();
  const ctrl = new PlaybackController({
    durations: durationsFor(o.trace, o.durationOf),
    clock: o.clock ?? createRafClock(),
    reducedMotion: reduced,
  });
  const nodes = new Map(o.layout.nodes.map((n) => [n.id, n] as const));

  // ---- geometry
  const xs = o.layout.nodes.map((n) => n.x);
  const ys = o.layout.nodes.map((n) => n.y);
  const pad = 90;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const vw = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const vh = Math.max(...ys) - Math.min(...ys) + pad * 2;

  // ---- static SVG
  const linkEls = new Map<string, SVGElement>();
  const linkLayer = s('g', { class: 'sk-links' });
  for (const l of o.layout.links) {
    const a = nodes.get(l.a);
    const b = nodes.get(l.b);
    if (!a || !b) continue;
    const el = s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'sk-link' });
    linkEls.set([l.a, l.b].sort().join('|'), el);
    linkLayer.append(el);
  }
  const nodeEls = new Map<string, SVGElement>();
  const nodeLayer = s('g', { class: 'sk-nodes' });
  for (const n of o.layout.nodes) {
    const g = s('g', { class: `sk-node sk-node--${n.kind}`, 'data-node': n.id }, NODE_SHAPE[n.kind](n.x, n.y));
    g.append(s('text', { x: n.x, y: n.y + 44, class: 'sk-node__label', 'text-anchor': 'middle' }, n.label));
    nodeEls.set(n.id, g);
    nodeLayer.append(g);
  }
  const tableLayer = s('g', { class: 'sk-tables' });
  const packetPath = s('path', { class: 'sk-packet__shape' });
  const packetText = s('text', { class: 'sk-packet__label', 'text-anchor': 'middle', y: -16 });
  const packetG = s('g', { class: 'sk-packet', tabindex: 0, role: 'button', visibility: 'hidden' }, packetPath, packetText);
  const dropG = s('g', { class: 'sk-drop', visibility: 'hidden' }, s('path', { d: KIND_SHAPE.drop, class: 'sk-drop__x' }));

  const svg = s(
    'svg',
    { viewBox: `${minX} ${minY} ${vw} ${vh}`, class: 'sk-svg', role: 'group', 'aria-label': str.stage, 'shape-rendering': 'crispEdges' },
    s('rect', { x: minX, y: minY, width: vw, height: vh, class: 'sk-bg' }),
    linkLayer,
    nodeLayer,
    tableLayer,
    dropG,
    packetG,
  );

  // ---- controls
  const btn = (label: string, path: string, onClick: () => void): HTMLButtonElement => {
    const b = h('button', { type: 'button', class: 'sk-btn', 'aria-label': label, title: label });
    b.append(s('svg', { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true', class: 'sk-icon' }, s('path', { d: path })));
    b.addEventListener('click', onClick);
    return b;
  };
  const PLAY = 'M7.5 5.5v13l10-6.5z';
  const PAUSE = 'M8 5.5v13M16 5.5v13';
  const rtl = () => getComputedStyle(root).direction === 'rtl';
  const restartBtn = btn(str.restart, 'M4.5 12a7.5 7.5 0 0 1 13-5.1M19.5 12a7.5 7.5 0 0 1-13 5.1M17.75 3.5v3.75H14M6.25 20.5v-3.75H10', () => ctrl.restart());
  const backBtn = btn(str.stepBack, 'M15.5 5.5 9 12l6.5 6.5M6 5.5v13', () => ctrl.stepBack());
  const playBtn = btn(str.play, PLAY, () => ctrl.toggle());
  const fwdBtn = btn(str.stepForward, 'M8.5 5.5 15 12l-6.5 6.5M18 5.5v13', () => ctrl.stepForward());
  const inspectBtn = h('button', { type: 'button', class: 'sk-btn sk-btn--text', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, str.inspect);
  const speedGroup = h('div', { class: 'sk-speed', role: 'group', 'aria-label': str.speed });
  const speedBtns = SIM_SPEEDS.map((sp) => {
    const b = h('button', { type: 'button', class: 'sk-btn sk-btn--text', 'aria-pressed': 'false', dir: 'ltr' }, `${sp}x`);
    b.addEventListener('click', () => ctrl.setSpeed(sp));
    speedGroup.append(b);
    return b;
  });
  const range = h('input', { type: 'range', class: 'sk-range', min: 0, max: 1, step: 1, value: 0, 'aria-label': str.timeline });
  range.addEventListener('input', () => ctrl.seekTime(Number(range.value)));
  const counter = h('span', { class: 'sk-counter', dir: 'ltr' });
  const caption = h('p', { class: 'sk-caption', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const pop = h('div', { class: 'sk-pop', role: 'dialog', 'aria-label': str.inspect, hidden: true });

  const controls = h('div', { class: 'sk-controls' }, restartBtn, backBtn, playBtn, fwdBtn, speedGroup, inspectBtn, counter);
  const root = h('div', { class: 'sk-stage', tabindex: 0, 'data-reduced': reduced ? 'true' : 'false' }, svg, pop, caption, range, controls);
  host.append(root);

  // ---- inspect popover
  let inspecting = false;
  const renderPop = (ev: SimEvent | undefined) => {
    pop.replaceChildren();
    if (!ev) return;
    const close = h('button', { type: 'button', class: 'sk-btn sk-btn--text' }, str.close);
    close.addEventListener('click', () => setInspect(false));
    const dl = h('dl', { class: 'sk-fields', dir: 'ltr' });
    for (const k of FIELD_ORDER) {
      const v = ev.fields[k];
      if (v === undefined) continue;
      dl.append(h('dt', {}, str.fields[k]), h('dd', {}, String(v)));
    }
    pop.append(h('strong', { class: 'sk-pop__title' }, `${str.kinds[ev.kind]}: `, h('span', { dir: 'ltr' }, ev.label)), dl, close);
  };
  const setInspect = (open: boolean) => {
    inspecting = open;
    pop.hidden = !open;
    inspectBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      renderPop(o.trace[ctrl.stepIndex]);
      (pop.querySelector('button') as HTMLElement | null)?.focus();
    } else if (pop.contains(document.activeElement)) inspectBtn.focus();
  };
  inspectBtn.addEventListener('click', () => setInspect(!inspecting));
  packetG.addEventListener('click', () => setInspect(true));
  packetG.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      setInspect(true);
    }
  });

  // ---- render
  let lastIdx = -1;
  const render = (st: PlaybackState) => {
    const sc = computeScene(o.trace, o.layout, st.index, st.progress);
    for (const [id, el] of nodeEls) el.classList.toggle('is-active', sc.activeNodes.includes(id));
    for (const el of linkEls.values()) el.classList.remove('is-active');
    if (sc.activeLink) linkEls.get([...sc.activeLink].sort().join('|'))?.classList.add('is-active');

    if (sc.packet && sc.event) {
      packetG.setAttribute('visibility', 'visible');
      packetG.setAttribute('transform', `translate(${sc.packet.x} ${sc.packet.y})`);
      packetG.setAttribute('class', `sk-packet sk-packet--${sc.packet.kind}`);
      packetG.setAttribute('aria-label', `${str.inspect}: ${str.kinds[sc.packet.kind]} ${sc.packet.label}`);
      packetPath.setAttribute('d', KIND_SHAPE[sc.packet.kind]);
      packetText.textContent = sc.packet.label;
    } else packetG.setAttribute('visibility', 'hidden');
    if (sc.drop) {
      dropG.setAttribute('visibility', 'visible');
      dropG.setAttribute('transform', `translate(${sc.drop.x} ${sc.drop.y - 34})`);
    } else dropG.setAttribute('visibility', 'hidden');

    tableLayer.replaceChildren();
    for (const [id, rows] of sc.tables) {
      const n = nodes.get(id);
      if (!n) continue;
      const x = n.x - 74;
      const y = n.y - 90;
      const w = 148;
      const g = s('g', { class: 'sk-table' }, s('rect', { x, y, width: w, height: 18 + rows.length * 16, class: 'sk-table__bg' }));
      g.append(s('text', { x: x + w / 2, y: y + 13, class: 'sk-table__title', 'text-anchor': 'middle' }, str.tableTitle));
      rows.forEach((r, i) => {
        const ry = y + 18 + i * 16;
        const rowG = s('g', { class: r.fresh ? 'sk-row is-fresh' : 'sk-row' });
        rowG.append(
          s('rect', { x: x + 2, y: ry, width: w - 4, height: 15, class: 'sk-row__bg' }),
          s('text', { x: x + 6, y: ry + 11, class: 'sk-row__text', direction: 'ltr' }, r.text),
        );
        g.append(rowG);
      });
      tableLayer.append(g);
    }

    // controls
    const label = st.playing ? str.pause : str.play;
    playBtn.setAttribute('aria-label', label);
    playBtn.title = label;
    playBtn.querySelector('path')?.setAttribute('d', st.playing ? PAUSE : PLAY);
    speedBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(SIM_SPEEDS[i] === st.speed)));
    range.max = String(Math.max(1, Math.round(st.totalMs)));
    range.value = String(Math.round(st.timeMs));
    range.setAttribute('aria-valuetext', str.stepOf(st.index + 1, st.stepCount));
    counter.textContent = `${st.index + 1} / ${st.stepCount}`;
    backBtn.disabled = st.timeMs <= 0;
    fwdBtn.disabled = st.ended;
    if (st.index !== lastIdx) {
      lastIdx = st.index;
      const ev = o.trace[st.index];
      caption.textContent = ev ? (o.caption?.(ev, st.index) ?? ev.note ?? '') : '';
      if (inspecting) renderPop(ev);
    }
  };
  const unsub = ctrl.subscribe(render);
  render(ctrl.getState());

  // ---- keyboard (stage-level; native controls keep their own keys)
  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape' && inspecting) {
      setInspect(false);
      return;
    }
    if (t instanceof HTMLButtonElement || t instanceof HTMLInputElement) return;
    const fwdKey = rtl() ? 'ArrowLeft' : 'ArrowRight';
    const backKey = rtl() ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === ' ') ctrl.toggle();
    else if (e.key === fwdKey) ctrl.stepForward();
    else if (e.key === backKey) ctrl.stepBack();
    else if (e.key === 'Home') ctrl.restart();
    else return;
    e.preventDefault();
  });

  if (o.autoplay) ctrl.play();
  return {
    element: root,
    controller: ctrl,
    inspect: (open = true) => setInspect(open),
    destroy() {
      unsub();
      ctrl.destroy();
      root.remove();
    },
  };
}
