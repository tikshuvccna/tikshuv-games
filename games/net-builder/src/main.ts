import { createRng } from '@tikshuv/core';
import { Sim, linkCost, type SimEvent } from './engine';
import { LEVELS, WORLD, type LevelDef } from './levels';
import { KIND_LABEL, draw, linkAt, nodeAt, type View } from './render';
import './styles.css';

const STORE_KEY = 'nb.progress.v1';
type Progress = Record<string, number>;

function loadProgress(): Progress {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Progress;
  } catch {
    return {};
  }
}

function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* private mode: progress simply is not remembered */
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls = '', text = '', kids: (Node | null)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  for (const k of kids) if (k) e.append(k);
  return e;
}

const app = document.getElementById('app') as HTMLElement;
let progress = loadProgress();
let stop: (() => void) | null = null;

function show(...nodes: Node[]): void {
  stop?.();
  stop = null;
  app.replaceChildren(...nodes);
}

const stars = (n: number): string => '★'.repeat(n) + '☆'.repeat(3 - n);
const unlocked = (i: number): boolean => i === 0 || (progress[LEVELS[i - 1]?.id ?? ''] ?? 0) >= 1;

function menu(): void {
  const cards = LEVELS.map((l, i) => {
    const open = unlocked(i);
    const b = el('button', `nb-card${open ? '' : ' locked'}`, '', [
      el('span', 'nb-card-n', String(i + 1)),
      el('span', 'nb-card-t', l.title),
      el('span', 'nb-card-s', l.topology),
      el('span', 'nb-card-stars', open ? stars(progress[l.id] ?? 0) : 'נעול: סיימו את השלב הקודם'),
    ]);
    b.disabled = !open;
    b.onclick = () => intro(l, i);
    return b;
  });
  show(el('main', 'nb-menu', '', [
    el('h1', '', 'בונה הרשת'),
    el('p', 'nb-sub', 'בנו רשת, שמרו אותה חיה, ולמדו איך הטופולוגיות עובדות.'),
    el('div', 'nb-cards', '', cards),
    el('p', 'nb-foot', 'סקיצה ראשונה לבדיקה. העיצוב והתוכן עדיין בעבודה.'),
  ]));
}

function intro(level: LevelDef, idx: number): void {
  const go = el('button', 'nb-btn primary', 'מתחילים');
  go.onclick = () => play(level, idx);
  const back = el('button', 'nb-btn', 'חזרה');
  back.onclick = menu;
  show(el('main', 'nb-panel', '', [
    el('div', 'nb-tag', `שלב ${idx + 1} · ${level.topology}`),
    el('h2', '', level.title),
    ...level.intro.map((t) => el('p', '', t)),
    el('p', 'nb-goal', `המטרה: ${level.goal}`),
    el('ul', 'nb-tips', '', [
      el('li', '', 'גררו מהתקן להתקן כדי למתוח כבל. כבל ארוך יותר עולה יותר.'),
      el('li', '', 'לחצו על כבל כדי להסיר אותו (מקבלים את הכסף בחזרה). כבל קרוע מתקנים בלחיצה.'),
      el('li', '', 'מחשב חדש שמופיע מהבהב בצהוב עד שמחברים אותו.'),
    ]),
    el('div', 'nb-row', '', [back, go]),
  ]));
}

