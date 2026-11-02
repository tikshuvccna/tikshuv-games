import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '@tikshuv/audio';
import { VOICE_IDS } from '@tikshuv/core';
import {
  SAVE_KEY, SaveStore, SaveV1Schema, addVoicePips, cabinetSlots, createDefaultSave, forgetThought,
  isCaseUnlocked, isFirstUnitDone, isUnitComplete, voiceLevel,
  type AsyncKV, type CaseUnits, type SaveV1, type SyncStorage, type UnitProgress,
} from './index.js';

function fakeLocal(init: Record<string, string> = {}): SyncStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
function fakeBackup(): AsyncKV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v) };
}
const at = (iso: string, over: Partial<SaveV1> = {}): SaveV1 => ({ ...createDefaultSave(new Date(iso)), ...over });

describe('C1: the save holds the resume state', () => {
  it('round-trips flags, evidence, thoughts, dialogue position, session, voices, coins, minigames, achievements', async () => {
    const local = fakeLocal();
    const a = new SaveStore({ local, backup: null });
    await a.load();
    a.update((d) => {
      d.flags['met_chief'] = true;
      d.flags['clues'] = 2;
      d.evidence.push('ev_mac_table');
      d.thoughts['th_arp_basic'] = { state: 'internalising', progressMs: 90_000, slot: 0 };
      d.dialogue = {
        sceneId: 'c3_s2', nodeId: 'n14', flags: { x: 1 }, visited: ['n1'], used: ['c#0'],
        redResults: { n9: false }, modifiers: { logic: 1 }, inspected: ['ev_a'], reasoning: { q1: true },
      };
      d.session = { elapsedMs: 421_000, warned: false, ended: false, lastActiveAt: '2026-11-02T10:00:00.000Z' };
      d.coins = 12;
      d.achievements['first_red'] = '2026-11-02T10:00:00.000Z';
      d.minigames['u05'] = { hard: { bestScore: 90, stars: 3 } };
      d.voices['recall'] = addVoicePips(d.voices['recall'], 4);
    });
    await a.flush();
    const r = await new SaveStore({ local, backup: null }).load();
    expect(r.source).toBe('local');
    expect(r.state).toEqual(a.getState());
    expect(r.state.dialogue?.redResults).toEqual({ n9: false });
    expect(r.state.session.elapsedMs).toBe(421_000);
    expect(r.state.voices['recall']).toEqual({ level: 1, pips: 1 });
  });

  it('the default save validates and has the new fields', () => {
    const d = createDefaultSave();
    expect(SaveV1Schema.safeParse(d).success).toBe(true);
    expect(d).toMatchObject({ flags: {}, evidence: [], thoughts: {}, coins: 0, session: { elapsedMs: 0 } });
    expect(d.dialogue).toBeUndefined();
  });

  it('rejects voice keys that are not one of the six voices', () => {
    const s = createDefaultSave() as unknown as Record<string, unknown>;
    s['voices'] = { bogus: { level: 1, pips: 0 } };
    expect(SaveV1Schema.safeParse(s).success).toBe(false);
    s['voices'] = Object.fromEntries(VOICE_IDS.map((v) => [v, { level: 5, pips: 0 }]));
    expect(SaveV1Schema.safeParse(s).success).toBe(true);
  });
});

describe('I1: session cap values', () => {
  it('accepts 10, 12, 15 and null (off); default is 12; rejects others', () => {
    expect(createDefaultSave().settings.sessionCapMinutes).toBe(12);
    const onError = vi.fn();
    const s = new SaveStore({ local: fakeLocal(), backup: null, onError });
    for (const v of [10, 12, 15, null] as const) {
      s.update((d) => {
        d.settings.sessionCapMinutes = v;
      });
      expect(s.getState().settings.sessionCapMinutes).toBe(v);
    }
    expect(onError).not.toHaveBeenCalled();
    s.update((d) => {
      (d.settings as { sessionCapMinutes: number | null }).sessionCapMinutes = 11;
    });
    expect(s.getState().settings.sessionCapMinutes).toBeNull();
    expect(onError).toHaveBeenCalled();
  });
});

