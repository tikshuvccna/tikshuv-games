import { describe, expect, it } from 'vitest';
import {
  DialogueRunner, DialogueSceneSchema, hasErrors, holds, interpolate, lintScene, parseCondition,
  type DialogueEvent, type DialogueScene,
} from './index.js';

const sample = (over: Record<string, unknown> = {}): DialogueScene =>
  DialogueSceneSchema.parse({
    schema: 1,
    id: 'demo',
    speakers: { rishon: { nameKey: 'c1.rishon' } },
    start: 'n1',
    nodes: [
      { id: 'n1', type: 'line', speaker: 'rishon', mood: 'sly', text: '{name}, הכתובת <ltr>192.168.1.20</ltr> שייכת למדפסת.', next: 'n2' },
      { id: 'n2', type: 'check', voice: 'logic', color: 'white', target: 3, evidence: ['ev_a', 'ev_b'], onPass: 'ok', onFail: 'miss' },
      { id: 'miss', type: 'narration', text: 'חסר משהו.', next: 'n1' },
      { id: 'ok', type: 'end', result: 'solved' },
    ],
    ...over,
  });

describe('interpolation', () => {
  it('fills {name}, truncates to 16, leaves unknown tokens', () => {
    expect(interpolate('שלום {name}!', { name: 'דנה' })).toBe('שלום דנה!');
    expect(interpolate('{name}', { name: 'x'.repeat(30) })).toHaveLength(16);
    expect(interpolate('{other}', { name: 'a' })).toBe('{other}');
  });
  it('runner interpolates the player name in views', () => {
    const r = new DialogueRunner({ name: 'נועה' });
    expect(r.start(sample()).text).toContain('נועה, הכתובת');
  });
});

describe('conditions', () => {
  const env = { flags: { a: true, n: 0 }, voices: { logic: 2 }, evidence: new Set(['e']), thoughts: new Set<string>() };
  it('evaluates the DSL', () => {
    expect(holds('flag:a && voice:logic>=2', env)).toBe(true);
    expect(holds('!flag:n || ev:x', env)).toBe(true);
    expect(holds('(ev:e && thought:t) || voice:logic<2', env)).toBe(false);
    expect(holds(undefined, env)).toBe(true);
    expect(holds('false', env)).toBe(false);
  });
  it('rejects bad syntax', () => {
    expect(() => parseCondition('flag:a &&')).toThrow();
    expect(() => parseCondition('flag:a $')).toThrow();
    expect(() => parseCondition('(flag:a')).toThrow();
    expect(() => parseCondition('voice:logic')).toThrow();
    expect(() => parseCondition('bogus:x')).toThrow();
    expect(() => parseCondition('flag:a flag:b')).toThrow();
  });
});

describe('DialogueRunner: white check', () => {
  it('fails, shows what is missing, retries after evidence changes, then passes', () => {
    const events: DialogueEvent[] = [];
    const r = new DialogueRunner({ voices: { logic: 1 } });
    r.on((e) => events.push(e));
    r.start(sample());
    expect(r.advance().id).toBe('miss'); // 1 + 0 evidence < 3
    const fail = events.find((e) => e.type === 'check');
    expect(fail).toMatchObject({ result: { passed: false, missing: 2 } });
    r.grantEvidence('ev_a');
    r.grantEvidence('ev_a'); // idempotent
    r.advance(); // back to n1
    expect(r.advance().id).toBe('miss'); // 1+1=2, still short, retry allowed
    r.grantEvidence('ev_b');
    r.advance();
    const v = r.advance();
    expect(v.id).toBe('ok');
    expect(r.state.ended).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'end', result: 'solved' });
    expect(r.state.visited).toEqual(expect.arrayContaining(['n1', 'n2', 'miss', 'ok']));
    expect(r.state.redResults).toEqual({});
  });
  it('modifiers and voice level count', () => {
    const r = new DialogueRunner({ voices: { logic: 1 } });
    r.start(sample());
    r.addModifier('logic', 1);
    r.setVoiceLevel('logic', 2);
    expect(r.advance().id).toBe('ok');
  });
});

