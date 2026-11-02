import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { SaveV1 } from '@tikshuv/save';
import {
  DialogueRunner, DialogueSceneSchema, hasErrors, holds, lintScene, lintScenes, parseCondition, resolveCheck,
  type DialogueEvent, type DialogueScene, type DialogueSnapshot,
} from './index.js';

const scene = (nodes: unknown[], over: Record<string, unknown> = {}): DialogueScene =>
  DialogueSceneSchema.parse({
    schema: 1, id: 'sc', mood: 'mood_hub', music: 'mus_bureau',
    speakers: { a: { nameKey: 'c.a' } }, start: 'n1', nodes, ...over,
  });

const redScene = () =>
  scene([
    { id: 'n1', type: 'line', speaker: 'a', mood: 'neutral', text: 'שלום', next: 'n2' },
    { id: 'n2', type: 'check', voice: 'suspicion', color: 'red', target: 3, evidence: ['ev_a'], onBail: 'gather', onPass: 'ok', onFail: 'bad' },
    { id: 'gather', type: 'narration', text: 'לא עכשיו.', next: 'n2' },
    { id: 'bad', type: 'narration', text: 'נכשלתם.', next: 'again' },
    { id: 'again', type: 'goto', target: 'n2' },
    { id: 'ok', type: 'end' },
  ]);

describe('snapshot / restore', () => {
  it('a red check cannot be retried after reload (JSON round trip)', () => {
    const r1 = new DialogueRunner({ voices: { suspicion: 1 } });
    r1.start(redScene());
    r1.advance();
    expect(r1.confirm().id).toBe('bad'); // red failed, recorded
    const snap = JSON.parse(JSON.stringify(r1.snapshot())) as DialogueSnapshot;
    expect(snap).toMatchObject({ sceneId: 'sc', nodeId: 'bad', redResults: { n2: false } });

    // reload: the player now has more evidence and a higher level, but cannot re-roll
    const r2 = new DialogueRunner({ voices: { suspicion: 5 }, evidence: ['ev_a'] });
    const events: DialogueEvent[] = [];
    r2.on((e) => events.push(e));
    expect(r2.restore(redScene(), snap).id).toBe('bad');
    expect(events).toEqual([]); // restore replays no effects
    expect(r2.advance().id).toBe('bad'); // goto n2 replays the recorded failure
    expect(events.find((e) => e.type === 'check')).toMatchObject({ locked: true, result: { passed: true } });
    expect(r2.state.redResults).toEqual({ n2: false });
  });

  it('seeding redResults through RunnerOptions also blocks the re-roll', () => {
    const r = new DialogueRunner({ voices: { suspicion: 5 }, redResults: { n2: false } });
    r.start(redScene());
    expect(r.advance().id).toBe('bad');
  });

  it('restore at an unconfirmed red check keeps the attempt; restore inside a check event replays it', () => {
    const r1 = new DialogueRunner({ voices: { suspicion: 1 } });
    r1.start(redScene());
    r1.advance();
    const preview = r1.snapshot();
    expect(preview.redResults).toEqual({});
    const r2 = new DialogueRunner({ voices: { suspicion: 5 } });
    const v = r2.restore(redScene(), preview);
    expect(v.type).toBe('check');
    expect(r2.confirm().id).toBe('ok'); // attempt was not spent

    // an autosave taken the moment the check resolves (listener) must also be safe
    const r3 = new DialogueRunner({ voices: { suspicion: 1 } });
    let during: DialogueSnapshot | undefined;
    r3.on((e) => {
      if (e.type === 'check') during = r3.snapshot();
    });
    r3.start(redScene());
    r3.advance();
    r3.confirm();
    expect(during?.nodeId).toBe('n2');
    expect(during?.redResults).toEqual({ n2: false });
    const r4 = new DialogueRunner({ voices: { suspicion: 5 } });
    expect(r4.restore(redScene(), during!).id).toBe('bad');
  });

  it('keeps flags, once-used options, modifiers, inspected and reasoning; restores ended runs', () => {
    const s = scene([
      { id: 'n1', type: 'choice', options: [{ text: 'א', next: 'set', once: true }, { text: 'ב', next: 'e' }] },
      { id: 'set', type: 'set', flag: 'k', value: 3, next: 'n1' },
      { id: 'e', type: 'end', result: 'solved' },
    ]);
    const r = new DialogueRunner();
    r.start(s);
    r.addModifier('logic', 2);
    r.answerReasoning('q1', true);
    r.choose(0);
    const snap = r.snapshot();
    const r2 = new DialogueRunner();
    const v = r2.restore(s, snap);
    expect(v.options?.map((o) => o.available)).toEqual([false, true]);
    expect(r2.state).toMatchObject({ flags: { k: 3 }, modifiers: { logic: 2 }, nodeId: 'n1' });
    r2.choose(1);
    expect(r2.state.ended).toBe(true);
    const r3 = new DialogueRunner();
    r3.restore(s, r2.snapshot());
    expect(r3.state.ended).toBe(true);
  });

  it('rejects a snapshot for another scene, a vanished node, or before start', () => {
    const r = new DialogueRunner();
    expect(() => r.snapshot()).toThrow();
    r.start(redScene());
    const snap = r.snapshot();
    expect(() => new DialogueRunner().restore(redScene(), { ...snap, sceneId: 'other' })).toThrow(/other/);
    expect(() => new DialogueRunner().restore(redScene(), { ...snap, nodeId: 'gone' })).toThrow(/gone/);
  });

  it('is assignable to the save schema (SaveV1.dialogue)', () => {
    const r = new DialogueRunner();
    r.start(redScene());
    const forSave: NonNullable<SaveV1['dialogue']> = r.snapshot();
    expect(forSave.sceneId).toBe('sc');
  });
});

