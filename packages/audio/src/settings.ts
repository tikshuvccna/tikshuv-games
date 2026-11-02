import { BUS_NAMES, type BusName } from './types';

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
  ui: number;
  /** muted flags: 'master' mutes everything. */
  muted: Record<'master' | BusName, boolean>;
  /** shortens stingers / reduces sensory load */
  reducedSensory: boolean;
}

/** Sound is OFF by default on first run (school use, spec 04 section 6). */
export function defaultSettings(): AudioSettings {
  return {
    master: 0.8, music: 0.7, sfx: 0.9, ambience: 0.6, ui: 0.8,
    muted: { master: true, music: false, sfx: false, ambience: false, ui: false },
    reducedSensory: false,
  };
}

const clamp01 = (n: unknown, d: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d;

/** Tolerant parse of persisted data (unknown shape -> valid settings). */
export function sanitizeSettings(raw: unknown): AudioSettings {
  const d = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const m = (typeof r['muted'] === 'object' && r['muted'] !== null ? r['muted'] : {}) as Record<string, unknown>;
  const muted = { ...d.muted };
  for (const k of ['master', ...BUS_NAMES] as const) {
    if (typeof m[k] === 'boolean') muted[k] = m[k] as boolean;
  }
  return {
    master: clamp01(r['master'], d.master),
    music: clamp01(r['music'], d.music),
    sfx: clamp01(r['sfx'], d.sfx),
    ambience: clamp01(r['ambience'], d.ambience),
    ui: clamp01(r['ui'], d.ui),
    muted,
    reducedSensory: typeof r['reducedSensory'] === 'boolean' ? r['reducedSensory'] : d.reducedSensory,
  };
}
