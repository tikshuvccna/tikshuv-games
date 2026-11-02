import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  migrate,
  SaveStore,
  SAVE_KEY,
  createDefaultSave,
  isUnitComplete,
  SaveV1Schema,
  type AsyncKV,
  type SyncStorage,
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

describe('schema', () => {
  it('default validates; unit rule', () => {
    expect(SaveV1Schema.safeParse(createDefaultSave()).success).toBe(true);
    expect(isUnitComplete({ lessonViewed: true, checks: 2, quizScore: 5 })).toBe(true);
    expect(isUnitComplete({ lessonViewed: true, checks: 1, quizScore: 8 })).toBe(false);
    expect(isUnitComplete({ lessonViewed: false, checks: 3, quizScore: 8 })).toBe(false);
  });
});

describe('SaveStore', () => {
  it('roundtrips via localStorage and mirrors to backup', async () => {
    const local = fakeLocal();
    const backup = fakeBackup();
    const a = new SaveStore({ local, backup });
    await a.load();
    a.update((d) => {
      d.xp = 42;
      d.voices['logic'] = { level: 3, pips: 1 };
      d.units['u05'] = { lessonViewed: true, checks: 2, quizScore: 6 };
    });
    expect(await a.flush()).toEqual({ ok: true, mirrored: true });
    const r = await new SaveStore({ local, backup }).load();
    expect(r.source).toBe('local');
    expect(r.state.xp).toBe(42);
    expect(r.state.voices['logic']).toEqual({ level: 3, pips: 1 });
    expect(backup.data.get(SAVE_KEY)).toBe(local.data.get(SAVE_KEY));
  });

  it('works with real idb-keyval default backend', async () => {
    const local = fakeLocal();
    const a = new SaveStore({ local });
    await a.load();
    a.update((d) => {
      d.xp = 7;
    });
    await a.flush();
    local.data.clear();
    const r = await new SaveStore({ local }).load();
    expect(r.source).toBe('backup');
    expect(r.state.xp).toBe(7);
  });

  it('debounces autosave', async () => {
    vi.useFakeTimers();
    const local = fakeLocal();
    const s = new SaveStore({ local, backup: null, debounceMs: 100 });
    const cb = vi.fn();
    const unsub = s.subscribe(cb);
    s.update((d) => {
      d.xp = 1;
    });
    s.update((d) => {
      d.xp = 2;
    });
    expect(local.data.size).toBe(0);
    await vi.advanceTimersByTimeAsync(150);
    expect(JSON.parse(local.data.get(SAVE_KEY) ?? '{}').xp).toBe(2);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(await s.flush()).toBeNull();
    unsub();
    vi.useRealTimers();
  });

  it('rejects invalid update', () => {
    const onError = vi.fn();
    const s = new SaveStore({ local: fakeLocal(), backup: null, onError });
    s.update((d) => {
      d.voices['logic'] = { level: 9, pips: 0 };
    });
    expect(s.getState().voices['logic']).toBeUndefined();
    expect(onError).toHaveBeenCalled();
  });

  it('recovers from corrupted JSON via backup, then default', async () => {
    const backup = fakeBackup();
    const good = createDefaultSave();
    good.xp = 99;
    backup.data.set(SAVE_KEY, JSON.stringify(good));
    const r1 = await new SaveStore({ local: fakeLocal({ [SAVE_KEY]: '{oops' }), backup }).load();
    expect(r1.source).toBe('backup');
    expect(r1.state.xp).toBe(99);
    backup.data.set(SAVE_KEY, 'garbage');
    const r2 = await new SaveStore({ local: fakeLocal({ [SAVE_KEY]: '{"v":1,"xp":-5}' }), backup }).load();
    expect(r2.source).toBe('default');
    expect(r2.state.xp).toBe(0);
    expect(r2.warnings.length).toBeGreaterThan(0);
  });

  it('load never throws when storages throw', async () => {
    const local: SyncStorage = {
      getItem() {
        throw new Error('x');
      },
      setItem() {},
      removeItem() {},
    };
    const backup: AsyncKV = {
      get: async () => {
        throw new Error('y');
      },
      set: async () => {},
    };
    const r = await new SaveStore({ local, backup }).load();
    expect(r.source).toBe('default');
  });

  it('handles QuotaExceededError without throwing', async () => {
    const local: SyncStorage = {
      getItem: () => null,
      removeItem() {},
      setItem() {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    const s = new SaveStore({ local, backup: fakeBackup() });
    expect(await s.save()).toEqual({ ok: false, reason: 'quota', mirrored: true });
    const s2 = new SaveStore({
      local: null,
      backup: {
        get: async () => undefined,
        set: async () => {
          throw new Error('no');
        },
      },
    });
    expect(await s2.save()).toEqual({ ok: false, reason: 'unavailable', mirrored: false });
  });

  it('future version is read-only and never overwritten', async () => {
    const local = fakeLocal({ [SAVE_KEY]: JSON.stringify({ v: 99, xp: 5 }) });
    const s = new SaveStore({ local, backup: null });
    const r = await s.load();
    expect(r.readOnly).toBe(true);
    expect(await s.save()).toMatchObject({ ok: false, reason: 'read-only' });
    s.update((d) => {
      d.xp = 1;
    });
    expect(local.data.get(SAVE_KEY)).toContain('99');
  });

  it('export/import roundtrip and validation', async () => {
    const a = new SaveStore({ local: fakeLocal(), backup: null });
    a.update((d) => {
      d.xp = 5;
      d.prizes.push('p1');
    });
    const json = a.exportJson();
    const b = new SaveStore({ local: fakeLocal(), backup: null });
    expect((await b.importJson(json)).ok).toBe(true);
    expect(b.getState().prizes).toEqual(['p1']);
    expect((await b.importJson('nope')).ok).toBe(false);
    expect((await b.importJson('5')).ok).toBe(false);
    expect((await b.importJson(JSON.stringify({ app: 'other', state: {} }))).ok).toBe(false);
    const bad = JSON.parse(json);
    bad.state.xp = -3;
    expect((await b.importJson(JSON.stringify(bad))).ok).toBe(false);
    const fut = JSON.parse(json);
    fut.state.v = 7;
    const fr = await b.importJson(JSON.stringify(fut));
    expect(fr.ok).toBe(false);
    expect(b.getState().xp).toBe(5);
    expect((await b.importJson(JSON.stringify(createDefaultSave()))).ok).toBe(true);
  });
});

describe('migrations', () => {
  const chain = [{ from: 1, to: 2, migrate: (s: Record<string, unknown>) => ({ ...s, textScale: 1 }) }];
  it('v1 -> v2 stub', () => {
    expect(migrate({ v: 1, a: 1 }, 2, chain)).toEqual({
      status: 'ok',
      migrated: true,
      data: { v: 2, a: 1, textScale: 1 },
    });
  });
  it('no-op, future, errors', () => {
    expect(migrate({ v: 1 }, 1, [])).toMatchObject({ status: 'ok', migrated: false });
    expect(migrate({ v: 3 }, 2, chain)).toEqual({ status: 'future', version: 3 });
    expect(migrate({ v: 1 }, 2, [])).toMatchObject({ status: 'error' });
    expect(migrate(null, 1)).toMatchObject({ status: 'error' });
    expect(migrate({ v: 'x' }, 1)).toMatchObject({ status: 'error' });
    const boom = [
      {
        from: 1,
        to: 2,
        migrate: (): Record<string, unknown> => {
          throw new Error('b');
        },
      },
    ];
    expect(migrate({ v: 1 }, 2, boom)).toMatchObject({ status: 'error' });
  });
});
