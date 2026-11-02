export type Unsubscribe = () => void;
export type Ms = number;
export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTY_MULT: Record<Difficulty, number> = { easy: 1, medium: 1.5, hard: 2 };

export { EventBus, type Handler } from './bus.js';
export { createFsm, type Fsm, type FsmConfig } from './fsm.js';
export { schedule, systemClock, type Scheduled, type Clock } from './scheduler.js';
export {
  SessionTimer,
  SESSION_DEFAULTS,
  sessionPreset,
  type SessionConfig,
  type SessionPhase,
  type SessionEvents,
  type SessionPreset,
  type SessionTimerOptions,
} from './session.js';
