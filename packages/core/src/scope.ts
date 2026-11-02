import type { Scope } from './types.js';

/** Idempotent cleanup scope. Disposers run in reverse order; one throwing does not block the rest. */
export function createScope(): Scope {
  let disposed = false;
  const fns: Array<() => void> = [];
  const kids = new Set<Scope>();
  const scope: Scope = {
    add(fn) {
      if (disposed) {
        fn(); // late registration on a dead scope cleans up immediately
        return;
      }
      fns.push(fn);
    },
    child() {
      const c = createScope();
      if (disposed) {
        c.dispose();
        return c;
      }
      kids.add(c);
      c.add(() => kids.delete(c));
      return c;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      for (const k of [...kids]) {
        try { k.dispose(); } catch (e) { errors.push(e); }
      }
      kids.clear();
      for (const fn of fns.reverse()) {
        try { fn(); } catch (e) { errors.push(e); }
      }
      fns.length = 0;
      if (errors.length > 0) throw errors[0];
    },
  };
  return scope;
}
