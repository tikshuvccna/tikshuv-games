import { z } from 'zod';
import { VOICE_IDS, type VoiceId } from '@tikshuv/core';
import { defaultSettings, sanitizeSettings, type AudioSettings } from '@tikshuv/audio';

export const CURRENT_VERSION = 1;

const iso = z.string();
const nonNegInt = z.number().int().min(0);
const VoiceKey = z.enum(VOICE_IDS);

export const UnitProgressSchema = z.object({
  /** lesson beats viewed (spec 03: part of the completion rule) */
  lessonViewed: z.boolean().default(false),
  /** number of in-unit checks passed (unit completes at >=2 of 3) */
  checks: nonNegInt.max(3).default(0),
  /** best quiz score out of 8 (unit completes at >=5) */
  quizScore: nonNegInt.max(8).default(0),
});

export const CaseStateSchema = z.object({
  /** unlock is derived (isCaseUnlocked), never stored */
  solved: z.boolean().default(false),
  currentScene: z.string().optional(),
});

/** 3 pips = 1 level (spec 02 section 4.3). Doubles as the spec 01 `skills` record. */
export const VoiceProgressSchema = z.object({
  level: z.number().int().min(0).max(5).default(0),
  pips: z.number().int().min(0).max(2).default(0),
});

/** spec 02 section 5.3 ThoughtState; progressMs counts active play time */
export const ThoughtStateSchema = z.object({
  state: z.enum(['locked', 'known', 'internalising', 'internalised', 'forgotten']),
  progressMs: z.number().min(0).default(0),
  slot: nonNegInt.optional(),
});

/** Resume point of the dialogue runner (structurally = DialogueSnapshot in @tikshuv/dialogue). */
export const DialogueProgressSchema = z.object({
  sceneId: z.string(),
  nodeId: z.string(),
  flags: z.record(z.string(), z.union([z.boolean(), z.number()])).default({}),
  visited: z.array(z.string()).default([]),
  used: z.array(z.string()).default([]),
  redResults: z.record(z.string(), z.boolean()).default({}),
  modifiers: z.partialRecord(VoiceKey, z.number()).default({}),
  inspected: z.array(z.string()).default([]),
  reasoning: z.record(z.string(), z.boolean()).default({}),
});

export const MinigameBestSchema = z.object({
  bestScore: nonNegInt.default(0),
  stars: z.number().int().min(0).max(3).default(0),
});

const AudioSettingsSchema = z
  .unknown()
  .optional()
  .transform((v): AudioSettings => (v === undefined ? defaultSettings() : sanitizeSettings(v)));

export const SaveV1Schema = z.object({
  v: z.literal(1),
  createdAt: iso,
  updatedAt: iso,
  profile: z
    .object({
      displayName: z.string().max(40).default(''),
      avatarId: z.string().default('default'),
      classCode: z.string().optional(),
    })
    .prefault({}),
  settings: z
    .object({
      language: z.enum(['he']).default('he'),
      /** session cap in minutes: 10, 12 (default, D7), 15, or null = off */
      sessionCapMinutes: z.union([z.literal(10), z.literal(12), z.literal(15), z.null()]).default(12),
      /** single source of truth for sound; first-run default is master muted (spec 04 section 6) */
      audio: AudioSettingsSchema,
      reducedMotion: z.enum(['auto', 'on', 'off']).default('auto'),
    })
    .prefault({}),
  units: z.record(z.string(), UnitProgressSchema).default({}),
  cases: z.record(z.string(), CaseStateSchema).default({}),
  /** inner voice levels (spec 01 `skills`): key is a VoiceId */
  voices: z.partialRecord(VoiceKey, VoiceProgressSchema).default({}),
  /** thought cabinet states; slots are derived from cases solved (cabinetSlots) */
  thoughts: z.record(z.string(), ThoughtStateSchema).default({}),
  /** story flags and counters set by dialogue / game code */
  flags: z.record(z.string(), z.union([z.boolean(), z.number()])).default({}),
  /** evidence ids the player holds (spec 01 inventory.evidence) */
  evidence: z.array(z.string()).default([]),
  coins: nonNegInt.default(0),
  achievements: z.record(z.string(), iso).default({}),
  minigames: z.record(z.string(), z.partialRecord(z.enum(['easy', 'medium', 'hard']), MinigameBestSchema)).default({}),
  /** where the dialogue runner resumes (last beat start) */
  dialogue: DialogueProgressSchema.optional(),
  /** session timer: elapsed survives reload; lastActiveAt decides a new session after 30 min idle */
  session: z
    .object({
      elapsedMs: z.number().min(0).default(0),
      warned: z.boolean().default(false),
      ended: z.boolean().default(false),
      startedAt: iso.optional(),
      lastActiveAt: iso.optional(),
    })
    .prefault({}),
  xp: nonNegInt.default(0),
  prizes: z.array(z.string()).default([]),
  lastPlayedAt: iso.nullable().default(null),
});

