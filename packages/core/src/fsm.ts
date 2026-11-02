export interface FsmConfig<S extends string, E extends string> {
  initial: S;
  transitions: { [K in S]?: { [Ev in E]?: S } };
  onChange?: (from: S, to: S, event: E) => void;
}

export interface Fsm<S extends string, E extends string> {
  readonly state: S;
  can(event: E): boolean;
  /** Returns true if a transition happened; unknown events are ignored. */
  send(event: E): boolean;
}

export function createFsm<S extends string, E extends string>(cfg: FsmConfig<S, E>): Fsm<S, E> {
  let state = cfg.initial;
  const next = (ev: E): S | undefined =>
    (cfg.transitions[state] as { [Ev in E]?: S } | undefined)?.[ev];
  return {
    get state() {
      return state;
    },
    can: (ev) => next(ev) !== undefined,
    send(ev) {
      const to = next(ev);
      if (to === undefined) return false;
      const from = state;
      state = to;
      cfg.onChange?.(from, to, ev);
      return true;
    },
  };
}
