import { describe, expect, it } from 'vitest';
import { createRng } from '@tikshuv/core';
import { defaultTier, isCorrect, pointsFor } from './grade.js';
import { parseQuestions, type Question } from './schema.js';
import { createQuizSession, restoreQuizSession } from './session.js';

const opt = (id: string) => ({ id, text: id });
const raw = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `q${i + 1}`,
    kind: 'mcq',
    promptKey: `p${i + 1}`,
    hintKey: 'h',
    whyKey: `w${i + 1}`,
    payload: { options: [opt('a'), opt('b'), opt('c')], correct: 'b' },
  }));
const qs8 = (): Question[] => parseQuestions(raw(8));
const session = (extra = {}) => createQuizSession({ questions: qs8(), rng: createRng(7), ...extra });

describe('schema', () => {
  it('parses every kind', () => {
    const all = parseQuestions([
      ...raw(1),
      { id: 'm', kind: 'multi', promptKey: 'p', whyKey: 'w', payload: { options: [opt('a'), opt('b')], correct: ['a', 'b'] } },
      { id: 't', kind: 'tf', promptKey: 'p', whyKey: 'w', payload: { correct: false } },
      { id: 'o', kind: 'order', promptKey: 'p', whyKey: 'w', payload: { items: [opt('x'), opt('y'), opt('z')] } },
      { id: 'x', kind: 'match', promptKey: 'p', whyKey: 'w', payload: { pairs: [{ id: 'p1', left: 'L1', right: 'R1' }, { id: 'p2', left: 'L2', right: 'R2' }] } },
      { id: 'f', kind: 'fill', promptKey: 'p', whyKey: 'w', payload: { accepted: ['192.168.1.1'] } },
      { id: 'c', kind: 'cli', promptKey: 'p', whyKey: 'w', payload: { accepted: ['show arp'] } },
    ]);
    expect(all.map((q) => q.kind)).toEqual(['mcq', 'multi', 'tf', 'order', 'match', 'fill', 'cli']);
  });
  it('rejects bad data', () => {
    expect(() => parseQuestions([{ ...raw(1)[0], payload: { options: [opt('a'), opt('b')], correct: 'z' } }])).toThrow();
    expect(() => parseQuestions([...raw(1), ...raw(1)])).toThrow();
    expect(() => parseQuestions([{ id: 'q', kind: 'nope' }])).toThrow();
    expect(() => parseQuestions([{ id: 'm', kind: 'multi', promptKey: 'p', whyKey: 'w', payload: { options: [opt('a'), opt('b')], correct: ['a', 'q'] } }])).toThrow();
  });
});

describe('scoring', () => {
  it('tier points table', () => {
    expect(pointsFor('easy', 1, false)).toBe(10);
    expect(pointsFor('medium', 1, false)).toBe(15);
    expect(pointsFor('hard', 1, false)).toBe(20);
    expect(pointsFor('easy', 1, true)).toBe(7);
    expect(pointsFor('hard', 1, true)).toBe(14);
    expect(pointsFor('easy', 2, false)).toBe(5);
    expect(pointsFor('medium', 2, false)).toBe(8);
    expect(pointsFor('hard', 2, false)).toBe(10);
    expect(pointsFor('hard', 2, true)).toBe(7);
  });
  it('default tiers for 8 questions', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => defaultTier(i, 8))).toEqual([
      'easy', 'easy', 'easy', 'medium', 'medium', 'medium', 'hard', 'hard',
    ]);
    expect(defaultTier(0, 1)).toBe('easy');
  });
});