describe('check preview, confirm, bail', () => {
  it('shows every term and bails without spending the red attempt', () => {
    const r = new DialogueRunner({ voices: { suspicion: 1 }, evidence: ['ev_a'] });
    r.start(redScene());
    const v = r.advance();
    expect(v.type).toBe('check');
    expect(v.check).toMatchObject({ color: 'red', canBail: true });
    expect(v.check?.result.terms).toEqual({ voice: 1, evidence: 1, thought: 0, apply: 0, overreach: 0 });
    expect(v.check?.result).toMatchObject({ score: 2, target: 3, passed: false, missing: 1 });
    const events: DialogueEvent[] = [];
    r.on((e) => events.push(e));
    expect(r.bail().id).toBe('gather');
    expect(events.some((e) => e.type === 'bail')).toBe(true);
    expect(r.state.redResults).toEqual({});
    r.setVoiceLevel('suspicion', 2);
    r.advance(); // back to the check
    expect(r.confirm().id).toBe('ok');
  });

  it('guards: advance on a check, confirm/bail elsewhere, bail without onBail', () => {
    const s = scene([
      { id: 'n1', type: 'narration', text: 'x', next: 'c' },
      { id: 'c', type: 'check', voice: 'logic', color: 'white', target: 2, onPass: 'e', onFail: 'e2' },
      { id: 'e', type: 'end' },
      { id: 'e2', type: 'end' },
    ]);
    const r = new DialogueRunner();
    r.start(s);
    expect(() => r.confirm()).toThrow();
    expect(() => r.bail()).toThrow();
    r.advance();
    expect(() => r.advance()).toThrow(/confirm/);
    expect(() => r.bail()).toThrow(/onBail/);
    expect(r.current()?.check?.canBail).toBe(false);
  });

  it('thought tags (capped +2), reasoning (+2) and overreach (-1) feed the score', () => {
    const s = scene([
      { id: 'c', type: 'check', voice: 'logic', color: 'white', target: 9, tags: ['arp'], reasoning: 'q_arp', mustInspect: ['ev_t'], evidence: ['e1', 'e2', 'e3', 'e4'], onPass: 'e', onFail: 'f' },
      { id: 'f', type: 'narration', text: 'x', next: 'c' },
      { id: 'i', type: 'inspect', evidenceId: 'ev_t', next: 'c' },
      { id: 'e', type: 'end' },
    ], { start: 'c' });
    const r = new DialogueRunner({
      voices: { logic: 2 },
      evidence: ['e1', 'e2', 'e3', 'e4'],
      internalised: ['t1', 't2', 't3'],
      thoughtTags: { t1: ['arp'], t2: ['arp', 'x'], t3: ['arp'], t4: ['zzz'] },
    });
    let v = r.start(s);
    // logic 2 + evidence capped 3 + thought capped 2 + apply 0 + overreach -1 = 6
    expect(v.check?.result.terms).toEqual({ voice: 2, evidence: 3, thought: 2, apply: 0, overreach: -1 });
    r.answerReasoning('q_arp', false);
    expect(r.current()?.check?.result.terms.apply).toBe(0);
    r.answerReasoning('q_arp', true);
    r.setInternalised('t4', ['arp']);
    r.removeInternalised('t4');
    v = r.current()!;
    expect(v.check?.result.score).toBe(8);
    r.addModifier('logic', 1);
    expect(r.current()?.check?.result.terms.voice).toBe(3);
    r.clearModifiers();
    expect(r.state.modifiers).toEqual({});
  });

  it('resolveCheck caps evidence at +3 and reports missing', () => {
    const res = resolveCheck({ target: 9 }, { voiceLevel: 1, modifiers: 0, evidenceHeld: 10 });
    expect(res.terms.evidence).toBe(3);
    expect(res).toMatchObject({ score: 4, passed: false, missing: 5 });
  });
});