describe('DialogueRunner: red check', () => {
  const red = (): DialogueScene =>
    sample({
      nodes: [
        { id: 'n1', type: 'line', speaker: 'rishon', mood: 'neutral', text: 'שלום', next: 'n2' },
        { id: 'n2', type: 'check', voice: 'suspicion', color: 'red', target: 3, evidence: ['ev_a'], onPass: 'ok', onFail: 'bad' },
        { id: 'bad', type: 'narration', text: 'נכשלתם, אבל ממשיכים.', next: 'again' },
        { id: 'again', type: 'goto', target: 'n2' },
        { id: 'ok', type: 'end' },
      ],
    });
  it('is a single attempt: failure is locked in even after gaining evidence', () => {
    const events: DialogueEvent[] = [];
    const r = new DialogueRunner({ voices: { suspicion: 1 } });
    r.on((e) => events.push(e));
    r.start(red());
    expect(r.advance().id).toBe('bad');
    r.grantEvidence('ev_a');
    r.setVoiceLevel('suspicion', 5);
    expect(r.advance().id).toBe('bad'); // goto n2 replays recorded failure
    expect(r.state.redResults).toEqual({ n2: false });
    expect(events.filter((e) => e.type === 'check' && e.locked)).toHaveLength(1);
  });
  it('a recorded pass replays as a pass', () => {
    const r = new DialogueRunner({ voices: { suspicion: 3 } });
    r.start(red());
    expect(r.advance().id).toBe('ok');
    expect(r.state.redResults).toEqual({ n2: true });
  });
});

describe('DialogueRunner: choices, voices, flow', () => {
  const scene = DialogueSceneSchema.parse({
    schema: 1, id: 's', speakers: {}, start: 'c',
    nodes: [
      { id: 'c', type: 'choice', options: [
        { text: 'א', next: 's1', once: true },
        { text: 'ב', next: 'v', requires: 'flag:key' },
        { text: 'ג', next: 'e' },
      ] },
      { id: 's1', type: 'set', flag: 'key', value: true, next: 'ev' },
      { id: 'ev', type: 'evidence', evidenceId: 'ev_x', next: 'th' },
      { id: 'th', type: 'thought', thoughtId: 'th_x', next: 'br' },
      { id: 'br', type: 'branch', cases: [{ if: 'ev:ev_x && flag:key', next: 'c' }], else: 'e' },
      { id: 'v', type: 'voice', voice: 'recall', minLevel: 2, text: 'שלום {name}', next: 'e' },
      { id: 'e', type: 'end', unlock: 'next_scene' },
    ],
  });
  it('plays set/evidence/thought/branch, once-options and level-locked voices', () => {
    const r = new DialogueRunner({ name: 'דנה', voices: { recall: 1 } });
    const events: DialogueEvent[] = [];
    const off = r.on((e) => events.push(e));
    expect(r.current()).toBeNull();
    let v = r.start(scene);
    expect(v.options?.map((o) => o.available)).toEqual([true, false, true]);
    expect(() => r.choose(1)).toThrow();
    v = r.choose(0); // set, evidence, thought, branch -> back to choice
    expect(v.id).toBe('c');
    expect(v.options?.map((o) => o.available)).toEqual([false, true, true]); // once used, key set
    expect(r.state).toMatchObject({ flags: { key: true }, evidence: ['ev_x'], thoughts: ['th_x'] });
    v = r.choose(1);
    expect(v).toMatchObject({ type: 'voice', locked: true, text: '…' });
    r.setVoiceLevel('recall', 2);
    expect(r.current()).toMatchObject({ locked: false, text: 'שלום דנה' });
    expect(r.advance().type).toBe('end');
    expect(events.at(-1)).toEqual({ type: 'end', unlock: 'next_scene' });
    off();
    expect(() => r.advance()).toThrow();
  });
  it('guards misuse', () => {
    const r = new DialogueRunner();
    expect(() => r.advance()).toThrow();
    r.start(scene);
    expect(() => r.advance()).toThrow();
    r.choose(2);
    expect(() => r.choose(0)).toThrow();
  });
  it('trips the loop guard on automatic cycles', () => {
    const loop = DialogueSceneSchema.parse({
      schema: 1, id: 'l', speakers: {}, start: 'a',
      nodes: [{ id: 'a', type: 'goto', target: 'b' }, { id: 'b', type: 'goto', target: 'a' }],
    });
    expect(() => new DialogueRunner().start(loop)).toThrow(/loop guard/);
  });
});