describe('grading', () => {
  const [mcq] = parseQuestions(raw(1));
  it('mcq / tf', () => {
    expect(isCorrect(mcq as Question, 'b')).toBe(true);
    expect(isCorrect(mcq as Question, 'a')).toBe(false);
    const [tf] = parseQuestions([{ id: 't', kind: 'tf', promptKey: 'p', whyKey: 'w', payload: { correct: false } }]);
    expect(isCorrect(tf as Question, false)).toBe(true);
    expect(isCorrect(tf as Question, true)).toBe(false);
  });
  it('multi, order, match', () => {
    const [m, o, x] = parseQuestions([
      { id: 'm', kind: 'multi', promptKey: 'p', whyKey: 'w', payload: { options: [opt('a'), opt('b'), opt('c')], correct: ['a', 'b'] } },
      { id: 'o', kind: 'order', promptKey: 'p', whyKey: 'w', payload: { items: [opt('x'), opt('y')] } },
      { id: 'x', kind: 'match', promptKey: 'p', whyKey: 'w', payload: { pairs: [{ id: 'p1', left: 'L1', right: 'R1' }, { id: 'p2', left: 'L2', right: 'R2' }] } },
    ]) as [Question, Question, Question];
    expect(isCorrect(m, ['b', 'a'])).toBe(true);
    expect(isCorrect(m, ['a'])).toBe(false);
    expect(isCorrect(m, ['a', 'a'])).toBe(false);
    expect(isCorrect(m, 'a')).toBe(false);
    expect(isCorrect(o, ['x', 'y'])).toBe(true);
    expect(isCorrect(o, ['y', 'x'])).toBe(false);
    expect(isCorrect(o, 'x')).toBe(false);
    expect(isCorrect(x, { p1: 'p1', p2: 'p2' })).toBe(true);
    expect(isCorrect(x, { p1: 'p2', p2: 'p1' })).toBe(false);
    expect(isCorrect(x, ['p1'])).toBe(false);
    expect(isCorrect(x, 'p1')).toBe(false);
  });
  it('fill/cli normalise whitespace and case unless caseSensitive', () => {
    const [f, c] = parseQuestions([
      { id: 'f', kind: 'fill', promptKey: 'p', whyKey: 'w', payload: { accepted: ['AA-BB-CC'] } },
      { id: 'c', kind: 'cli', promptKey: 'p', whyKey: 'w', payload: { accepted: ['show  ip route'], caseSensitive: true } },
    ]) as [Question, Question];
    expect(isCorrect(f, '  aa-bb-cc ')).toBe(true);
    expect(isCorrect(f, 'aa-bb')).toBe(false);
    expect(isCorrect(f, true)).toBe(false);
    expect(isCorrect(c, 'show ip route')).toBe(true);
    expect(isCorrect(c, 'Show ip route')).toBe(false);
  });
});

