import { get as idbGet, set as idbSet } from 'idb-keyval';
import { migrate, type Migration, migrations as defaultMigrations } from './migrations.js';
import { CURRENT_VERSION, SaveV1Schema, createDefaultSave, type SaveV1 } from './schema.js';

export interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface AsyncKV {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export const SAVE_KEY = 'tikshuv.cf.save';
export const APP_ID = 'case-files';

export type LoadSource = 'local' | 'backup' | 'default';
export interface LoadResult {
  state: SaveV1;
  source: LoadSource;
  /** true when the stored save is from a newer app version; saving is disabled */
  readOnly: boolean;
  migrated: boolean;
  warnings: string[];
}
export type SaveResult =
  | { ok: true; mirrored: boolean }
  | { ok: false; reason: 'quota' | 'unavailable' | 'read-only'; mirrored: boolean };
export type ImportResult = { ok: true; state: SaveV1 } | { ok: false; error: string };

export interface SaveStoreOptions {
  local?: SyncStorage | null;
  backup?: AsyncKV | null;
  key?: string;
  debounceMs?: number;
  now?: () => Date;
  migrations?: readonly Migration[];
  latestVersion?: number;
  onError?: (msg: string, err?: unknown) => void;
  /** another tab saved a newer state; the store has already adopted it (show a notice or re-render) */
  onExternalChange?: (s: Readonly<SaveV1>) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

function defaultLocal(): SyncStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
const defaultBackup: AsyncKV = {
  get: (k) => idbGet<string>(k),
  set: (k, v) => idbSet(k, v),
};

function isQuota(e: unknown): boolean {
  const x = e as { name?: string; code?: number } | null;
  return (
    !!x &&
    (x.name === 'QuotaExceededError' ||
      x.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      x.code === 22 ||
      x.code === 1014)
  );
}

/** Merge parsed data over defaults so fields added later (or a missing nested object) never discard a save. */
function deepMerge(base: unknown, over: unknown): unknown {
  const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!plain(base) || !plain(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

export interface LifecycleTarget {
  addEventListener(type: string, fn: (e: never) => void): void;
  removeEventListener(type: string, fn: (e: never) => void): void;
  document?: {
    hidden: boolean;
    addEventListener(type: string, fn: () => void): void;
    removeEventListener(type: string, fn: () => void): void;
  };
}

interface Parsed {
  state?: SaveV1;
  future?: boolean;
  migrated?: boolean;
  error?: string;
}

export class SaveStore {
  private readonly local: SyncStorage | null;
  private readonly backup: AsyncKV | null;
  private readonly key: string;
  private readonly debounceMs: number;
  private readonly now: () => Date;
  private readonly chain: readonly Migration[];
  private readonly latest: number;
  private readonly onError: (msg: string, err?: unknown) => void;
  private readonly onExternalChange: ((s: Readonly<SaveV1>) => void) | undefined;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private state: SaveV1;
  private readOnly = false;
  private timer: unknown = null;
  private listeners = new Set<(s: Readonly<SaveV1>) => void>();
  lastResult: SaveResult | null = null;

  constructor(opts: SaveStoreOptions = {}) {
    this.local = opts.local === undefined ? defaultLocal() : opts.local;
    this.backup = opts.backup === undefined ? defaultBackup : opts.backup;
    this.key = opts.key ?? SAVE_KEY;
    this.debounceMs = opts.debounceMs ?? 250;
    this.now = opts.now ?? (() => new Date());
    this.chain = opts.migrations ?? defaultMigrations;
    this.latest = opts.latestVersion ?? CURRENT_VERSION;
    this.onError = opts.onError ?? (() => {});
    this.onExternalChange = opts.onExternalChange;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.state = createDefaultSave(this.now());
  }

  getState(): Readonly<SaveV1> {
    return this.state;
  }
  isReadOnly(): boolean {
    return this.readOnly;
  }

  subscribe(cb: (s: Readonly<SaveV1>) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private parse(raw: string | null | undefined): Parsed {
    if (raw == null) return { error: 'empty' };
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      return { error: 'corrupt JSON' };
    }
    const m = migrate(obj, this.latest, this.chain);
    if (m.status === 'future') return { future: true, error: `future version ${m.version}` };
    if (m.status === 'error') return { error: m.reason };
    const parsed = SaveV1Schema.safeParse(deepMerge(createDefaultSave(this.now()), m.data));
    if (!parsed.success) return { error: 'schema: ' + parsed.error.issues[0]?.message };
    return { state: parsed.data, migrated: m.migrated };
  }

  /** Never throws. Order: localStorage -> IndexedDB backup -> default. */
  async load(): Promise<LoadResult> {
    const warnings: string[] = [];
    const defaulted = (readOnly: boolean): LoadResult => {
      this.state = createDefaultSave(this.now());
      this.readOnly = readOnly;
      return { state: this.state, source: 'default', readOnly, migrated: false, warnings };
    };
    const adopt = (r: Parsed, source: LoadSource): LoadResult => {
      this.state = r.state as SaveV1;
      this.readOnly = false;
      return { state: this.state, source, readOnly: false, migrated: !!r.migrated, warnings };
    };
    let raw: string | null = null;
    try {
      raw = this.local?.getItem(this.key) ?? null;
    } catch (e) {
      warnings.push('localStorage read failed');
      this.onError('localStorage read failed', e);
    }
    let localOk: Parsed | undefined;
    if (raw !== null) {
      const r = this.parse(raw);
      if (r.state) localOk = r;
      else {
        warnings.push(`local save unusable: ${r.error}`);
        if (r.future) return defaulted(true);
        this.quarantine(raw); // keep the unreadable copy before the next save overwrites it
      }
    }
    if (this.backup) {
      try {
        const braw = await this.backup.get(this.key);
        const r = this.parse(braw);
        if (r.state) {
          // the mirror can be newer than localStorage when a quota error left local behind
          if (!localOk?.state || Date.parse(r.state.updatedAt) > Date.parse(localOk.state.updatedAt)) {
            warnings.push(localOk ? 'backup is newer than local; restored from backup' : 'restored from backup');
            return adopt(r, 'backup');
          }
        } else {
          if (braw != null) warnings.push(`backup unusable: ${r.error}`);
          if (r.future && !localOk) return defaulted(true);
        }
      } catch (e) {
        warnings.push('backup read failed');
        this.onError('backup read failed', e);
      }
    }
    if (localOk) return adopt(localOk, 'local');
    return defaulted(false);
  }

  private quarantine(raw: string): void {
    try {
      this.local?.setItem(this.key + '.corrupt', raw);
    } catch {
      /* best effort */
    }
  }

  /**
   * Flush on pagehide AND on visibilitychange-hidden (iPad Safari often skips pagehide), and adopt a
   * newer save written by another tab (storage event) instead of overwriting it. Returns an unbind.
   */
  bindLifecycle(win: LifecycleTarget): () => void {
    const flush = () => void this.flush();
    const doc = win.document;
    const vis = () => {
      if (doc?.hidden) flush();
    };
    const onStorage = (e: { key: string | null; newValue: string | null }) => {
      if (e.key !== this.key) return;
      this.adoptExternal(e.newValue);
    };
    win.addEventListener('pagehide', flush);
    win.addEventListener('storage', onStorage as (e: never) => void);
    doc?.addEventListener('visibilitychange', vis);
    return () => {
      win.removeEventListener('pagehide', flush);
      win.removeEventListener('storage', onStorage as (e: never) => void);
      doc?.removeEventListener('visibilitychange', vis);
    };
  }

  /** A write from another tab arrived: adopt it if it is newer than ours. Returns true if adopted. */
  adoptExternal(raw: string | null): boolean {
    if (this.readOnly || raw === null) return false;
    const r = this.parse(raw);
    if (!r.state) return false;
    if (Date.parse(r.state.updatedAt) <= Date.parse(this.state.updatedAt)) return false;
    this.state = r.state;
    for (const l of this.listeners) l(this.state);
    this.onExternalChange?.(this.state);
    return true;
  }

  /** Write now. Never throws; failures are reported in the result. */
  async save(state: SaveV1 = this.state): Promise<SaveResult> {
    if (this.readOnly) return (this.lastResult = { ok: false, reason: 'read-only', mirrored: false });
    const json = JSON.stringify(state);
    let reason: 'quota' | 'unavailable' | null = null;
    if (!this.local) reason = 'unavailable';
    else {
      try {
        this.local.setItem(this.key, json);
      } catch (e) {
        reason = isQuota(e) ? 'quota' : 'unavailable';
        this.onError(`localStorage write failed (${reason})`, e);
      }
    }
    let mirrored = false;
    if (this.backup) {
      try {
        await this.backup.set(this.key, json);
        mirrored = true;
      } catch (e) {
        this.onError('backup write failed', e);
      }
    }
    return (this.lastResult = reason ? { ok: false, reason, mirrored } : { ok: true, mirrored });
  }

  /** Mutate a copy, validate, notify subscribers, schedule debounced save. */
  update(mutator: (draft: SaveV1) => void): void {
    if (this.readOnly) return;
    const draft = structuredClone(this.state);
    mutator(draft);
    draft.updatedAt = this.now().toISOString();
    const ok = SaveV1Schema.safeParse(draft);
    if (!ok.success) {
      this.onError('update rejected: ' + ok.error.issues[0]?.message);
      return;
    }
    this.state = ok.data;
    for (const l of this.listeners) l(this.state);
    this.scheduleSave();
  }

  scheduleSave(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.save();
    }, this.debounceMs);
  }

  /** Cancel pending debounce and save immediately (call on pagehide). */
  async flush(): Promise<SaveResult | null> {
    if (this.timer === null) return null;
    this.clearTimer(this.timer);
    this.timer = null;
    return this.save();
  }

  exportJson(): string {
    return JSON.stringify(
      { app: APP_ID, v: this.state.v, savedAt: this.now().toISOString(), state: this.state },
      null,
      2,
    );
  }

  /** Validate and adopt an exported file (or a bare save). State untouched on failure. */
  async importJson(text: string): Promise<ImportResult> {
    let obj: unknown;
    try {
      obj = JSON.parse(text);
    } catch {
      return { ok: false, error: 'not valid JSON' };
    }
    if (typeof obj !== 'object' || obj === null) return { ok: false, error: 'not an object' };
    const rec = obj as Record<string, unknown>;
    let inner: unknown = obj;
    if ('state' in rec) {
      if (rec['app'] !== APP_ID) return { ok: false, error: 'wrong app' };
      inner = rec['state'];
    }
    const r = this.parse(JSON.stringify(inner));
    if (!r.state) {
      return { ok: false, error: r.future ? 'save is from a newer version' : (r.error ?? 'invalid') };
    }
    this.readOnly = false;
    this.state = r.state;
    for (const l of this.listeners) l(this.state);
    await this.save();
    return { ok: true, state: r.state };
  }
}

export function createSaveStore(opts?: SaveStoreOptions): SaveStore {
  return new SaveStore(opts);
}