function play(level: LevelDef, idx: number): void {
  const sim = new Sim(level, createRng(`${level.id}-${Date.now()}`));
  const canvas = el('canvas', 'nb-canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = WORLD.w * dpr;
  canvas.height = WORLD.h * dpr;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  const timeEl = el('span', 'nb-stat', '');
  const okEl = el('span', 'nb-stat', '');
  const budEl = el('span', 'nb-stat', '');
  const bar = el('div', 'nb-bar-fill');
  const toasts = el('div', 'nb-toasts');
  const actions = el('div', 'nb-actions');
  let paused = false;
  let speed = 1;

  const pauseBtn = el('button', 'nb-icon', '⏸');
  const speedBtn = el('button', 'nb-icon', '×1');
  pauseBtn.onclick = () => { paused = !paused; pauseBtn.textContent = paused ? '▶' : '⏸'; };
  speedBtn.onclick = () => { speed = speed === 1 ? 2 : 1; speedBtn.textContent = `×${speed}`; };
  const quit = el('button', 'nb-icon', '✕');
  quit.onclick = menu;

  show(el('main', 'nb-play', '', [
    el('header', 'nb-hud', '', [
      el('b', 'nb-title', level.title), timeEl, okEl, budEl, pauseBtn, speedBtn, quit,
    ]),
    el('div', 'nb-bar', '', [bar]),
    el('div', 'nb-stage', '', [canvas, toasts]),
    actions,
  ]));

  const view: View = { selectedLink: null, selectedNode: null, hover: null, drag: null, clock: 0 };
  const toast = (msg: string, kind = ''): void => {
    const t = el('div', `nb-toast ${kind}`, msg);
    toasts.append(t);
    setTimeout(() => t.remove(), 3200);
    while (toasts.childElementCount > 3) toasts.firstElementChild?.remove();
  };

  const world = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * WORLD.w) / r.width, y: ((e.clientY - r.top) * WORLD.h) / r.height };
  };

  const refreshActions = (): void => {
    actions.replaceChildren();
    const n = view.selectedNode ? sim.node(view.selectedNode) : null;
    const l = view.selectedLink ? sim.links.find((x) => x.id === view.selectedLink) : null;
    if (n && n.kind === 'hub' && level.upgradeCost !== null) {
      const b = el('button', 'nb-btn primary', `שדרוג הרכזת למתג (${level.upgradeCost} יח׳)`);
      b.onclick = () => {
        const r = sim.upgrade(n.id);
        if (r.ok) toast('שדרגתם למתג: עכשיו כל שיחה עוברת רק אל היעד שלה.', 'good');
        else toast('אין מספיק כסף לשדרוג.', 'bad');
        view.selectedNode = null; refreshActions();
      };
      actions.append(b);
    } else if (n && n.kind === 'hub') {
      actions.append(el('span', 'nb-hint', 'רכזת: שולחת כל הודעה לכל הפורטים, ולכן כולם חולקים קו אחד.'));
    } else if (n && n.kind === 'switch') {
      actions.append(el('span', 'nb-hint', 'מתג: מעביר הודעה רק לפורט של היעד, וכמה שיחות עוברות יחד.'));
    } else if (l && !l.cut) {
      const b = el('button', 'nb-btn', `הסרת הכבל (החזר ${l.cost} יח׳)`);
      b.onclick = () => { sim.removeLink(l.id); view.selectedLink = null; refreshActions(); };
      actions.append(b);
    } else {
      actions.append(el('span', 'nb-hint', level.goal));
    }
  };
  refreshActions();

  let downNode: string | null = null;
  canvas.onpointerdown = (e) => {
    const p = world(e);
    const n = nodeAt(sim, p.x, p.y);
    canvas.setPointerCapture(e.pointerId);
    if (n) {
      downNode = n.id;
      view.drag = { from: n.id, x: p.x, y: p.y, ok: false, cost: 0 };
    }
  };
  canvas.onpointermove = (e) => {
    const p = world(e);
    const over = nodeAt(sim, p.x, p.y);
    view.hover = over?.id ?? null;
    if (!view.drag) return;
    view.drag.x = over ? over.x : p.x;
    view.drag.y = over ? over.y : p.y;
    const from = sim.node(view.drag.from);
    if (over && from && over.id !== from.id && !sim.linkBetween(from.id, over.id)) {
      const { cost } = linkCost(from, over);
      view.drag.cost = cost;
      view.drag.ok = cost <= sim.budgetLeft;
    } else {
      view.drag.cost = 0;
      view.drag.ok = false;
    }
  };
  canvas.onpointerup = (e) => {
    const p = world(e);
    const dragged = view.drag;
    view.drag = null;
    const target = nodeAt(sim, p.x, p.y);
    if (dragged && target && target.id !== dragged.from) {
      const r = sim.addLink(dragged.from, target.id);
      if (!r.ok) {
        const why = { budget: 'אין מספיק כסף לכבל הזה.', duplicate: 'כבר יש כבל כזה.', self: '', missing: '', locked: '' }[r.reason];
        if (why) toast(why, 'bad');
      }
      view.selectedNode = null; view.selectedLink = null;
    } else if (downNode && target && target.id === downNode) {
      view.selectedNode = view.selectedNode === target.id ? null : target.id;
      view.selectedLink = null;
    } else {
      const l = linkAt(sim, p.x, p.y);
      if (l?.cut) {
        sim.startRepair(l.id);
        view.selectedLink = null;
      } else {
        view.selectedLink = l && view.selectedLink !== l.id ? l.id : null;
      }
      view.selectedNode = null;
    }
    downNode = null;
    refreshActions();
  };
  canvas.onpointercancel = () => { view.drag = null; downNode = null; };

  const onEvent = (e: SimEvent): void => {
    if (e.type === 'appeared') toast(`${e.node.label} הצטרף לרשת. חברו אותו!`, 'info');
    else if (e.type === 'cut') toast('כבל נקרע! לחצו עליו כדי לתקן.', 'bad');
    else if (e.type === 'repaired') toast('הכבל תוקן.', 'good');
  };

  let last = performance.now();
  let raf = 0;
  let ended = false;
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    view.clock += dt;
    if (!paused && !ended) {
      const steps = speed;
      for (let i = 0; i < steps; i++) sim.step(dt);
      for (const ev of sim.drain()) onEvent(ev);
    }
    const r = sim.result();
    const left = Math.max(0, Math.ceil(level.duration - sim.time));
    timeEl.textContent = `זמן ${left}`;
    okEl.textContent = `הגיעו ${sim.stats.delivered} · אבדו ${sim.stats.lost}`;
    budEl.textContent = `תקציב כבלים ${sim.budgetLeft}`;
    bar.style.width = `${Math.min(100, (sim.time / level.duration) * 100)}%`;
    bar.dataset.ok = String(r.ratio >= level.stars[0]);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, sim, view);
    if (sim.finished && !ended) {
      ended = true;
      setTimeout(() => result(level, idx, sim), 500);
    }
    raf = requestAnimationFrame(frame);
  };
  const onVis = (): void => { if (document.hidden) { paused = true; pauseBtn.textContent = '▶'; } };
  document.addEventListener('visibilitychange', onVis);
  raf = requestAnimationFrame(frame);
  stop = () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); };
  (window as unknown as { __nb: unknown }).__nb = { sim, view };
}