describe('QuizSession', () => {
  it('first-try correct, attempt rules, why only when finished', () => {
    const s = session();
    const v = s.current()!;
    expect(v.tier).toBe('easy');
    expect(v.displayOrder.slice().sort()).toEqual(['a', 'b', 'c']);
    const wrong = s.submit('a');
    expect(wrong).toMatchObject({ correct: false, done: false, attemptsLeft: 1 });
    expect(wrong.whyKey).toBeUndefined();
    expect(s.current()!.potentialPoints).toBe(5);
    const ok = s.submit('b');
    expect(ok).toMatchObject({ correct: true, points: 5, done: true, whyKey: 'w1' });
    expect(() => s.submit('b')).toThrow();
    s.next();
    expect(s.current()!.attempt).toBe(1);
  });
  it('hint costs 30 percent; no hint key means no penalty; hint after done ignored', () => {
    const s = session();
    expect(s.useHint()).toBe('h');
    expect(s.current()!.hintUsed).toBe(true);
    expect(s.submit('b').points).toBe(7);
    expect(s.useHint()).toBeUndefined();
    const noHint = createQuizSession({ questions: parseQuestions([{ ...raw(1)[0], hintKey: undefined }]), rng: createRng(1) });
    expect(noHint.useHint()).toBeUndefined();
    expect(noHint.current()!.hintUsed).toBe(false);
  });
  it('two wrong attempts reveal, zero points; next requires finish', () => {
    const s = session();
    expect(() => s.next()).toThrow();
    s.submit('a');
    const r = s.submit('c');
    expect(r).toMatchObject({ correct: false, done: true, revealed: true, points: 0, whyKey: 'w1' });
  });
  it('full run: pass rule, score, summary', () => {
    const s = session();
    // answer first 5 right on first try, last 3 wrong twice
    for (let i = 0; i < 8; i++) {
      if (i < 5) s.submit('b');
      else {
        s.submit('a');
        s.submit('a');
      }
      s.next();
    }
    expect(s.finished).toBe(true);
    expect(s.current()).toBeNull();
    expect(() => s.submit('b')).toThrow();
    s.next(); // no-op past the end
    const sum = s.summary();
    expect(sum.correctCount).toBe(5);
    expect(sum.score).toBe(3 * 10 + 2 * 15);
    expect(sum.maxScore).toBe(3 * 10 + 3 * 15 + 2 * 20);
    expect(sum.passed).toBe(true);
    expect(sum.results[7]).toMatchObject({ tier: 'hard', revealed: true });
  });
  it('configurable pass mark and attempts', () => {
    const s = session({ passMark: 8, maxAttempts: 1 });
    expect(s.submit('a')).toMatchObject({ done: true, revealed: true });
    s.next();
    s.submit('b');
    expect(s.summary().passed).toBe(false);
    expect(s.summary().passMark).toBe(8);
  });
  it('explicit tier overrides position', () => {
    const s = createQuizSession({ questions: parseQuestions([{ ...raw(1)[0], tier: 'hard' }]), rng: createRng(1) });
    expect(s.submit('b').points).toBe(20);
  });
  it('shuffle is deterministic by seed, never solved-at-start for order, optional', () => {
    const order = parseQuestions([{ id: 'o', kind: 'order', promptKey: 'p', whyKey: 'w', payload: { items: [opt('x'), opt('y'), opt('z')] } }]);
    for (let seed = 1; seed < 30; seed++) {
      const v = createQuizSession({ questions: order, rng: createRng(seed) }).current()!;
      expect(v.displayOrder).not.toEqual(['x', 'y', 'z']);
    }
    const a = createQuizSession({ questions: qs8(), rng: createRng(3) }).current()!.displayOrder;
    const b = createQuizSession({ questions: qs8(), rng: createRng(3) }).current()!.displayOrder;
    expect(a).toEqual(b);
    expect(createQuizSession({ questions: qs8(), rng: createRng(3), shuffle: false }).current()!.displayOrder).toEqual(['a', 'b', 'c']);
  });
  it('match keeps left column, shuffles right', () => {
    const m = parseQuestions([{ id: 'x', kind: 'match', promptKey: 'p', whyKey: 'w', payload: { pairs: [{ id: 'p1', left: 'L1', right: 'R1' }, { id: 'p2', left: 'L2', right: 'R2' }, { id: 'p3', left: 'L3', right: 'R3' }] } }]);
    const v = createQuizSession({ questions: m, rng: createRng(5) }).current()!;
    expect(v.displayOrder).toEqual(['p1', 'p2', 'p3']);
    expect(v.rightOrder.slice().sort()).toEqual(['p1', 'p2', 'p3']);
  });
  it('tf/fill have empty display orders', () => {
    const f = parseQuestions([{ id: 'f', kind: 'fill', promptKey: 'p', whyKey: 'w', payload: { accepted: ['x'] } }]);
    expect(createQuizSession({ questions: f, rng: createRng(1) }).current()!.displayOrder).toEqual([]);
  });
});

describe('snapshot / restore', () => {
  const opts = () => ({ questions: qs8(), rng: createRng(99) });
  it('round-trips through JSON mid-question', () => {
    const s = createQuizSession(opts());
    s.submit('b');
    s.next();
    s.useHint();
    s.submit('a');
    const snap = JSON.parse(JSON.stringify(s.snapshot()));
    const r = restoreQuizSession({ ...opts(), rng: createRng(1234) }, snap);
    expect(r.current()).toEqual(s.current());
    expect(r.summary()).toEqual(s.summary());
    expect(r.submit('b')).toMatchObject({ correct: true, points: 4 }); // q2 easy: 10*0.7*0.5=3.5 rounds to 4
    expect(s.submit('b')).toMatchObject({ points: 4 });
  });
  it('snapshot between submit and next resumes on the next question', () => {
    const s = createQuizSession(opts());
    s.submit('b');
    const r = restoreQuizSession(opts(), s.snapshot());
    expect(r.current()!.index).toBe(1);
    expect(r.current()!.attempt).toBe(1);
  });
  it('rejects a snapshot from a different question set', () => {
    const snap = createQuizSession(opts()).snapshot();
    expect(() => restoreQuizSession({ questions: parseQuestions(raw(3)), rng: createRng(1) }, snap)).toThrow();
    expect(() => restoreQuizSession({ questions: qs8().reverse(), rng: createRng(1) }, snap)).toThrow();
  });
});
