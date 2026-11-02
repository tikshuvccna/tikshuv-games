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

function staticEval(c: Cond, settable: Set<string>): Tri {
  switch (c.k) {
    case 'const': return c.v;
    case 'flag': return settable.has(c.name) ? null : false;
    case 'not': { const a = staticEval(c.a, settable); return a === null ? null : !a; }
    case 'and': {
      const a = staticEval(c.a, settable), b = staticEval(c.b, settable);
      if (a === false || b === false) return false;
      return a === true && b === true ? true : null;
    }
    case 'or': {
      const a = staticEval(c.a, settable), b = staticEval(c.b, settable);
      if (a === true || b === true) return true;
      return a === false && b === false ? false : null;
    }
    default: return null;
  }
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

export function lintScene(input: unknown): LintIssue[] {
  const parsed = DialogueSceneSchema.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      severity: 'error' as const,
      code: 'schema',
      message: `${i.path.join('.') || '(root)'}: ${i.message}`,
    }));
  }
  return lintParsed(parsed.data);
}

export function lintParsed(scene: DialogueScene): LintIssue[] {
  const out: LintIssue[] = [];
  const err = (code: string, message: string, nodeId?: string) => out.push({ severity: 'error', code, message, ...(nodeId ? { nodeId } : {}) });
  const warn = (code: string, message: string, nodeId?: string) => out.push({ severity: 'warning', code, message, ...(nodeId ? { nodeId } : {}) });

  const byId = new Map<string, DialogueNode>();
  for (const n of scene.nodes) {
    if (byId.has(n.id)) err('duplicate-id', `duplicate node id "${n.id}"`, n.id);
    byId.set(n.id, n);
  }
  if (!byId.has(scene.start)) err('missing-start', `start node "${scene.start}" does not exist`);

  const settable = new Set<string>();
  for (const n of scene.nodes) if (n.type === 'set') settable.add(n.flag);

  const evalReq = (src: string | undefined, nodeId: string): Tri => {
    if (src === undefined || src.trim() === '') return true;
    try {
      return staticEval(parseCondition(src), settable);
    } catch (e) {
      err('bad-condition', `condition "${src}": ${(e as Error).message}`, nodeId);
      return null;
    }
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
          if (v === false) warn('dead-branch', `option ${i} can never be offered (requires "${o.requires ?? ''}"; flag is never set in this scene)`, n.id);
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
      default:
        if (!n.next) err('missing-next', `${n.type} node has no "next"`, n.id);
        else add(n.next, 'next');
    }
    edges.set(n.id, es);
  }

  // text, speakers, mood
  for (const n of scene.nodes) {
    for (const t of textOf(n)) lintText(t, n.id, out);
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
  return out;
}

export const hasErrors = (issues: LintIssue[]): boolean => issues.some((i) => i.severity === 'error');
