import { SCENE_MOODS, type SceneMoodId } from '@tikshuv/core';
import type { MoodId, SfxName } from './types.js';

export interface MoodDef {
  /** manifest id of the music cue; null = keep whatever is playing (only the trim applies) */
  music: string | null;
  /** ambience layer ids; 'keep' = leave the current bed (overlay moods) */
  ambience: readonly string[] | 'keep';
  /** low-pass cutoff colouring the music (Hz); lower = darker/muffled */
  filterHz: number;
  filterQ: number;
  /** music trim in dB (VOICE_BIBLE: -6 dB lesson/quiz, -3 dB interview, -6 dB = ducked 50 percent) */
  musicGainDb: number;
  /** ambience bed trim in dB; -Infinity = silent (red check) */
  ambienceGainDb: number;
  /** optional one-shot played when the mood starts (needs an unlocked context) */
  stinger?: SfxName;
  /** synth-fallback pad: root frequency + chord intervals in semitones */
  rootHz: number;
  chord: readonly number[];
}

const PAD = {
  calm: { rootHz: 130.81, chord: [0, 7, 12, 16] },
  noir: { rootHz: 110, chord: [0, 3, 6, 10] },
  bright: { rootHz: 146.83, chord: [0, 4, 7, 14] },
  driving: { rootHz: 98, chord: [0, 1, 7, 6] },
  sparse: { rootHz: 116.54, chord: [0, 3, 7, 10] },
  warm: { rootHz: 174.61, chord: [0, 4, 7, 12] },
  dark: { rootHz: 55, chord: [0, 7] },
  hushed: { rootHz: 82.41, chord: [0, 7, 12] },
} as const;

const d = (
  music: string | null,
  ambience: readonly string[] | 'keep',
  filterHz: number,
  pad: { rootHz: number; chord: readonly number[] },
  extra: Partial<Pick<MoodDef, 'musicGainDb' | 'ambienceGainDb' | 'stinger' | 'filterQ'>> = {},
): MoodDef => ({
  music, ambience, filterHz, filterQ: extra.filterQ ?? 0.8,
  musicGainDb: extra.musicGainDb ?? 0, ambienceGainDb: extra.ambienceGainDb ?? 0,
  ...(extra.stinger ? { stinger: extra.stinger } : {}),
  ...pad,
});

/** Mood table keyed by the VOICE_BIBLE section 5 ids: music cue, ambience bed, colour and trims. */
export const MOODS: Record<MoodId, MoodDef> = {
  mood_title: d('mus_title', ['amb_street_rain'], 5000, PAD.calm),
  mood_hub: d('mus_bureau', ['amb_office', 'amb_street_rain'], 6000, PAD.calm),
  mood_hub_first_day: d('mus_bureau', ['amb_office', 'amb_street_rain'], 7000, PAD.bright),
  mood_lesson: d('mus_bureau', ['amb_office'], 7000, PAD.calm, { musicGainDb: -6 }),
  mood_c1_post: d('mus_investigate', ['amb_post_sorting'], 4500, PAD.noir),
  mood_c2_harbour: d('mus_investigate', ['amb_harbour'], 3000, PAD.noir),
  mood_c3_newsroom: d('mus_investigate', ['amb_press'], 4000, PAD.noir),
  mood_c4_basement: d('mus_investigate', ['amb_server'], 2200, PAD.sparse),
  mood_c5_lighthouse: d('mus_investigate', ['amb_lighthouse_wind'], 3500, PAD.hushed),
  mood_interview: d('mus_investigate', 'keep', 4000, PAD.noir, { musicGainDb: -3 }),
  mood_terminal: d('mus_terminal', ['amb_server'], 1800, PAD.sparse, { filterQ: 1.1 }),
  mood_cabinet: d(null, ['amb_office'], 3000, PAD.hushed, { musicGainDb: -6 }),
  mood_check_white: d('mus_deduction', 'keep', 8000, PAD.bright, { ambienceGainDb: -6 }),
  mood_check_red: d('mus_deduction', 'keep', 2500, PAD.driving, { ambienceGainDb: -Infinity, filterQ: 1.4 }),
  mood_fail_forward: d('mus_investigate', 'keep', 5000, PAD.calm, { musicGainDb: -3 }),
  mood_quiz: d('mus_investigate', ['amb_office'], 5500, PAD.bright, { musicGainDb: -6 }),
  mood_mg_easy: d('mus_minigame_easy', [], 9000, PAD.bright),
  mood_mg_hard: d('mus_minigame_hard', [], 1800, PAD.driving, { filterQ: 2 }),
  mood_solved: d('mus_solved', [], 10000, PAD.warm, { filterQ: 0.6 }),
  mood_tube_note: d('mus_bureau', 'keep', 6000, PAD.calm, { stinger: 'whoosh', musicGainDb: -3 }),
  mood_warn10: d(null, 'keep', 3000, PAD.noir, { musicGainDb: -3 }),
  mood_blackout: d('mus_blackout', [], 500, PAD.dark, { stinger: 'blackout', filterQ: 1 }),
  mood_finale_dark: d('mus_finale', ['amb_street_rain'], 1500, PAD.hushed),
  mood_finale_restore: d('mus_finale', ['amb_server'], 6000, PAD.bright),
  mood_finale_roof: d('mus_solved', ['amb_street_rain'], 9000, PAD.warm),
};

/** Guard against drift: every scene mood has a row (checked in tests too). */
export const MOOD_IDS: readonly SceneMoodId[] = SCENE_MOODS;
