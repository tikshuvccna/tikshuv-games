import { MOODS, type MoodDef } from './moods';
import { AssetLoader, type AssetManifest, type FetchLike } from './manifest';
import { defaultSettings, sanitizeSettings, type AudioSettings } from './settings';
import { BUS_FOR_SFX, DUCKING, SYNTH_SFX, synthAmbience, synthPad } from './synth';
import { BUS_NAMES, type AContextLike, type AFilter, type AGain, type BusName, type MoodId, type SfxName } from './types';

export interface AudioBusOptions {
  /** inject a context (tests use FakeAudioContext); default = new AudioContext() */
  context?: AContextLike;
  fetch?: FetchLike;
  /** persisted settings (any shape; sanitised) */
  settings?: unknown;
  onSettingsChange?: (s: AudioSettings) => void;
  onWarn?: (msg: string) => void;
  /** crossfade seconds */
  crossfade?: number;
}

const DUCK_LEVEL = 0.65; // music -35 percent during stingers
const RAMP = 0.03;       // volume change time constant (s)

interface Layer { gain: AGain; stop: () => void }
interface PendingStop { when: number; g: AGain; stop: () => void }

type EventTargetLike = {
  addEventListener(t: string, fn: () => void): void;
  removeEventListener(t: string, fn: () => void): void;
};

export class AudioBus {
  readonly ctx: AContextLike;
  readonly loader: AssetLoader;
  private settings: AudioSettings;
  private master: AGain;
  private buses = {} as Record<BusName, AGain>;
  private musicFilter: AFilter;
  private musicDuck: AGain;
  private music: (Layer & { id: string }) | null = null;
  private ambience = new Map<string, Layer>();
  private pendingStops: PendingStop[] = [];
  private duckUntil = 0;
  private mood: MoodId | null = null;
  private readonly xfade: number;
  private unlockCleanup: (() => void) | null = null;
  private onChange: ((s: AudioSettings) => void) | undefined;

  constructor(opts: AudioBusOptions = {}) {
    const ctx = opts.context ?? (new (globalThis as unknown as { AudioContext: new () => unknown }).AudioContext() as AContextLike);
    this.ctx = ctx;
    this.xfade = opts.crossfade ?? 1.5;
    this.onChange = opts.onSettingsChange;
    this.settings = opts.settings === undefined ? defaultSettings() : sanitizeSettings(opts.settings);
    this.loader = new AssetLoader(ctx, opts.fetch ?? (globalThis as { fetch?: FetchLike }).fetch?.bind(globalThis), opts.onWarn);

    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    for (const b of BUS_NAMES) { this.buses[b] = ctx.createGain(); this.buses[b].connect(this.master); }
    // music chain: track gains -> mood low-pass -> duck gain -> music bus -> master
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.musicDuck = ctx.createGain();
    this.musicFilter.connect(this.musicDuck);
    this.musicDuck.connect(this.buses.music);
    this.applyVolumes(true);
  }

  // ---- settings ----
  getSettings(): AudioSettings { return structuredClone(this.settings); }
  /** Serialisable object to persist in the save store. */
  serialize(): AudioSettings { return this.getSettings(); }

  setVolume(bus: 'master' | BusName, v: number): void {
    this.settings[bus] = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    this.changed();
  }
  setMuted(bus: 'master' | BusName, m: boolean): void { this.settings.muted[bus] = m; this.changed(); }
  /** AudioApi.setMuted compatibility: mutes everything. */
  setMasterMuted(m: boolean): void { this.setMuted('master', m); }
  setReducedSensory(on: boolean): void { this.settings.reducedSensory = on; this.changed(); }
  /** Gain a bus is currently set to (0 when muted). */
  effectiveVolume(bus: 'master' | BusName): number {
    return this.settings.muted[bus] ? 0 : this.settings[bus];
  }

  private changed(): void { this.applyVolumes(false); this.onChange?.(this.getSettings()); }

  private applyVolumes(immediate: boolean): void {
    const t = this.ctx.currentTime;
    const set = (g: AGain, v: number) => {
      if (immediate) g.gain.value = v;
      else { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(v, t, RAMP); }
    };
    set(this.master, this.effectiveVolume('master'));
    for (const b of BUS_NAMES) set(this.buses[b], this.effectiveVolume(b));
  }

