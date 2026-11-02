/** Tiny safe condition DSL: flag:x (or flag:x>=2 for numeric flags), voice:logic>=2, ev:id, thought:id, true, false, ! && || ( ). No eval. */
import { VOICE_IDS } from '@tikshuv/core';
import type { VoiceId } from './schema.js';

export type Cond =
  | { k: 'flag'; name: string; op?: string; n?: number }
  | { k: 'voice'; voice: string; op: string; n: number }
  | { k: 'ev'; id: string }
  | { k: 'thought'; id: string }
  | { k: 'const'; v: boolean }
  | { k: 'not'; a: Cond }
  | { k: 'and' | 'or'; a: Cond; b: Cond };

export interface CondEnv {
  flags: Record<string, boolean | number>;
  voices: Partial<Record<VoiceId, number>>;
  evidence: ReadonlySet<string>;
  thoughts: ReadonlySet<string>;
}

const TOKEN = /\s*(&&|\|\||!|\(|\)|[a-z]+:[a-z0-9_]+(?:(?:>=|<=|==|>|<)\d+)?|true|false)/y;

export function parseCondition(src: string): Cond {
  const toks: string[] = [];
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m || m[1] === undefined) throw new Error(`bad condition syntax near "${src.slice(pos).trim()}"`);
    toks.push(m[1]);
    pos = TOKEN.lastIndex;
  }
  let i = 0;
  const peek = () => toks[i];
  const orExpr = (): Cond => {
    let a = andExpr();
    while (peek() === '||') {
      i++;
      a = { k: 'or', a, b: andExpr() };
    }
    return a;
  };
  const andExpr = (): Cond => {
    let a = unary();
    while (peek() === '&&') {
      i++;
      a = { k: 'and', a, b: unary() };
    }
    return a;
  };
  const unary = (): Cond => {
    const t = toks[i++];
    if (t === undefined) throw new Error('unexpected end of condition');
    if (t === '!') return { k: 'not', a: unary() };
    if (t === '(') {
      const e = orExpr();
      if (toks[i++] !== ')') throw new Error('missing ")"');
      return e;
    }
    if (t === 'true' || t === 'false') return { k: 'const', v: t === 'true' };
    const idx = t.indexOf(':');
    const kind = idx < 0 ? t : t.slice(0, idx);
    const rest = idx < 0 ? '' : t.slice(idx + 1);
    if (kind === 'flag') {
      const fm = /^([a-z0-9_]+?)(>=|<=|==|>|<)(\d+)$/.exec(rest);
      return fm ? { k: 'flag', name: fm[1] ?? '', op: fm[2] ?? '>=', n: Number(fm[3]) } : { k: 'flag', name: rest };
    }
    if (kind === 'ev') return { k: 'ev', id: rest };
    if (kind === 'thought') return { k: 'thought', id: rest };
    if (kind === 'voice') {
      const m = /^([a-z0-9_]+?)(>=|<=|==|>|<)(\d+)$/.exec(rest);
      if (!m) throw new Error(`voice atom needs a comparison: "${t}"`);
      const voice = m[1] ?? '';
      if (!(VOICE_IDS as readonly string[]).includes(voice)) throw new Error(`unknown voice "${voice}" in "${t}"`);
      return { k: 'voice', voice, op: m[2] ?? '>=', n: Number(m[3]) };
    }
    throw new Error(`unknown condition atom "${t}"`);
  };
  const out = orExpr();
  if (i < toks.length) throw new Error(`unexpected "${toks[i]}"`);
  return out;
}

function cmp(a: number, op: string, b: number): boolean {
  switch (op) {
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '<': return a < b;
    default: return a === b;
  }
}

export function evalCondition(c: Cond, env: CondEnv): boolean {
  switch (c.k) {
    case 'const': return c.v;
    case 'flag': {
      const v = env.flags[c.name];
      return c.op === undefined ? Boolean(v) : cmp(Number(v ?? 0), c.op, c.n ?? 0);
    }
    case 'ev': return env.evidence.has(c.id);
    case 'thought': return env.thoughts.has(c.id);
    case 'voice': return cmp(env.voices[c.voice as VoiceId] ?? 0, c.op, c.n);
    case 'not': return !evalCondition(c.a, env);
    case 'and': return evalCondition(c.a, env) && evalCondition(c.b, env);
    case 'or': return evalCondition(c.a, env) || evalCondition(c.b, env);
  }
}

/** Parse-and-eval convenience; undefined or empty means true. */
export function holds(src: string | undefined, env: CondEnv): boolean {
  if (src === undefined || src.trim() === '') return true;
  return evalCondition(parseCondition(src), env);
}