describe('I2/I3: one audio source of truth, muted on first run', () => {
  it('default settings.audio equals the audio package default (master muted, prompt not seen)', () => {
    const d = createDefaultSave();
    expect(d.settings.audio).toEqual(defaultSettings());
    expect(d.settings.audio.muted.master).toBe(true);
    expect(d.settings.audio.promptSeen).toBe(false);
  });
  it('persists the audio choice and sanitises garbage', async () => {
    const local = fakeLocal();
    const a = new SaveStore({ local, backup: null });
    a.update((d) => {
      d.settings.audio.promptSeen = true;
      d.settings.audio.muted.master = false;
      d.settings.audio.music = 0.3;
    });
    await a.flush();
    const r = await new SaveStore({ local, backup: null }).load();
    expect(r.state.settings.audio).toMatchObject({ promptSeen: true, music: 0.3 });
    expect(r.state.settings.audio.muted.master).toBe(false);
    const raw = JSON.parse(local.data.get(SAVE_KEY)!);
    raw.settings.audio = { master: 7, muted: 'x' };
    local.data.set(SAVE_KEY, JSON.stringify(raw));
    const r2 = await new SaveStore({ local, backup: null }).load();
    expect(r2.state.settings.audio.master).toBe(1);
    expect(r2.state.settings.audio.muted.master).toBe(true);
  });
});

describe('I14: load picks the newer of local and backup', () => {
  it('backup newer than local wins (quota left local behind)', async () => {
    const local = fakeLocal({ [SAVE_KEY]: JSON.stringify(at('2026-11-02T10:00:00Z', { xp: 1, updatedAt: '2026-11-02T10:00:00.000Z' })) });
    const backup = fakeBackup();
    backup.data.set(SAVE_KEY, JSON.stringify(at('2026-11-02T10:00:00Z', { xp: 2, updatedAt: '2026-11-02T11:00:00.000Z' })));
    const r = await new SaveStore({ local, backup }).load();
    expect(r.source).toBe('backup');
    expect(r.state.xp).toBe(2);
    expect(r.warnings.join()).toContain('newer');
  });
  it('local newer, equal, or backup unreadable keeps local', async () => {
    const mk = (xp: number, t: string) => JSON.stringify(at(t, { xp, updatedAt: t }));
    const backup = fakeBackup();
    backup.data.set(SAVE_KEY, mk(2, '2026-11-02T10:00:00.000Z'));
    expect((await new SaveStore({ local: fakeLocal({ [SAVE_KEY]: mk(1, '2026-11-02T11:00:00.000Z') }), backup }).load()).state.xp).toBe(1);
    expect((await new SaveStore({ local: fakeLocal({ [SAVE_KEY]: mk(1, '2026-11-02T10:00:00.000Z') }), backup }).load()).source).toBe('local');
    backup.data.set(SAVE_KEY, 'garbage');
    const r = await new SaveStore({ local: fakeLocal({ [SAVE_KEY]: mk(1, '2026-11-02T10:00:00.000Z') }), backup }).load();
    expect(r.source).toBe('local');
    expect(r.warnings.join()).toContain('backup unusable');
  });
  it('a throwing backup read still adopts local', async () => {
    const backup: AsyncKV = { get: async () => { throw new Error('x'); }, set: async () => {} };
    const local = fakeLocal({ [SAVE_KEY]: JSON.stringify(createDefaultSave()) });
    const r = await new SaveStore({ local, backup }).load();
    expect(r.source).toBe('local');
    expect(r.warnings).toContain('backup read failed');
  });
  it('a future-version backup beside a valid local keeps local (not read-only)', async () => {
    const backup = fakeBackup();
    backup.data.set(SAVE_KEY, JSON.stringify({ v: 9 }));
    const r = await new SaveStore({ local: fakeLocal({ [SAVE_KEY]: JSON.stringify(createDefaultSave()) }), backup }).load();
    expect(r.source).toBe('local');
    expect(r.readOnly).toBe(false);
  });
});

