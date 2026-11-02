/** Shared primitives (spec 01 section 3.1). Every package codes against these. */
import type { Clock } from './scheduler.js';
import type { Ms, Unsubscribe } from './index.js';

export type IsoDate = string; // ISO 8601

/** Cleanup scope: everything a component creates registers here; dispose() is idempotent. */
export interface Scope {
  add(fn: () => void): void;
  child(): Scope;
  dispose(): void;
}

/** Seeded, deterministic random source; used by minigames and shuffles. */
export interface Rng {
  /** [0,1) */
  next(): number;
  int(min: number, maxInclusive: number): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: readonly T[]): T[];
  fork(label: string): Rng;
}

export interface AudioApi {
  play(id: string, opts?: { volume?: number }): void;
  setMuted(m: boolean): void;
}

/**
 * Handed to every plugin (Simulation, MiniGame, QuestionRenderer...).
 * `S` is the SaveStore type; core cannot import the save package, so it is a parameter.
 */
export interface GameContext<S = unknown> {
  scope: Scope;
  clock: Clock;
  rng: Rng;
  audio: AudioApi;
  t: (key: string, params?: Record<string, string | number>) => string;
  save: S;
  prefersReducedMotion: boolean;
  quality: 'low' | 'medium' | 'high';
}

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** The six inner voices (single definition; ui and content import from here). */
export const VOICE_IDS = ['logic', 'packet_sense', 'patience', 'suspicion', 'recall', 'command_line'] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

export type { Ms, Unsubscribe };
