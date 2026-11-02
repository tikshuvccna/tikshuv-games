import type { Ms } from './index.js';

export interface LoopOptions {
  /** called every frame with dt in ms (clamped to maxDtMs) */
  onFrame(dtMs: Ms, nowMs: Ms): void;
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
  /** injectable clock (ms) */
  now?: () => Ms;
  /** visibility source; default: global document when present */
  doc?: { hidden: boolean; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void };
  /** clamp for dt so a long stall never produces a giant step. Default 100. */
  maxDtMs?: Ms;
}

export interface Loop {
  start(): void;
  stop(): void;
  readonly running: boolean;
  dispose(): void;
}

/** rAF loop that pauses while the page is hidden and resumes without a dt spike. */
export function createLoop(opts: LoopOptions): Loop {
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: (t: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
    document?: LoopOptions['doc'];
  };
  const raf = opts.raf ?? ((cb) => g.requestAnimationFrame!(cb));
  const caf = opts.caf ?? ((id) => g.cancelAnimationFrame!(id));
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const doc = opts.doc ?? g.document;
  const maxDt = opts.maxDtMs ?? 100;

  let wanted = false;
  let id: number | null = null;
  let last = 0;

  const frame = (): void => {
    id = null;
    if (!wanted) return;
    const t = now();
    const dt = Math.min(maxDt, Math.max(0, t - last));
    last = t;
    id = raf(frame);
    opts.onFrame(dt, t);
  };
  const begin = (): void => {
    if (id !== null || !wanted) return;
    last = now();
    id = raf(frame);
  };
  const halt = (): void => {
    if (id !== null) caf(id);
    id = null;
  };
  const onVis = (): void => {
    if (doc?.hidden) halt();
    else begin();
  };
  doc?.addEventListener('visibilitychange', onVis);

  return {
    start() {
      wanted = true;
      if (!doc?.hidden) begin();
    },
    stop() {
      wanted = false;
      halt();
    },
    get running() {
      return id !== null;
    },
    dispose() {
      wanted = false;
      halt();
      doc?.removeEventListener('visibilitychange', onVis);
    },
  };
}