describe('I15: missing nested objects merge over defaults instead of discarding the save', () => {
  it('a save without profile/settings/cabinet keeps its progress', async () => {
    const d = createDefaultSave();
    const raw = { v: 1, createdAt: d.createdAt, updatedAt: d.updatedAt, xp: 77, units: { u01: { checks: 2, quizScore: 6, lessonViewed: true } } };
    const r = await new SaveStore({ local: fakeLocal({ [SAVE_KEY]: JSON.stringify(raw) }), backup: null }).load();
    expect(r.source).toBe('local');
    expect(r.state.xp).toBe(77);
    expect(r.state.profile.avatarId).toBe('default');
    expect(r.state.settings.sessionCapMinutes).toBe(12);
    expect(r.state.settings.audio.muted.master).toBe(true);
    expect(r.state.session.elapsedMs).toBe(0);
  });
  it('a partial settings object gets defaults for the rest', async () => {
    const d = createDefaultSave();
    const raw = { ...d, settings: { sessionCapMinutes: 15 } };
    const r = await new SaveStore({ local: fakeLocal({ [SAVE_KEY]: JSON.stringify(raw) }), backup: null }).load();
    expect(r.state.settings).toMatchObject({ sessionCapMinutes: 15, language: 'he', reducedMotion: 'auto' });
    expect(r.state.settings.audio).toEqual(defaultSettings());
  });
  it('the schema itself also tolerates missing nested objects', () => {
    const d = createDefaultSave() as unknown as Record<string, unknown>;
    delete d['profile'];
    delete d['settings'];
    delete d['session'];
    const p = SaveV1Schema.safeParse(d);
    expect(p.success).toBe(true);
  });
});

