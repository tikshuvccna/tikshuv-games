import type { ABuffer, AContextLike, ANode, SfxName } from './types.js';

/** Procedural fallbacks: every SFX works with zero assets. Each returns its duration in seconds. */
type Voice = (c: AContextLike, out: ANode, t: number) => number;

const noiseCache = new WeakMap<AContextLike, ABuffer>();
export function noiseBuffer(c: AContextLike): ABuffer {
  let b = noiseCache.get(c);
  if (!b) {
    b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate)), c.sampleRate);
    const d = b.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; }
    noiseCache.set(c, b);
  }
  return b;
}

function tone(c: AContextLike, out: ANode, t: number, type: string, f0: number, f1: number, dur: number, vol: number): void {
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.linearRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + Math.min(0.008, dur / 4));
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(c: AContextLike, out: ANode, t: number, filt: string, f0: number, f1: number, dur: number, vol: number, q = 1): void {
  const s = c.createBufferSource(); const f = c.createBiquadFilter(); const g = c.createGain();
  s.buffer = noiseBuffer(c);
  f.type = filt; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.linearRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.linearRampToValueAtTime(0, t + dur);
  s.connect(f); f.connect(g); g.connect(out);
  s.start(t); s.stop(t + dur + 0.02);
}

export const SYNTH_SFX: Record<SfxName, Voice> = {
  click: (c, o, t) => { tone(c, o, t, 'square', 1200, 700, 0.04, 0.25); return 0.05; },
  confirm: (c, o, t) => { tone(c, o, t, 'sine', 660, 660, 0.09, 0.3); tone(c, o, t + 0.09, 'sine', 880, 880, 0.14, 0.3); return 0.25; },
  deny: (c, o, t) => { tone(c, o, t, 'sawtooth', 220, 150, 0.2, 0.22); return 0.22; },
  stamp: (c, o, t) => { tone(c, o, t, 'sine', 140, 45, 0.18, 0.7); noise(c, o, t, 'lowpass', 1500, 300, 0.12, 0.5); return 0.2; },
  typewriter: (c, o, t) => { noise(c, o, t, 'highpass', 3000, 3000, 0.02, 0.35); tone(c, o, t, 'square', 2200, 1800, 0.012, 0.12); return 0.03; },
  paper: (c, o, t) => { noise(c, o, t, 'bandpass', 2500, 5500, 0.18, 0.3, 0.7); return 0.2; },
  notification: (c, o, t) => { tone(c, o, t, 'triangle', 988, 988, 0.12, 0.3); tone(c, o, t + 0.12, 'triangle', 1319, 1319, 0.22, 0.3); return 0.35; },
  'check-pass': (c, o, t) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, o, t + i * 0.08, 'sine', f, f, 0.35, 0.28));
    return 0.7;
  },
  'check-fail': (c, o, t) => { tone(c, o, t, 'sine', 140, 40, 0.3, 0.6); tone(c, o, t + 0.05, 'sawtooth', 196, 130, 0.35, 0.15); return 0.45; },
  blackout: (c, o, t) => { tone(c, o, t, 'sawtooth', 600, 30, 1.4, 0.35); noise(c, o, t, 'lowpass', 4000, 80, 1.4, 0.3); return 1.5; },
  // addendum 04 stingers
  'level-up': (c, o, t) => {
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, o, t + i * 0.07, 'triangle', f, f * 1.01, 0.5, 0.22));
    tone(c, o, t, 'sine', 196, 392, 0.9, 0.2);
    return 0.9;
  },
  sparkle: (c, o, t) => {
    [2093, 2637, 3136, 2349].forEach((f, i) => tone(c, o, t + i * 0.05, 'sine', f, f, 0.16, 0.14));
    return 0.4;
  },
  whoosh: (c, o, t) => { noise(c, o, t, 'bandpass', 400, 3200, 0.5, 0.4, 0.8); return 0.55; },
};

/** Stingers that duck the music (-35 percent per spec 04 section 6.2). */
export const DUCKING: Partial<Record<SfxName, true>> = {
  stamp: true, notification: true, 'check-pass': true, 'check-fail': true, blackout: true, 'level-up': true,
};
export const BUS_FOR_SFX: Record<SfxName, 'ui' | 'sfx'> = {
  click: 'ui', confirm: 'ui', deny: 'ui', typewriter: 'ui', notification: 'ui',
  stamp: 'sfx', paper: 'sfx', 'check-pass': 'sfx', 'check-fail': 'sfx', blackout: 'sfx',
  'level-up': 'sfx', sparkle: 'sfx', whoosh: 'sfx',
};

/** A looping source that can be stopped at a scheduled time and tells us when it has ended. */
export interface Stoppable {
  stop(when?: number): void;
  onStopped(cb: () => void): void;
}

/** Synth music pad fallback: sustained chord. */
export function synthPad(c: AContextLike, out: ANode, rootHz: number, chord: readonly number[], t: number): Stoppable {
  const oscs = chord.map((semi) => {
    const o = c.createOscillator(); const g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(rootHz * Math.pow(2, semi / 12), t);
    g.gain.setValueAtTime(0.5 / chord.length, t);
    o.connect(g); g.connect(out); o.start(t);
    return { o, g };
  });
  return {
    stop: (when) => oscs.forEach(({ o }) => o.stop(when)),
    onStopped: (cb) => {
      let left = oscs.length;
      if (left === 0) return cb();
      oscs.forEach(({ o, g }) => {
        o.onended = () => { g.disconnect(); if (--left === 0) cb(); };
      });
    },
  };
}

/** Ambience fallback: looping filtered noise. */
export function synthAmbience(c: AContextLike, out: ANode, id: string, t: number): Stoppable {
  const s = c.createBufferSource(); const f = c.createBiquadFilter(); const g = c.createGain();
  s.buffer = noiseBuffer(c); s.loop = true;
  const rain = id.includes('rain');
  f.type = rain ? 'highpass' : 'lowpass';
  f.frequency.setValueAtTime(rain ? 3500 : id.includes('server') ? 220 : id.includes('harbour') ? 320 : 500, t);
  g.gain.setValueAtTime(rain ? 0.25 : 0.4, t);
  s.connect(f); f.connect(g); g.connect(out); s.start(t);
  return {
    stop: (when) => s.stop(when),
    onStopped: (cb) => { s.onended = () => { g.disconnect(); cb(); }; },
  };
}
