export type Unsubscribe = () => void;
export type Ms = number;
export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTY_MULT: Record<Difficulty, number> = { easy: 1, medium: 1.5, hard: 2 };

export { EventBus, type Handler } from './bus.js';
export { createFsm, type Fsm, type FsmConfig } from './fsm.js';
export { schedule, systemClock, type Scheduled, type Clock } from './scheduler.js';
export {
  VOICE_IDS, ok, err,
  type VoiceId, type IsoDate, type Scope, type Rng, type AudioApi, type GameContext, type Result,
} from './types.js';
export {
  SCENE_MOODS, MUSIC_CUES, isSceneMood, isMusicCue,
  type SceneMoodId, type MusicCueId,
} from './moods.js';
export { createScope } from './scope.js';
export { createRng } from './rng.js';
export { createLoop, type Loop, type LoopOptions } from './loop.js';
export {
  SessionTimer,
  SESSION_DEFAULTS,
  SESSION_IDLE_RESET_MS,
  sessionPreset,
  sessionResume,
  type SessionConfig,
  type SessionPhase,
  type SessionEvents,
  type SessionPreset,
  type SessionTimerOptions,
  type SessionSnapshot,
  type PauseReason,
} from './session.js';
