import { z } from 'zod';

export const CURRENT_VERSION = 1;

const iso = z.string();
const nonNegInt = z.number().int().min(0);

export const UnitProgressSchema = z.object({
  /** number of in-unit checks passed (unit completes at >=2 of 3) */
  checks: nonNegInt.max(3).default(0),
  /** best quiz score out of 8 (unit completes at >=5) */
  quizScore: nonNegInt.max(8).default(0),
  complete: z.boolean().default(false),
});

export const CaseStateSchema = z.object({
  unlocked: z.boolean().default(false),
  solved: z.boolean().default(false),
  currentScene: z.string().optional(),
});

export const SaveV1Schema = z.object({
  v: z.literal(1),
  createdAt: iso,
  updatedAt: iso,
  profile: z.object({
    displayName: z.string().max(40).default(''),
    avatarId: z.string().default('default'),
    classCode: z.string().optional(),
  }),
  settings: z.object({
    language: z.enum(['he']).default('he'),
    /** session cap in minutes: 10, 15, or null = off */
    sessionCapMinutes: z.union([z.literal(10), z.literal(15), z.null()]).default(15),
    musicVolume: z.number().min(0).max(1).default(0.6),
    sfxVolume: z.number().min(0).max(1).default(0.8),
    muted: z.boolean().default(false),
    reducedMotion: z.enum(['auto', 'on', 'off']).default('auto'),
  }),
  units: z.record(z.string(), UnitProgressSchema).default({}),
  cases: z.record(z.string(), CaseStateSchema).default({}),
  /** inner voice levels, 0-5 */
  voices: z.record(z.string(), z.number().int().min(0).max(5)).default({}),
  cabinet: z.object({
    slots: nonNegInt.default(3),
    internalising: z.array(z.object({ id: z.string(), minutesLeft: z.number().min(0) })).default([]),
    internalised: z.array(z.string()).default([]),
  }),
  xp: nonNegInt.default(0),
  prizes: z.array(z.string()).default([]),
  lastPlayedAt: iso.nullable().default(null),
});

export type SaveV1 = z.infer<typeof SaveV1Schema>;
export type Save = SaveV1;
export type UnitProgress = z.infer<typeof UnitProgressSchema>;
export const SaveSchema = SaveV1Schema;

export function createDefaultSave(now: Date = new Date()): SaveV1 {
  const t = now.toISOString();
  return {
    v: 1,
    createdAt: t,
    updatedAt: t,
    profile: { displayName: '', avatarId: 'default' },
    settings: {
      language: 'he',
      sessionCapMinutes: 15,
      musicVolume: 0.6,
      sfxVolume: 0.8,
      muted: false,
      reducedMotion: 'auto',
    },
    units: {},
    cases: {},
    voices: {},
    cabinet: { slots: 3, internalising: [], internalised: [] },
    xp: 0,
    prizes: [],
    lastPlayedAt: null,
  };
}

/** Unit completion rule from spec: >=2 of 3 checks and quiz >= 5/8. */
export function isUnitComplete(u: Pick<UnitProgress, 'checks' | 'quizScore'>): boolean {
  return u.checks >= 2 && u.quizScore >= 5;
}