function result(level: LevelDef, idx: number, sim: Sim): void {
  const r = sim.result();
  const prev = progress[level.id] ?? 0;
  if (r.stars > prev) {
    progress = { ...progress, [level.id]: r.stars };
    saveProgress(progress);
  }
  const retry = el('button', 'nb-btn', 'שחקו שוב');
  retry.onclick = () => play(level, idx);
  const back = el('button', 'nb-btn', 'לתפריט');
  back.onclick = menu;
  const next = LEVELS[idx + 1];
  const nextBtn = el('button', 'nb-btn primary', 'לשלב הבא');
  nextBtn.onclick = () => (next ? intro(next, idx + 1) : menu());

  const checkBox = el('div', 'nb-check');
  const q = level.check;
  checkBox.append(el('h3', '', 'בדיקת הבנה'), el('p', '', q.q));
  const fb = el('p', 'nb-fb');
  const opts = q.options.map((o, i) => {
    const b = el('button', 'nb-opt', o);
    b.onclick = () => {
      opts.forEach((x, j) => { x.disabled = true; x.classList.toggle('right', j === q.correct); });
      if (i !== q.correct) b.classList.add('wrong');
      fb.textContent = `${i === q.correct ? 'נכון! ' : 'כמעט. '}${q.explain}`;
    };
    return b;
  });
  checkBox.append(...opts, fb);

  show(el('main', 'nb-panel', '', [
    el('div', 'nb-tag', r.stars > 0 ? 'השלב הושלם' : 'הרשת לא עמדה בעומס'),
    el('div', 'nb-big-stars', stars(r.stars)),
    el('p', '', `הגיעו ליעד ${sim.stats.delivered} הודעות, אבדו ${sim.stats.lost}. התנגשויות: ${sim.stats.collisions}. תקלות כבל: ${sim.stats.cuts}.`),
    el('p', 'nb-goal', level.takeaway),
    checkBox,
    el('div', 'nb-row', '', [back, retry, r.stars > 0 ? nextBtn : null]),
  ]));
  void KIND_LABEL;
}

menu();