describe('external hand-off nodes', () => {
  const ext = () =>
    scene([
      { id: 'n1', type: 'terminal', deviceId: 'router_r1', goal: 'set_hostname', onDone: 'q', onGiveUp: 'sad' },
      { id: 'q', type: 'quiz', questionId: 'q_arp', onRight: 'ins', onWrong: 'sad' },
      { id: 'ins', type: 'inspect', evidenceId: 'ev_table', next: 'e' },
      { id: 'sad', type: 'narration', text: 'ויתרתם.', next: 'e' },
      { id: 'e', type: 'end' },
    ]);

  it('pauses on terminal, quiz and inspect and resumes with a result', () => {
    const r = new DialogueRunner();
    const events: DialogueEvent[] = [];
    r.on((e) => events.push(e));
    let v = r.start(ext());
    expect(v).toMatchObject({ type: 'external', external: { kind: 'terminal', payload: { deviceId: 'router_r1', goal: 'set_hostname' } } });
    expect(() => r.advance()).toThrow(/resolveExternal/);
    expect(() => r.resolveExternal('right')).toThrow();
    v = r.resolveExternal('done');
    expect(v.external).toEqual({ kind: 'quiz', payload: { questionId: 'q_arp' } });
    expect(() => r.resolveExternal('done')).toThrow();
    v = r.resolveExternal('right');
    expect(v.external?.kind).toBe('inspect');
    expect(() => r.resolveExternal('giveUp')).toThrow();
    expect(r.state.evidence).toEqual([]);
    v = r.resolveExternal('done');
    expect(v.type).toBe('end');
    expect(r.state.evidence).toEqual(['ev_table']); // examining grants it
    expect(events.filter((e) => e.type === 'external').map((e) => (e as { kind: string }).kind)).toEqual(['terminal', 'quiz', 'inspect']);
    expect(events.filter((e) => e.type === 'externalResult')).toHaveLength(3);
  });

  it('give-up and wrong take the other branch; resolveExternal on a normal node throws', () => {
    const r = new DialogueRunner();
    r.start(ext());
    expect(r.resolveExternal('giveUp').id).toBe('sad');
    expect(() => r.resolveExternal('done')).toThrow(/not an external/);
    const r2 = new DialogueRunner();
    r2.start(ext());
    r2.resolveExternal('done');
    expect(r2.resolveExternal('wrong').id).toBe('sad');
  });

  it('a hand-off survives snapshot/restore (reload while the terminal is open)', () => {
    const r = new DialogueRunner();
    r.start(ext());
    const snap = r.snapshot();
    const r2 = new DialogueRunner();
    expect(r2.restore(ext(), snap).external?.kind).toBe('terminal');
  });

  it('inspecting clears the overreach penalty', () => {
    const s = scene([
      { id: 'i', type: 'inspect', evidenceId: 'ev_t', next: 'c' },
      { id: 'c', type: 'check', voice: 'logic', color: 'white', target: 2, mustInspect: ['ev_t'], onPass: 'e', onFail: 'e' },
      { id: 'e', type: 'end' },
    ], { start: 'i' });
    const r = new DialogueRunner({ voices: { logic: 2 } });
    r.start(s);
    expect(r.resolveExternal('done').check?.result.terms).toMatchObject({ overreach: 0, evidence: 0 });
  });
});