describe('I15: two tabs', () => {
  function win() {
    const h = new Map<string, Set<(e: never) => void>>();
    const dh = new Map<string, Set<() => void>>();
    const add = <T,>(m: Map<string, Set<T>>, t: string, f: T) => (m.get(t) ?? m.set(t, new Set()).get(t)!).add(f);
    const del = <T,>(m: Map<string, Set<T>>, t: string, f: T) => void m.get(t)?.delete(f);
    const w = {
      addEventListener: (t: string, f: (e: never) => void) => add(h, t, f),
      removeEventListener: (t: string, f: (e: never) => void) => del(h, t, f),
      document: {
        hidden: false,
        addEventListener: (t: string, f: () => void) => add(dh, t, f),
        removeEventListener: (t: string, f: () => void) => del(dh, t, f),
      },
    };
    return {
      w,
      fire: (t: string, e: unknown = {}) => h.get(t)?.forEach((f) => (f as (e: unknown) => void)(e)),
      fireDoc: (t: string) => dh.get(t)?.forEach((f) => f()),
      count: () => [...h.values(), ...dh.values()].reduce((n, s) => n + s.size, 0),
    };
  }

  it('adopts a newer save from another tab (storage event) and notifies; ignores older/other keys', async () => {
    const local = fakeLocal();
    const onExternalChange = vi.fn();
    const s = new SaveStore({ local, backup: null, onExternalChange, now: () => new Date('2026-11-02T10:00:00Z') });
    await s.load();
    const sub = vi.fn();
    s.subscribe(sub);
    const { w, fire } = win();
    s.bindLifecycle(w);
    const newer = JSON.stringify(at('2026-11-02T10:00:00Z', { xp: 9, updatedAt: '2026-11-02T10:05:00.000Z' }));
    fire('storage', { key: 'other', newValue: newer });
    expect(s.getState().xp).toBe(0);
    fire('storage', { key: SAVE_KEY, newValue: JSON.stringify(at('2026-11-02T09:00:00Z', { xp: 5, updatedAt: '2026-11-02T09:00:00.000Z' })) });
    expect(s.getState().xp).toBe(0);
    fire('storage', { key: SAVE_KEY, newValue: 'garbage' });
    fire('storage', { key: SAVE_KEY, newValue: null });
    expect(s.getState().xp).toBe(0);
    fire('storage', { key: SAVE_KEY, newValue: newer });
    expect(s.getState().xp).toBe(9);
    expect(onExternalChange).toHaveBeenCalledTimes(1);
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it('read-only stores never adopt', async () => {
    const s = new SaveStore({ local: fakeLocal({ [SAVE_KEY]: JSON.stringify({ v: 99 }) }), backup: null });
    await s.load();
    expect(s.adoptExternal(JSON.stringify(createDefaultSave()))).toBe(false);
  });

  it('M3: flushes on pagehide and on visibilitychange-hidden; unbind removes everything', async () => {
    vi.useFakeTimers();
    try {
      const local = fakeLocal();
      const s = new SaveStore({ local, backup: null, debounceMs: 10_000 });
      const { w, fire, fireDoc, count } = win();
      const off = s.bindLifecycle(w);
      s.update((d) => {
        d.xp = 3;
      });
      expect(local.data.size).toBe(0);
      fire('pagehide');
      await vi.advanceTimersByTimeAsync(0);
      expect(JSON.parse(local.data.get(SAVE_KEY)!).xp).toBe(3);
      s.update((d) => {
        d.xp = 4;
      });
      fireDoc('visibilitychange'); // visible: nothing
      expect(JSON.parse(local.data.get(SAVE_KEY)!).xp).toBe(3);
      w.document.hidden = true;
      fireDoc('visibilitychange');
      await vi.advanceTimersByTimeAsync(0);
      expect(JSON.parse(local.data.get(SAVE_KEY)!).xp).toBe(4);
      off();
      expect(count()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('M4: a corrupt local save is quarantined before it can be overwritten', () => {
  it('copies unreadable local data to <key>.corrupt; future versions are not quarantined', async () => {
    const local = fakeLocal({ [SAVE_KEY]: '{oops' });
    const r = await new SaveStore({ local, backup: null }).load();
    expect(r.source).toBe('default');
    expect(local.data.get(SAVE_KEY + '.corrupt')).toBe('{oops');
    const l2 = fakeLocal({ [SAVE_KEY]: JSON.stringify({ v: 99 }) });
    await new SaveStore({ local: l2, backup: null }).load();
    expect(l2.data.has(SAVE_KEY + '.corrupt')).toBe(false);
    // a full quota must not break loading
    const l3: SyncStorage = { getItem: () => '{oops', setItem: () => { throw new Error('quota'); }, removeItem() {} };
    expect((await new SaveStore({ local: l3, backup: null }).load()).source).toBe('default');
  });
});

describe('I12: unit completion and derived case unlock (table)', () => {
  const CASE_UNITS: CaseUnits = {
    case1: ['u01', 'u02'], case2: ['u03', 'u04'], case3: ['u05', 'u06'], case4: ['u07', 'u08'], case5: ['u09', 'u10'],
    finale: [],
  };
  const done = (): UnitProgress => ({ lessonViewed: true, checks: 2, quizScore: 5 });
  const ids = Object.values(CASE_UNITS).flat();
  const units = (...complete: string[]): Record<string, UnitProgress> =>
    Object.fromEntries(complete.map((u) => [u, done()]));

  it.each([
    ['lesson viewed, 2 checks, quiz 5', { lessonViewed: true, checks: 2, quizScore: 5 }, true],
    ['lesson not viewed', { lessonViewed: false, checks: 3, quizScore: 8 }, false],
    ['only 1 check', { lessonViewed: true, checks: 1, quizScore: 8 }, false],
    ['quiz 4', { lessonViewed: true, checks: 3, quizScore: 4 }, false],
    ['3 checks, quiz 8', { lessonViewed: true, checks: 3, quizScore: 8 }, true],
  ])('isUnitComplete: %s', (_n, u, expected) => {
    expect(isUnitComplete(u)).toBe(expected);
  });

  it.each([
    ['prologue is always open', 'prologue', {}, {}, true],
    ['case1 closed before the prologue', 'case1', {}, {}, false],
    ['case1 open after the prologue', 'case1', {}, { prologue: { solved: true } }, true],
    ['case1 needs no units', 'case1', units(), { prologue: { solved: true } }, true],
    ['case2 with no units', 'case2', {}, { prologue: { solved: true } }, false],
    ['case2 with one unit', 'case2', units('u03'), {}, false],
    ['case2 with both units', 'case2', units('u03', 'u04'), {}, true],
    ['case2 units do not open case3', 'case3', units('u03', 'u04'), {}, false],
    ['case5 with both units', 'case5', units('u09', 'u10'), {}, true],
    ['finale with 9 units', 'finale', units(...ids.slice(0, 9)), {}, false],
    ['finale with all 10', 'finale', units(...ids), {}, true],
    ['unknown case', 'case9', units(...ids), {}, false],
  ] as const)('isCaseUnlocked: %s', (_n, caseId, u, cases, expected) => {
    expect(isCaseUnlocked(caseId, u, CASE_UNITS, cases)).toBe(expected);
  });

  it('finale needs at least one unit to exist; unit 1 alone opens scene 2', () => {
    expect(isCaseUnlocked('finale', {}, { finale: [] })).toBe(false);
    expect(isFirstUnitDone('case1', units('u01'), CASE_UNITS)).toBe(true);
    expect(isFirstUnitDone('case1', units('u02'), CASE_UNITS)).toBe(false);
    expect(isFirstUnitDone('nope', units('u01'), CASE_UNITS)).toBe(false);
  });

  it('is never stored: the schema has no complete/unlocked flag', () => {
    const d = createDefaultSave();
    d.units['u01'] = done();
    d.cases['case1'] = { solved: false };
    const parsed = SaveV1Schema.parse(d);
    expect(JSON.stringify(parsed)).not.toMatch(/"(complete|unlocked)"/);
  });
});

describe('I13: voices (pips), cabinet slots and forgetting', () => {
  it('3 pips = 1 level, capped at 5', () => {
    expect(addVoicePips(undefined, 1)).toEqual({ level: 0, pips: 1 });
    expect(addVoicePips({ level: 0, pips: 2 }, 1)).toEqual({ level: 1, pips: 0 });
    expect(addVoicePips({ level: 2, pips: 1 }, 5)).toEqual({ level: 4, pips: 0 });
    expect(addVoicePips({ level: 4, pips: 2 }, 9)).toEqual({ level: 5, pips: 0 });
    expect(addVoicePips({ level: 1, pips: 0 }, -99)).toEqual({ level: 0, pips: 0 });
    const d = createDefaultSave();
    d.voices['logic'] = { level: 3, pips: 0 };
    expect(voiceLevel(d, 'logic')).toBe(3);
    expect(voiceLevel(d, 'recall')).toBe(0);
  });
  it('slots start at 2, +1 per solved case, max 6; the prologue does not count', () => {
    const d = createDefaultSave();
    expect(cabinetSlots(d)).toBe(2);
    d.cases['prologue'] = { solved: true };
    expect(cabinetSlots(d)).toBe(2);
    for (const c of ['c1', 'c2', 'c3']) d.cases[c] = { solved: true };
    expect(cabinetSlots(d)).toBe(5);
    for (const c of ['c4', 'c5', 'finale']) d.cases[c] = { solved: true };
    expect(cabinetSlots(d)).toBe(6);
  });
  it('forgetting mid-internalisation keeps 50 percent; known/internalised keep their progress', () => {
    expect(forgetThought({ state: 'internalising', progressMs: 100_001, slot: 1 })).toEqual({ state: 'forgotten', progressMs: 50_000 });
    expect(forgetThought({ state: 'internalised', progressMs: 360_000, slot: 0 })).toEqual({ state: 'forgotten', progressMs: 360_000 });
    const d = createDefaultSave();
    d.thoughts['t'] = forgetThought({ state: 'internalising', progressMs: 10, slot: 1 });
    expect(SaveV1Schema.safeParse(d).success).toBe(true);
  });
});
