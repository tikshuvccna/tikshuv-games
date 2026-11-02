import type { Rng } from '@tikshuv/core';
import { defaultTier, isCorrect, pointsFor, TIER_POINTS } from './grade.js';
import type { AnswerValue, Question, Tier } from './schema.js';

export interface QuizOptions {
  questions: readonly Question[];
  rng: Rng;
  /** Correct answers needed to pass. Default 5 (of 8). */
  passMark?: number;
  /** Attempts per question. Default 2; the answer is revealed after the last wrong one. */
  maxAttempts?: number;
  /** Shuffle option/item display order (never changes grading). Default true. */
  shuffle?: boolean;
}

export interface QuestionResult {
  questionId: string;
  tier: Tier;
  correct: boolean;
  attempts: number;
  usedHint: boolean;
  revealed: boolean;
  points: number;
}

export interface SubmitResult {
  correct: boolean;
  points: number;
  /** True when the question is finished (correct, or out of attempts). */
  done: boolean;
  attemptsLeft: number;
  /** True when attempts ran out; the UI should show the right answer. */
  revealed: boolean;
  /** Explanation key; present only once the question is finished (does not spoil a retry). */
  whyKey?: string;
}

export interface QuestionView {
  question: Question;
  index: number;
  total: number;
  tier: Tier;
  attempt: number;
  hintUsed: boolean;
  /** Display order of option/item/pair ids (shuffled; empty for tf/fill/cli). */
  displayOrder: string[];
  /** Display order of match right-hand column (pair ids). */
  rightOrder: string[];
  /** Points a correct answer would earn right now. */
  potentialPoints: number;
}

export interface QuizSummary {
  results: QuestionResult[];
  correctCount: number;
  total: number;
  score: number;
  maxScore: number;
  passMark: number;
  passed: boolean;
}

export interface QuizSnapshot {
  v: 1;
  questionIds: string[];
  index: number;
  /** Per-question display orders so a resumed quiz looks identical. */
  orders: Record<string, { main: string[]; right: string[] }>;
  results: QuestionResult[];
  current: { attempt: number; hintUsed: boolean };
}

export interface QuizSession {
  readonly finished: boolean;
  current(): QuestionView | null;
  /** Marks the hint as used (-30%). Returns the hint key, or undefined if the question has none. */
  useHint(): string | undefined;
  submit(value: AnswerValue): SubmitResult;
  /** Move on after a finished question. Throws if the current question is unfinished. */
  next(): void;
  summary(): QuizSummary;
  snapshot(): QuizSnapshot;
}

function ids(q: Question): { main: string[]; right: string[] } {
  switch (q.kind) {
    case 'mcq':
    case 'multi':
      return { main: q.payload.options.map((o) => o.id), right: [] };
    case 'order':
      return { main: q.payload.items.map((o) => o.id), right: [] };
    case 'match': {
      const p = q.payload.pairs.map((x) => x.id);
      return { main: p, right: p };
    }
    default:
      return { main: [], right: [] };
  }
}

function shuffled(rng: Rng, list: string[], avoidIdentity: boolean): string[] {
  let out = rng.shuffle(list);
  for (let i = 0; avoidIdentity && list.length > 1 && i < 5 && out.every((x, k) => x === list[k]); i++) out = rng.shuffle(list);
  return out;
}

export function createQuizSession(opts: QuizOptions, restoreFrom?: QuizSnapshot): QuizSession {
  const qs = opts.questions;
  const total = qs.length;
  const passMark = opts.passMark ?? 5;
  const maxAttempts = opts.maxAttempts ?? 2;
  const doShuffle = opts.shuffle ?? true;

  if (restoreFrom) {
    const same =
      restoreFrom.v === 1 && restoreFrom.questionIds.length === total && qs.every((q, i) => q.id === restoreFrom.questionIds[i]);
    if (!same) throw new Error('quiz snapshot does not match the question set');
  }

  const orders: Record<string, { main: string[]; right: string[] }> = restoreFrom ? { ...restoreFrom.orders } : {};
  for (const q of qs) {
    if (orders[q.id]) continue;
    const base = ids(q);
    // `order` questions must not be shown already solved; match left column stays authored, right column shuffles.
    orders[q.id] = doShuffle
      ? {
          main: q.kind === 'match' ? base.main : shuffled(opts.rng, base.main, q.kind === 'order'),
          right: shuffled(opts.rng, base.right, true),
        }
      : base;
  }

  const results: QuestionResult[] = restoreFrom ? restoreFrom.results.map((r) => ({ ...r })) : [];
  let index = restoreFrom ? restoreFrom.index : results.length;
  let attempt = restoreFrom ? restoreFrom.current.attempt : 1;
  let hintUsed = restoreFrom ? restoreFrom.current.hintUsed : false;
  if (index < results.length) {
    // snapshot taken between submit() and next(): resume on the following question
    index = results.length;
    attempt = 1;
    hintUsed = false;
  }

  const tierOf = (i: number): Tier => qs[i]?.tier ?? defaultTier(i, total);
  const isDone = (): boolean => results.length > index; // current question already has a recorded result

  const session: QuizSession = {
    get finished() {
      return index >= total;
    },
    current() {
      const q = qs[index];
      if (!q) return null;
      const o = orders[q.id] ?? { main: [], right: [] };
      const tier = tierOf(index);
      return {
        question: q,
        index,
        total,
        tier,
        attempt,
        hintUsed,
        displayOrder: [...o.main],
        rightOrder: [...o.right],
        potentialPoints: pointsFor(tier, attempt, hintUsed),
      };
    },
    useHint() {
      const q = qs[index];
      if (!q || isDone()) return undefined;
      if (q.hintKey) hintUsed = true;
      return q.hintKey;
    },
    submit(value) {
      const q = qs[index];
      if (!q) throw new Error('quiz is finished');
      if (isDone()) throw new Error('question already answered; call next()');
      const tier = tierOf(index);
      const correct = isCorrect(q, value);
      const finalWrong = !correct && attempt >= maxAttempts;
      if (!correct && !finalWrong) {
        attempt += 1;
        return { correct: false, points: 0, done: false, attemptsLeft: maxAttempts - attempt + 1, revealed: false };
      }
      const points = correct ? pointsFor(tier, attempt, hintUsed) : 0;
      results.push({ questionId: q.id, tier, correct, attempts: attempt, usedHint: hintUsed, revealed: finalWrong, points });
      return { correct, points, done: true, attemptsLeft: 0, revealed: finalWrong, whyKey: q.whyKey };
    },
    next() {
      if (index >= total) return;
      if (!isDone()) throw new Error('current question is not finished');
      index += 1;
      attempt = 1;
      hintUsed = false;
    },
    summary() {
      const correctCount = results.filter((r) => r.correct).length;
      return {
        results: results.map((r) => ({ ...r })),
        correctCount,
        total,
        score: results.reduce((s, r) => s + r.points, 0),
        maxScore: qs.reduce((s, _q, i) => s + TIER_POINTS[tierOf(i)], 0),
        passMark,
        passed: correctCount >= passMark,
      };
    },
    snapshot() {
      return {
        v: 1,
        questionIds: qs.map((q) => q.id),
        index,
        orders: JSON.parse(JSON.stringify(orders)) as QuizSnapshot['orders'],
        results: results.map((r) => ({ ...r })),
        current: { attempt, hintUsed },
      };
    },
  };
  return session;
}

/** Rebuild a session from a snapshot (JSON round-trip safe). Throws if the question set changed. */
export function restoreQuizSession(opts: QuizOptions, snap: QuizSnapshot): QuizSession {
  return createQuizSession(opts, snap);
}