describe('runner robustness', () => {
  it('a throwing listener never leaves the runner half-advanced', () => {
    const onListenerError = vi.fn();
    const s = scene([
      { id: 'n1', type: 'set', flag: 'f', value: true, next: 'n2' },
      { id: 'n2', type: 'narration', text: 'x', next: 'e' },
      { id: 'e', type: 'end' },
    ]);
    const r = new DialogueRunner({ onListenerError });
    r.on(() => {
      throw new Error('boom');
    });
    expect(r.start(s).id).toBe('n2');
    expect(onListenerError).toHaveBeenCalled();
    expect(r.state.flags['f']).toBe(true);
    // default handler logs instead of throwing
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r2 = new DialogueRunner();
    r2.on(() => {
      throw new Error('x');
    });
    expect(() => r2.start(s)).not.toThrow();
    spy.mockRestore();
  });

  it('start() resets modifiers; voice views carry the voice id and a translated speaker', () => {
    const s = scene([
      { id: 'v', type: 'voice', voice: 'logic', minLevel: 1, text: 'חשבו', next: 'e' },
      { id: 'e', type: 'end' },
    ], { start: 'v' });
    const r = new DialogueRunner({ voices: { logic: 1 }, t: (k) => `T(${k})` });
    r.addModifier('logic', 1);
    const v = r.start(s);
    expect(v).toMatchObject({ voice: 'logic', speaker: 'T(voice.logic)' });
    expect(r.state.modifiers).toEqual({});
    expect(r.advance().type).toBe('end');
  });
});

describe('conditions: numeric flags and voice validation', () => {
  const env = { flags: { n: 3, b: true }, voices: {}, evidence: new Set<string>(), thoughts: new Set<string>() };
  it('compares numeric flags', () => {
    expect(holds('flag:n>=2', env)).toBe(true);
    expect(holds('flag:n>3', env)).toBe(false);
    expect(holds('flag:n==3 && flag:b', env)).toBe(true);
    expect(holds('flag:missing<1', env)).toBe(true);
  });
  it('rejects an unknown voice at parse time', () => {
    expect(() => parseCondition('voice:logik>=2')).toThrow(/unknown voice/);
    expect(parseCondition('voice:packet_sense>=2')).toMatchObject({ k: 'voice', voice: 'packet_sense' });
  });
});

