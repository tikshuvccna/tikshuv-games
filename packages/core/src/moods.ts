/**
 * Scene mood and music-cue ids (single source: VOICE_BIBLE section 5 and spec 04 cue list).
 * Dialogue lint validates scene.mood / scene.music against these; the audio package keys its
 * mood table by SceneMoodId, so scenes and audio cannot drift.
 */
export const SCENE_MOODS = [
  'mood_title', 'mood_hub', 'mood_hub_first_day', 'mood_lesson',
  'mood_c1_post', 'mood_c2_harbour', 'mood_c3_newsroom', 'mood_c4_basement', 'mood_c5_lighthouse',
  'mood_interview', 'mood_terminal', 'mood_cabinet', 'mood_check_white', 'mood_check_red',
  'mood_fail_forward', 'mood_quiz', 'mood_mg_easy', 'mood_mg_hard', 'mood_solved', 'mood_tube_note',
  'mood_warn10', 'mood_blackout', 'mood_finale_dark', 'mood_finale_restore', 'mood_finale_roof',
] as const;
export type SceneMoodId = (typeof SCENE_MOODS)[number];

export const MUSIC_CUES = [
  'mus_title', 'mus_bureau', 'mus_investigate', 'mus_terminal', 'mus_minigame_easy',
  'mus_minigame_hard', 'mus_deduction', 'mus_solved', 'mus_blackout', 'mus_finale',
] as const;
export type MusicCueId = (typeof MUSIC_CUES)[number];

export const isSceneMood = (s: string): s is SceneMoodId => (SCENE_MOODS as readonly string[]).includes(s);
export const isMusicCue = (s: string): s is MusicCueId => (MUSIC_CUES as readonly string[]).includes(s);