export type SaveV1 = z.infer<typeof SaveV1Schema>;
export type Save = SaveV1;
export type UnitProgress = z.infer<typeof UnitProgressSchema>;
export type ThoughtState = z.infer<typeof ThoughtStateSchema>;
export type VoiceProgress = z.infer<typeof VoiceProgressSchema>;
export const SaveSchema = SaveV1Schema;

export function createDefaultSave(now: Date = new Date()): SaveV1 {
  const t = now.toISOString();
  return {
    v: 1,
    createdAt: t,
    updatedAt: t,
    profile: { displayName: '', avatarId: 'default' },
    settings: { language: 'he', sessionCapMinutes: 12, audio: defaultSettings(), reducedMotion: 'auto' },
    units: {},
    cases: {},
    voices: {},
    thoughts: {},
    flags: {},
    evidence: [],
    coins: 0,
    achievements: {},
    minigames: {},
    session: { elapsedMs: 0, warned: false, ended: false },
    xp: 0,
    prizes: [],
    lastPlayedAt: null,
  };
}

/** Unit completion rule (spec 03): lesson beats viewed, >=2 of 3 checks, quiz >= 5/8. */
export function isUnitComplete(u: Pick<UnitProgress, 'checks' | 'quizScore'> & { lessonViewed?: boolean }): boolean {
  return u.lessonViewed === true && u.checks >= 2 && u.quizScore >= 5;
}

/** Case id to the two unit ids it teaches. 'finale' is derived (all units), see isCaseUnlocked. */
export type CaseUnits = Readonly<Record<string, readonly string[]>>;

/**
 * Derived, never stored (spec 03 section 2):
 * - the prologue is always open; Case 1 opens once the prologue is solved;
 * - a later case opens when BOTH of its units are complete (and it is not the first);
 * - the finale needs every unit of every case.
 * `caseUnits` lists the cases in play order; its first entry is Case 1, 'finale' is handled specially.
 */
export function isCaseUnlocked(
  caseId: string,
  units: Readonly<Record<string, UnitProgress | undefined>>,
  caseUnits: CaseUnits,
  cases: Readonly<Record<string, { solved: boolean } | undefined>> = {},
): boolean {
  if (caseId === 'prologue') return true;
  const done = (id: string): boolean => {
    const u = units[id];
    return !!u && isUnitComplete(u);
  };
  if (caseId === 'finale') {
    const all = Object.entries(caseUnits).filter(([k]) => k !== 'finale').flatMap(([, v]) => v);
    return all.length > 0 && all.every(done);
  }
  const order = Object.keys(caseUnits).filter((k) => k !== 'finale');
  const idx = order.indexOf(caseId);
  if (idx < 0) return false;
  if (idx === 0) return cases['prologue']?.solved === true;
  return (caseUnits[caseId] ?? []).every(done);
}

/** Spec 01: unit 1 alone opens scene 2 (inspection scene) of its case. */
export function isFirstUnitDone(
  caseId: string,
  units: Readonly<Record<string, UnitProgress | undefined>>,
  caseUnits: CaseUnits,
): boolean {
  const first = caseUnits[caseId]?.[0];
  const u = first ? units[first] : undefined;
  return !!u && isUnitComplete(u);
}

/** Thought slots: start 2, +1 per solved case, max 6 (spec 02 section 5.2). */
export function cabinetSlots(save: Pick<SaveV1, 'cases'>): number {
  const solved = Object.entries(save.cases).filter(([k, c]) => k !== 'prologue' && c.solved).length;
  return Math.min(6, 2 + solved);
}

/** 3 pips = 1 level, capped at 5 (spec 02 section 4.3). Returns the new progress. */
export function addVoicePips(p: VoiceProgress | undefined, pips: number): VoiceProgress {
  const total = (p?.level ?? 0) * 3 + (p?.pips ?? 0) + pips;
  const capped = Math.min(15, Math.max(0, total));
  return capped >= 15 ? { level: 5, pips: 0 } : { level: Math.floor(capped / 3), pips: capped % 3 };
}

/** Forgetting mid-internalisation keeps 50 percent of the elapsed progress (spec 02 section 5.2). */
export function forgetThought(t: ThoughtState): ThoughtState {
  const { slot: _slot, ...rest } = t;
  return { ...rest, state: 'forgotten', progressMs: t.state === 'internalising' ? Math.floor(t.progressMs / 2) : t.progressMs };
}

export function voiceLevel(save: Pick<SaveV1, 'voices'>, v: VoiceId): number {
  return save.voices[v]?.level ?? 0;
}