describe('lintScene', () => {
  const codes = (x: unknown) => lintScene(x).map((i) => i.code);
  it('passes a clean scene', () => {
    const issues = lintScene(sample());
    expect(hasErrors(issues)).toBe(false);
  });
  it('catches a dead branch (option requiring a flag nobody sets) and the node behind it', () => {
    const scene = {
      schema: 1, id: 'd', speakers: {}, start: 'c',
      nodes: [
        { id: 'c', type: 'choice', options: [{ text: 'א', next: 'e' }, { text: 'ב', next: 'secret', requires: 'flag:never_set' }] },
        { id: 'secret', type: 'narration', text: 'סוד', next: 'e' },
        { id: 'e', type: 'end' },
      ],
    };
    const c = codes(scene);
    expect(c).toContain('dead-branch');
    expect(c).toContain('unreachable');
  });
  it('catches missing targets, missing next, missing start, duplicates, no end', () => {
    const c = codes({
      schema: 1, id: 'm', speakers: {}, start: 'zzz',
      nodes: [
        { id: 'a', type: 'goto', target: 'nowhere' },
        { id: 'a', type: 'narration', text: 'x' },
      ],
    });
    expect(c).toEqual(expect.arrayContaining(['missing-target', 'missing-next', 'missing-start', 'duplicate-id', 'no-end']));
  });
  it('catches choice with no exit and cycles with no end', () => {
    const c = codes({
      schema: 1, id: 'x', speakers: {}, start: 'c',
      nodes: [
        { id: 'c', type: 'choice', options: [{ text: 'א', next: 'l', requires: 'false' }] },
        { id: 'l', type: 'narration', text: 'x', next: 'm' },
        { id: 'm', type: 'goto', target: 'l' },
        { id: 'e', type: 'end' },
      ],
    });
    expect(c).toContain('choice-no-exit');
    const loop = codes({
      schema: 1, id: 'x', speakers: {}, start: 'l',
      nodes: [{ id: 'l', type: 'narration', text: 'x', next: 'm' }, { id: 'm', type: 'goto', target: 'l' }, { id: 'e', type: 'end' }],
    });
    expect(loop).toContain('cycle-no-end');
    const stuck = codes({
      schema: 1, id: 'x', speakers: {}, start: 'a',
      nodes: [{ id: 'a', type: 'narration', text: 'x', next: 'b' }, { id: 'b', type: 'narration', text: 'y', next: 'a2' },
        { id: 'a2', type: 'branch', cases: [{ if: 'false', next: 'e' }], else: 'e' }, { id: 'e', type: 'end' }],
    });
    expect(stuck).toContain('dead-branch');
  });
  it('catches bad text, speaker, mood, conditions and same-target checks', () => {
    const issues = lintScene({
      schema: 1, id: 't', speakers: { a: { nameKey: 'k' } }, start: 'l',
      nodes: [
        { id: 'l', type: 'line', speaker: 'ghost', text: `{nam} ${'ש'.repeat(130)} {name} <b>x</b> <ltr>x { }`, next: 'k' },
        { id: 'k', type: 'line', speaker: 'a', text: 'ok', next: 'b' },
        { id: 'b', type: 'branch', cases: [{ if: 'flag:', next: 'c' }, { if: 'true', next: 'c' }, { if: 'flag:z', next: 'c' }], else: 'c' },
        { id: 'c', type: 'check', voice: 'logic', color: 'white', target: 2, evidence: [], onPass: 'e', onFail: 'e' },
        { id: 'e', type: 'end' },
      ],
    });
    const c = issues.map((i) => i.code);
    expect(c).toEqual(expect.arrayContaining([
      'bad-placeholder', 'text-too-long', 'bad-markup', 'unknown-speaker', 'missing-mood', 'bad-condition', 'dead-branch',
    ]));
  });
  it('reports schema errors', () => {
    expect(codes({ schema: 2 })).toContain('schema');
  });
  it('evaluates static and/or/not over flags', () => {
    const c = codes({
      schema: 1, id: 'q', speakers: {}, start: 'b',
      nodes: [
        { id: 'b', type: 'branch', cases: [{ if: '!flag:no || flag:no', next: 'e' }, { if: 'flag:no && ev:x', next: 'e' }], else: 'e' },
        { id: 'e', type: 'end' },
      ],
    });
    expect(c.filter((x) => x === 'dead-branch').length).toBeGreaterThanOrEqual(2);
  });
});
