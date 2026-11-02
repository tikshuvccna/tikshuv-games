import type { Unsubscribe } from './index.js';

export type Handler<T> = (payload: T) => void;

/** Typed event bus. `M` maps event name to payload type. */
export class EventBus<M extends { [K in keyof M]: unknown }> {
  private handlers = new Map<keyof M, Set<Handler<never>>>();

  on<K extends keyof M>(type: K, fn: Handler<M[K]>): Unsubscribe {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const h = fn as Handler<never>;
    set.add(h);
    return () => {
      set.delete(h);
    };
  }

  once<K extends keyof M>(type: K, fn: Handler<M[K]>): Unsubscribe {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of [...set]) (h as Handler<M[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
