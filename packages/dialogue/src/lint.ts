import { isMusicCue, isSceneMood } from '@tikshuv/core';
import { parseCondition, type Cond } from './condition.js';
import { PLACEHOLDER } from './interpolate.js';
import { DialogueSceneSchema, MAX_TEXT, NAME_BUDGET, type DialogueNode, type DialogueScene } from './schema.js';

export interface LintIssue {
  severity: 'error' | 'warning';
  code: string;
  nodeId?: string;
  message: string;
}

interface Edge {
  to: string;
  /** statically impossible to take */
  dead: boolean;
  label: string;
}

type Tri = boolean | null;

export interface LintOptions {
  /** flags set anywhere in the content (all scenes + flags.json registry). Flags outside this and the scene warn. */
  knownFlags?: Iterable<string>;
  /** when given, evidence ids (ev: atoms, evidence/inspect nodes, check.evidence/mustInspect) must be in it */
  evidenceIds?: Iterable<string>;
  thoughtIds?: Iterable<string>;
  questionIds?: Iterable<string>;
  deviceIds?: Iterable<string>;
}

/** Flags are runtime data (cross-scene, minigames, runner.setFlag): never statically false. */
function staticEval(c: Cond): Tri {
  switch (c.k) {
    case 'const': return c.v;
    case 'not': { const a = staticEval(c.a); return a === null ? null : !a; }
    case 'and': {
      const a = staticEval(c.a), b = staticEval(c.b);
      if (a === false || b === false) return false;
      return a === true && b === true ? true : null;
    }
    case 'or': {
      const a = staticEval(c.a), b = staticEval(c.b);
      if (a === true || b === true) return true;
      return a === false && b === false ? false : null;
    }
    default: return null;
  }
}

function walkAtoms(c: Cond, fn: (c: Cond) => void): void {
  fn(c);
  if (c.k === 'not') walkAtoms(c.a, fn);
  else if (c.k === 'and' || c.k === 'or') { walkAtoms(c.a, fn); walkAtoms(c.b, fn); }
}

/** Every flag a scene can set (for building the cross-scene registry). */
export function collectFlags(scene: DialogueScene): string[] {
  return scene.nodes.flatMap((n) => (n.type === 'set' ? [n.flag] : []));
}

export function lintText(text: string, nodeId: string, out: LintIssue[]): void {
  const budgeted = text.replace(PLACEHOLDER, (w, k: string) => (k === 'name' ? 'x'.repeat(NAME_BUDGET) : w));
  if ([...budgeted].length > MAX_TEXT) {
    out.push({ severity: 'error', code: 'text-too-long', nodeId, message: `text is ${[...budgeted].length} chars with a ${NAME_BUDGET}-char {name} (max ${MAX_TEXT})` });
  }
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m[1] !== 'name') out.push({ severity: 'error', code: 'bad-placeholder', nodeId, message: `unknown placeholder {${m[1] ?? ''}} (only {name} exists)` });
  }
  if (/[{}]/.test(text.replace(PLACEHOLDER, ''))) {
    out.push({ severity: 'error', code: 'bad-placeholder', nodeId, message: 'stray or unbalanced brace in text' });
  }
  const tags = [...text.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g)];
  let ltrDepth = 0;
  for (const t of tags) {
    const name = (t[2] ?? '').toLowerCase();
    if (name !== 'ltr' && name !== 'code') {
      out.push({ severity: 'error', code: 'bad-markup', nodeId, message: `markup <${name}> is not allowed (only <ltr> and <code>)` });
    } else if (name === 'ltr') {
      ltrDepth += t[1] ? -1 : 1;
      if (ltrDepth < 0 || ltrDepth > 1) break;
    }
  }
  if (ltrDepth !== 0) out.push({ severity: 'error', code: 'bad-markup', nodeId, message: 'unbalanced <ltr> tag' });
}

function textOf(n: DialogueNode): string[] {
  if (n.type === 'choice') return n.options.map((o) => o.text);
  if (n.type === 'line' || n.type === 'narration' || n.type === 'voice') return [n.text];
  return [];
}

export function lintScene(input: unknown, opts: LintOptions = {}): LintIssue[] {
  const parsed = DialogueSceneSchema.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      severity: 'error' as const,
      code: 'schema',
      message: `${i.path.join('.') || '(root)'}: ${i.message}`,
    }));
  }
  return lintParsed(parsed.data, opts);
}

/**
 * Lint every scene of a content set together: the flag registry is built from all scenes
 * (plus `extraFlags`, e.g. flags.json), so a flag set in another scene is not a dead branch.
 */
export function lintScenes(
  inputs: readonly unknown[],
  opts: LintOptions & { extraFlags?: Iterable<string> } = {},
): LintIssue[][] {
  const flags = new Set<string>([...(opts.knownFlags ?? []), ...(opts.extraFlags ?? [])]);
  for (const x of inputs) {
    const p = DialogueSceneSchema.safeParse(x);
    if (p.success) collectFlags(p.data).forEach((f) => flags.add(f));
  }
  return inputs.map((x) => lintScene(x, { ...opts, knownFlags: flags }));
}

