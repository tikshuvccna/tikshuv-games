import type { AnswerValue, Question, Tier } from './schema.js';

/** Tier points (03: Q1-3 easy 10, Q4-6 medium 15, Q7-8 hard 20). */
export const TIER_POINTS: Record<Tier, number> = { easy: 10, medium: 15, hard: 20 };
export const HINT_FACTOR = 0.7; // hint costs 30 percent
export const RETRY_FACTOR = 0.5; // second attempt worth 50 percent

/** Tier by position when a question does not set one: first 3/8 easy, middle 3/8 medium, last 2/8 hard. */
export function defaultTier(index: number, total: number): Tier {
  const r = total <= 1 ? 0 : index / total;
  return r < 0.375 ? 'easy' : r < 0.75 ? 'medium' : 'hard';
}

/** Integer points for a correct answer. `attempt` is 1-based. */
export function pointsFor(tier: Tier, attempt: number, usedHint: boolean): number {
  let p = TIER_POINTS[tier];
  if (usedHint) p *= HINT_FACTOR;
  if (attempt >= 2) p *= RETRY_FACTOR;
  return Math.round(p);
}

const norm = (s: string, cs: boolean): string => {
  const t = s.trim().replace(/\s+/g, ' ');
  return cs ? t : t.toLowerCase();
};
const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && new Set(a).size === a.length && b.every((x) => a.includes(x));

/** Pure correctness check; wrong-shaped values are simply incorrect. */
export function isCorrect(q: Question, v: AnswerValue): boolean {
  switch (q.kind) {
    case 'mcq':
      return v === q.payload.correct;
    case 'tf':
      return v === q.payload.correct;
    case 'multi':
      return Array.isArray(v) && sameSet(v, q.payload.correct);
    case 'order':
      return Array.isArray(v) && v.length === q.payload.items.length && v.every((x, i) => x === q.payload.items[i]?.id);
    case 'match': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
      const rec = v as Record<string, string>;
      return q.payload.pairs.every((p) => rec[p.id] === p.id);
    }
    case 'fill':
    case 'cli': {
      if (typeof v !== 'string') return false;
      const cs = q.payload.caseSensitive;
      const got = norm(v, cs);
      return q.payload.accepted.some((a) => norm(a, cs) === got);
    }
  }
}
