import type { Rng } from './types.js';

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded mulberry32. `fork(label)` is derived from seed + label only (independent of draw order). */
export function createRng(seed: number | string = 1): Rng {
  const s0 = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
  let a = s0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int(min, maxInclusive) {
      return min + Math.floor(next() * (maxInclusive - min + 1));
    },
    pick(arr) {
      if (arr.length === 0) throw new Error('pick from empty array');
      return arr[Math.floor(next() * arr.length)] as never;
    },
    shuffle(arr) {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j] as never, out[i] as never];
      }
      return out;
    },
    fork(label) {
      return createRng((s0 ^ hashString(label)) >>> 0);
    },
  };
  return rng;
}