  // ---- unlock ----
  get unlocked(): boolean { return this.ctx.state === 'running'; }
  async unlock(): Promise<void> {
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch { /* stay locked */ } }
  }
  /** Resume the context on the first user gesture, then detach listeners. */
  unlockOnFirstGesture(target: EventTargetLike, events: readonly string[] = ['pointerdown', 'keydown', 'touchend']): () => void {
    this.unlockCleanup?.();
    const cleanup = () => { for (const e of events) target.removeEventListener(e, handler); this.unlockCleanup = null; };
    const handler = () => { cleanup(); void this.unlock(); };
    for (const e of events) target.addEventListener(e, handler);
    this.unlockCleanup = cleanup;
    return cleanup;
  }

  // ---- manifest ----
  setManifest(m: AssetManifest): void { this.loader.setManifest(m); }
  /** Lazy preload; never throws. Returns the ids that loaded. */
  async preload(ids: readonly string[]): Promise<string[]> {
    const r = await Promise.all(ids.map(async (id) => ((await this.loader.load(id)) ? id : null)));
    return r.filter((x): x is string => x !== null);
  }

  // ---- music ----
  /** Crossfade to a music cue (file if loaded, synth pad fallback otherwise). */
  playMusic(id: string, def?: Pick<MoodDef, 'rootHz' | 'chord'>, fade = this.xfade): void {
    if (this.music?.id === id) return;
    const t = this.ctx.currentTime;
    if (this.music) this.fadeOut(this.music, t, fade);
    const g = this.ctx.createGain();
    g.connect(this.musicFilter);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + fade);
    const buf = this.loader.getCached(id);
    let stop: () => void;
    if (buf) {
      const s = this.ctx.createBufferSource();
      s.buffer = buf; s.loop = true; s.connect(g); s.start(t);
      stop = () => s.stop();
    } else {
      const d = def ?? { rootHz: 130.81, chord: [0, 7, 12] };
      stop = synthPad(this.ctx, g, d.rootHz, d.chord, t);
      void this.loader.load(id); // fail soft; used on the next request if it arrives
    }
    this.music = { id, gain: g, stop };
  }
  stopMusic(fade = this.xfade): void {
    if (!this.music) return;
    const m = this.music; this.music = null;
    this.fadeOut(m, this.ctx.currentTime, fade);
  }
  get currentMusic(): string | null { return this.music?.id ?? null; }

  private fadeOut(l: Layer, t: number, fade: number): void {
    l.gain.gain.cancelScheduledValues(t);
    l.gain.gain.setValueAtTime(1, t);
    l.gain.gain.linearRampToValueAtTime(0, t + fade);
    this.pendingStops.push({ when: t + fade, g: l.gain, stop: l.stop });
  }

  /** Release faded-out sources whose fade has finished. Call from a timer/loop (tests call it directly). */
  reap(): void {
    const now = this.ctx.currentTime;
    this.pendingStops = this.pendingStops.filter((p) => {
      if (p.when > now) return true;
      p.stop(); p.g.disconnect();
      return false;
    });
  }

  // ---- ambience ----
  /** Make exactly these ambience layers audible (fade in new, fade out removed). */
  setAmbience(ids: readonly string[], fade = this.xfade): void {
    const t = this.ctx.currentTime;
    for (const [id, layer] of this.ambience) {
      if (ids.includes(id)) continue;
      this.fadeOut(layer, t, fade);
      this.ambience.delete(id);
    }
    for (const id of ids) {
      if (this.ambience.has(id)) continue;
      const g = this.ctx.createGain();
      g.connect(this.buses.ambience);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + fade);
      const buf = this.loader.getCached(id);
      let stop: () => void;
      if (buf) {
        const s = this.ctx.createBufferSource();
        s.buffer = buf; s.loop = true; s.connect(g); s.start(t);
        stop = () => s.stop();
      } else {
        stop = synthAmbience(this.ctx, g, id, t);
        void this.loader.load(id);
      }
      this.ambience.set(id, { gain: g, stop });
    }
  }
  get ambienceLayers(): string[] { return [...this.ambience.keys()]; }

  // ---- mood ----
  /** Mood -> music track + ambience layers + low-pass colour. */
  setMood(mood: MoodId): void {
    const def = MOODS[mood];
    this.mood = mood;
    const t = this.ctx.currentTime;
    this.musicFilter.frequency.cancelScheduledValues(t);
    this.musicFilter.frequency.setTargetAtTime(def.filterHz, t, this.xfade / 3);
    this.musicFilter.Q.setValueAtTime(def.filterQ, t);
    this.playMusic(def.music, def);
    this.setAmbience(def.ambience);
  }
  get currentMood(): MoodId | null { return this.mood; }

  // ---- sfx ----
  /** One-shot SFX: loaded file `sfx_<name>` if cached, else the procedural synth. Returns duration (s). */
  playSfx(name: SfxName, opts: { volume?: number; duck?: boolean } = {}): number {
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    g.connect(this.buses[BUS_FOR_SFX[name]]);
    let dur: number;
    const buf = this.loader.getCached(`sfx_${name}`);
    if (buf) {
      const s = this.ctx.createBufferSource();
      s.buffer = buf; s.connect(g); s.start(t); dur = buf.duration;
    } else {
      dur = SYNTH_SFX[name](this.ctx, g, t);
    }
    if (this.settings.reducedSensory && dur > 0.5) {
      g.gain.setValueAtTime(g.gain.value, t + 0.4);
      g.gain.linearRampToValueAtTime(0, t + 0.5);
      dur = 0.5;
    }
    if (opts.duck ?? DUCKING[name] === true) this.duck(dur);
    return dur;
  }

  /** Lower music by 35 percent for `seconds`, then restore. Overlapping calls extend. */
  duck(seconds: number): void {
    const t = this.ctx.currentTime;
    this.duckUntil = Math.max(this.duckUntil, t + seconds + 0.15);
    const p = this.musicDuck.gain;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(DUCK_LEVEL, t, 0.03);
    p.setTargetAtTime(1, this.duckUntil, 0.2);
  }
  get ducking(): boolean { return this.ctx.currentTime < this.duckUntil; }

  dispose(): void {
    this.unlockCleanup?.();
    this.stopMusic(0);
    this.setAmbience([], 0);
    this.reap();
  }
}