const AUTO = new Set(['set', 'goto', 'branch', 'evidence', 'thought']);
const STATE_CHANGERS = new Set(['set', 'evidence', 'thought']);

export function lintParsed(scene: DialogueScene, opts: LintOptions = {}): LintIssue[] {
  const out: LintIssue[] = [];
  const err = (code: string, message: string, nodeId?: string) => out.push({ severity: 'error', code, message, ...(nodeId ? { nodeId } : {}) });
  const warn = (code: string, message: string, nodeId?: string) => out.push({ severity: 'warning', code, message, ...(nodeId ? { nodeId } : {}) });

  const byId = new Map<string, DialogueNode>();
  for (const n of scene.nodes) {
    if (byId.has(n.id)) err('duplicate-id', `duplicate node id "${n.id}"`, n.id);
    byId.set(n.id, n);
  }
  if (!byId.has(scene.start)) err('missing-start', `start node "${scene.start}" does not exist`);

  // scene-level mood and music (VOICE_BIBLE section 5, spec 04 cue list)
  if (scene.mood === undefined) warn('missing-scene-mood', 'scene declares no mood');
  else if (!isSceneMood(scene.mood)) err('unknown-mood', `scene mood "${scene.mood}" is not in the mood table`);
  if (scene.music === undefined) warn('missing-scene-music', 'scene declares no music cue');
  else if (!isMusicCue(scene.music)) err('unknown-music', `scene music "${scene.music}" is not a known mus_* cue`);

  const known = new Set<string>(collectFlags(scene));
  for (const f of opts.knownFlags ?? []) known.add(f);
  const evSet = opts.evidenceIds ? new Set(opts.evidenceIds) : null;
  const thSet = opts.thoughtIds ? new Set(opts.thoughtIds) : null;
  const qSet = opts.questionIds ? new Set(opts.questionIds) : null;
  const devSet = opts.deviceIds ? new Set(opts.deviceIds) : null;
  const needIn = (set: Set<string> | null, id: string, code: string, what: string, nodeId: string) => {
    if (set && !set.has(id)) err(code, `${what} "${id}" is not in the registry`, nodeId);
  };

  const evalReq = (src: string | undefined, nodeId: string): Tri => {
    if (src === undefined || src.trim() === '') return true;
    let cond: Cond;
    try {
      cond = parseCondition(src);
    } catch (e) {
      err('bad-condition', `condition "${src}": ${(e as Error).message}`, nodeId);
      return null;
    }
    walkAtoms(cond, (a) => {
      if (a.k === 'flag' && !known.has(a.name)) warn('unknown-flag', `flag "${a.name}" is never set in this scene or the known flags (typo, or add it to flags.json)`, nodeId);
      if (a.k === 'ev') needIn(evSet, a.id, 'unknown-evidence', 'evidence', nodeId);
      if (a.k === 'thought') needIn(thSet, a.id, 'unknown-thought', 'thought', nodeId);
    });
    return staticEval(cond);
  };

  const edges = new Map<string, Edge[]>();
  for (const n of scene.nodes) {
    const es: Edge[] = [];
    const add = (to: string | undefined, label: string, dead = false) => {
      if (to === undefined) return;
      if (!byId.has(to)) err('missing-target', `${label} points to missing node "${to}"`, n.id);
      else es.push({ to, dead, label });
    };
    switch (n.type) {
      case 'end': break;
      case 'goto': add(n.target, 'goto'); break;
      case 'choice': {
        n.options.forEach((o, i) => {
          const v = evalReq(o.requires, n.id);
          if (v === false) warn('dead-branch', `option ${i} can never be offered (requires "${o.requires ?? ''}" is always false)`, n.id);
          add(o.next, `option ${i}`, v === false);
        });
        if (n.options.every((_, i) => es.some((e) => e.label === `option ${i}` && e.dead))) {
          err('choice-no-exit', 'every option of this choice is impossible: the player is stuck', n.id);
        }
        break;
      }
      case 'check':
        if (n.onPass === n.onFail) warn('dead-branch', 'onPass and onFail lead to the same node: the check changes nothing', n.id);
        add(n.onPass, 'onPass');
        add(n.onFail, 'onFail');
        add(n.onBail, 'onBail');
        n.evidence.forEach((e) => needIn(evSet, e, 'unknown-evidence', 'evidence', n.id));
        n.mustInspect.forEach((e) => needIn(evSet, e, 'unknown-evidence', 'evidence', n.id));
        if (n.reasoning) needIn(qSet, n.reasoning, 'unknown-question', 'question', n.id);
        break;
      case 'branch': {
        let shadowed = false;
        n.cases.forEach((c, i) => {
          const v = evalReq(c.if, n.id);
          const dead = shadowed || v === false;
          if (dead) warn('dead-branch', `branch case ${i} ("${c.if}") can never fire${shadowed ? ' (an earlier case always matches)' : ''}`, n.id);
          if (v === true) shadowed = true;
          add(c.next, `case ${i}`, dead);
        });
        add(n.else, 'else', shadowed);
        if (shadowed) warn('dead-branch', 'else can never fire (a case is always true)', n.id);
        break;
      }
      case 'terminal':
        add(n.onDone, 'onDone');
        add(n.onGiveUp, 'onGiveUp');
        needIn(devSet, n.deviceId, 'unknown-device', 'device', n.id);
        break;
      case 'quiz':
        add(n.onRight, 'onRight');
        add(n.onWrong, 'onWrong');
        needIn(qSet, n.questionId, 'unknown-question', 'question', n.id);
        break;
      case 'inspect':
        needIn(evSet, n.evidenceId, 'unknown-evidence', 'evidence', n.id);
        if (!n.next) err('missing-next', 'inspect node has no "next"', n.id);
        else add(n.next, 'next');
        break;
      case 'evidence':
        needIn(evSet, n.evidenceId, 'unknown-evidence', 'evidence', n.id);
        if (!n.next) err('missing-next', 'evidence node has no "next"', n.id);
        else add(n.next, 'next');
        break;
      case 'thought':
        needIn(thSet, n.thoughtId, 'unknown-thought', 'thought', n.id);
        if (!n.next) err('missing-next', 'thought node has no "next"', n.id);
        else add(n.next, 'next');
        break;
      default:
        if (!n.next) err('missing-next', `${n.type} node has no "next"`, n.id);
        else add(n.next, 'next');
    }
    edges.set(n.id, es);
  }

  // text, speakers, mood
  for (const n of scene.nodes) {
    for (const t of textOf(n)) {
      lintText(t, n.id, out);
      if (/\p{Extended_Pictographic}/u.test(t)) err('emoji', 'emoji are not allowed in text (use SVG icons)', n.id);
    }
    if (n.type === 'line') {
      if (!(n.speaker in scene.speakers)) err('unknown-speaker', `speaker "${n.speaker}" is not declared in speakers`, n.id);
      if (!n.mood) warn('missing-mood', 'line has no mood', n.id);
    }
  }

  // reachability over live edges
  const reach = (from: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const id = stack.pop()!;
      for (const e of edges.get(id) ?? []) {
        if (!e.dead && !seen.has(e.to)) { seen.add(e.to); stack.push(e.to); }
      }
    }
    return seen;
  };
  const live = byId.has(scene.start) ? reach(scene.start) : new Set<string>();
  if (byId.has(scene.start)) live.add(scene.start);
  for (const n of scene.nodes) {
    if (!live.has(n.id)) err('unreachable', 'node is not reachable from start', n.id);
  }

  // every reachable node must be able to reach an end
  const ends = new Set(scene.nodes.filter((n) => n.type === 'end').map((n) => n.id));
  if (ends.size === 0) err('no-end', 'scene has no end node');
  for (const id of live) {
    if (ends.has(id)) continue;
    const r = reach(id);
    if (![...r].some((x) => ends.has(x))) {
      err(r.has(id) ? 'cycle-no-end' : 'dead-end', r.has(id) ? 'node is on a cycle that never reaches an end' : 'node cannot reach any end node', id);
    }
  }

  // cycles made only of automatic nodes never wait for the player and trip the runtime loop guard.
  // A red check is automatic once its outcome is recorded (it replays without a preview).
  const isAuto = (id: string): boolean => {
    const n = byId.get(id);
    return !!n && (AUTO.has(n.type) || (n.type === 'check' && n.color === 'red'));
  };
  for (const scc of autoSccs(scene, edges, isAuto)) {
    if (!scc.some((id) => live.has(id))) continue;
    const changes = scc.some((id) => STATE_CHANGERS.has(byId.get(id)?.type ?? ''));
    const msg = `automatic nodes form a cycle (${scc.join(' -> ')}) that never waits for the player`;
    if (changes) warn('auto-cycle-risk', `${msg}; it only ends if flags/evidence change inside it`, scc[0]);
    else err('auto-cycle', `${msg}: the runtime loop guard will throw`, scc[0]);
  }
  return out;
}

/** Strongly connected components (Tarjan) of the live graph restricted to automatic nodes; only real cycles. */
function autoSccs(scene: DialogueScene, edges: Map<string, Edge[]>, isAuto: (id: string) => boolean): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;
  const succ = (id: string) => (edges.get(id) ?? []).filter((e) => !e.dead && isAuto(e.to)).map((e) => e.to);
  const visit = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter++);
    stack.push(v);
    onStack.add(v);
    for (const w of succ(v)) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || succ(v).includes(v)) result.push(comp.reverse());
    }
  };
  for (const n of scene.nodes) if (isAuto(n.id) && !index.has(n.id)) visit(n.id);
  return result;
}

export const hasErrors = (issues: LintIssue[]): boolean => issues.some((i) => i.severity === 'error');