describe('lint: cross-scene flags, cycles, registries, moods', () => {
  const choiceScene = (id: string, flag: string) => ({
    schema: 1, id, mood: 'mood_hub', music: 'mus_bureau', speakers: {}, start: 'c',
    nodes: [
      { id: 'c', type: 'choice', options: [{ text: 'א', next: 'e' }, { text: 'ב', next: 'x', requires: `flag:${flag}` }] },
      { id: 'x', type: 'narration', text: 'x', next: 'e' },
      { id: 'e', type: 'end' },
    ],
  });
  const setter = { schema: 1, id: 'setter', mood: 'mood_hub', music: 'mus_bureau', speakers: {}, start: 's', nodes: [
    { id: 's', type: 'set', flag: 'from_other', value: true, next: 'e' }, { id: 'e', type: 'end' },
  ] };

  it('a flag set in another scene is not a dead branch or unreachable node', () => {
    const alone = lintScene(choiceScene('a', 'from_other'));
    expect(alone.map((i) => i.code)).toContain('unknown-flag');
    expect(alone.map((i) => i.code)).not.toContain('unreachable');
    expect(hasErrors(alone)).toBe(false);
    const [a] = lintScenes([choiceScene('a', 'from_other'), setter]);
    expect(a).toEqual([]);
    const [b] = lintScenes([choiceScene('a', 'registry_flag')], { extraFlags: ['registry_flag'] });
    expect(b).toEqual([]);
    const [c] = lintScenes([choiceScene('a', 'typo')]);
    expect(c?.map((i) => i.code)).toEqual(['unknown-flag']);
  });

  it('flags an automatic cycle that would trip the runtime loop guard', () => {
    const red = {
      schema: 1, id: 'cyc', mood: 'mood_check_red', music: 'mus_deduction', speakers: {}, start: 'c',
      nodes: [
        { id: 'c', type: 'check', voice: 'logic', color: 'red', target: 5, onPass: 'e', onFail: 'g' },
        { id: 'g', type: 'goto', target: 'c' },
        { id: 'e', type: 'end' },
      ],
    };
    const issues = lintScene(red);
    expect(issues.find((i) => i.code === 'auto-cycle')).toMatchObject({ severity: 'error' });
    // and it really does throw at runtime once the red result is recorded
    const r = new DialogueRunner({ redResults: { c: false } });
    expect(() => r.start(DialogueSceneSchema.parse(red))).toThrow(/loop guard/);
  });

  it('a cycle with a state change inside is only a warning; a cycle through a narration is fine', () => {
    const risky = {
      schema: 1, id: 'r', mood: 'mood_hub', music: 'mus_bureau', speakers: {}, start: 'b',
      nodes: [
        { id: 'b', type: 'branch', cases: [{ if: 'flag:done', next: 'e' }], else: 's' },
        { id: 's', type: 'set', flag: 'done', value: true, next: 'b' },
        { id: 'e', type: 'end' },
      ],
    };
    const i = lintScene(risky);
    expect(i.find((x) => x.code === 'auto-cycle-risk')).toMatchObject({ severity: 'warning' });
    expect(hasErrors(i)).toBe(false);
    const ok = lintScene({ ...risky, nodes: [
      { id: 'b', type: 'branch', cases: [{ if: 'flag:done', next: 'e' }], else: 'n' },
      { id: 'n', type: 'narration', text: 'x', next: 'b' },
      { id: 's', type: 'set', flag: 'done', value: true, next: 'e' },
      { id: 'e', type: 'end' },
    ] });
    expect(ok.map((x) => x.code)).not.toContain('auto-cycle');
  });

  it('validates voice atoms, registries, moods, music, emoji and hand-off targets', () => {
    const s = {
      schema: 1, id: 'v', mood: 'calm', music: 'mus_unknown', speakers: { a: { nameKey: 'k' } }, start: 'l',
      nodes: [
        { id: 'l', type: 'line', speaker: 'a', mood: 'neutral', text: 'היי 😀', next: 'ch' },
        { id: 'ch', type: 'choice', options: [{ text: 'א', next: 'ev', requires: 'voice:logik>=2' }, { text: 'ב', next: 'ev', requires: 'ev:ev_nope && thought:th_nope' }] },
        { id: 'ev', type: 'evidence', evidenceId: 'ev_nope2', next: 't' },
        { id: 't', type: 'thought', thoughtId: 'th_nope2', next: 'ins' },
        { id: 'ins', type: 'inspect', evidenceId: 'ev_nope3', next: 'term' },
        { id: 'term', type: 'terminal', deviceId: 'dev_x', goal: 'g', onDone: 'qz', onGiveUp: 'qz' },
        { id: 'qz', type: 'quiz', questionId: 'q_x', onRight: 'cc', onWrong: 'cc' },
        { id: 'cc', type: 'check', voice: 'logic', color: 'white', target: 3, evidence: ['ev_nope4'], mustInspect: ['ev_nope5'], reasoning: 'q_y', onPass: 'e', onFail: 'e2' },
        { id: 'e', type: 'end' }, { id: 'e2', type: 'end' },
      ],
    };
    const codes = lintScene(s, {
      evidenceIds: ['ev_ok'], thoughtIds: ['th_ok'], questionIds: ['q_ok'], deviceIds: ['dev_ok'],
    }).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining([
      'unknown-mood', 'unknown-music', 'emoji', 'bad-condition', 'unknown-evidence', 'unknown-thought',
      'unknown-question', 'unknown-device',
    ]));
    // without registries the id checks are skipped, but mood/music still validate
    const none = lintScene(s).map((i) => i.code);
    expect(none).not.toContain('unknown-evidence');
    expect(none).toContain('unknown-mood');
  });

  it('a clean scene with an inspect/terminal/quiz chain and good ids lints clean', () => {
    const s = {
      schema: 1, id: 'good', mood: 'mood_terminal', music: 'mus_terminal', speakers: {}, start: 'ins',
      nodes: [
        { id: 'ins', type: 'inspect', evidenceId: 'ev_ok', next: 'term' },
        { id: 'term', type: 'terminal', deviceId: 'dev_ok', goal: 'g', onDone: 'qz', onGiveUp: 'e' },
        { id: 'qz', type: 'quiz', questionId: 'q_ok', onRight: 'e', onWrong: 'e' },
        { id: 'e', type: 'end' },
      ],
    };
    expect(lintScene(s, { evidenceIds: ['ev_ok'], questionIds: ['q_ok'], deviceIds: ['dev_ok'] })).toEqual([]);
  });

  it('missing mood/music on a scene is a warning; a one-option choice is a schema error', () => {
    const base = { schema: 1, id: 'm', speakers: {}, start: 'e', nodes: [{ id: 'e', type: 'end' }] };
    expect(lintScene(base).map((i) => i.code)).toEqual(['missing-scene-mood', 'missing-scene-music']);
    expect(lintScene({ ...base, nodes: [{ id: 'c', type: 'choice', options: [{ text: 'a', next: 'e' }] }, { id: 'e', type: 'end' }], start: 'c' }).map((i) => i.code)).toContain('schema');
  });
});

describe('golden: VOICE_BIBLE sample scenes lint clean', () => {
  const path = fileURLToPath(new URL('../../../../specs/case-files/VOICE_BIBLE.md', import.meta.url));
  it.skipIf(!existsSync(path))('every ```json scene in the bible passes lint without errors', () => {
    const md = readFileSync(path, 'utf8');
    const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1] as string);
    const scenes = blocks.map((b) => JSON.parse(b) as { schema?: number }).filter((o) => o.schema === 1);
    expect(scenes.length).toBeGreaterThan(0);
    const results = lintScenes(scenes);
    results.forEach((issues, i) => {
      const errs = issues.filter((x) => x.severity === 'error');
      expect(errs, `scene ${i}: ${JSON.stringify(errs)}`).toEqual([]);
    });
  });
});
