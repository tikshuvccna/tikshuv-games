import type { MoodId } from './types';

export interface MoodDef {
  /** manifest id of the music cue (synth pad is used if the file is missing) */
  music: string;
  /** ambience layer ids */
  ambience: readonly string[];
  /** low-pass cutoff colouring the music (Hz); lower = darker/muffled */
  filterHz: number;
  filterQ: number;
  /** synth-fallback pad: root frequency + chord intervals in semitones */
  rootHz: number;
  chord: readonly number[];
}

export const MOODS: Record<MoodId, MoodDef> = {
  calm:       { music: 'mus_bureau',        ambience: ['amb_office'],      filterHz: 6000,  filterQ: 0.7, rootHz: 130.81, chord: [0, 7, 12, 16] },
  tense:      { music: 'mus_investigate',   ambience: ['amb_server'],      filterHz: 2500,  filterQ: 1.2, rootHz: 110,    chord: [0, 3, 6, 10] },
  discovery:  { music: 'mus_deduction',     ambience: ['amb_office'],      filterHz: 8000,  filterQ: 0.8, rootHz: 146.83, chord: [0, 4, 7, 14] },
  danger:     { music: 'mus_minigame_hard', ambience: ['amb_server'],      filterHz: 1800,  filterQ: 2,   rootHz: 98,     chord: [0, 1, 7, 6] },
  melancholy: { music: 'mus_terminal',      ambience: ['amb_street_rain'], filterHz: 1400,  filterQ: 0.9, rootHz: 116.54, chord: [0, 3, 7, 10] },
  triumph:    { music: 'mus_solved',        ambience: ['amb_office'],      filterHz: 10000, filterQ: 0.6, rootHz: 174.61, chord: [0, 4, 7, 12] },
  blackout:   { music: 'mus_blackout',      ambience: [],                  filterHz: 500,   filterQ: 1,   rootHz: 55,     chord: [0, 7] },
};
