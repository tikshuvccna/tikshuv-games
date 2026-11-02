import type { Ms } from './index.js';

export interface Scheduled {
  cancel(): void;
}

/** Cancellable setTimeout wrapper; looks up the global each call so fake timers work. */
export function schedule(delay: Ms, fn: () => void): Scheduled {
  let id: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    id = undefined;
    fn();
  }, Math.max(0, delay));
  return {
    cancel() {
      if (id !== undefined) clearTimeout(id);
      id = undefined;
    },
  };
}

export interface Clock {
  now(): Ms;
}
export const systemClock: Clock = { now: () => Date.now() };
