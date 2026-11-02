import type { AudioApi } from '@tikshuv/core';
import { MOODS, type MoodDef } from './moods.js';
import { AssetLoader, type AssetManifest, type FetchLike } from './manifest.js';
import { defaultSettings, sanitizeSettings, type AudioSettings } from './settings.js';
import { BUS_FOR_SFX, DUCKING, SYNTH_SFX, synthAmbience, synthPad, type Stoppable } from './synth.js';
import { FakeAudioContext } from './fake.js';
import {
  BUS_NAMES, SFX_NAMES,
  type ABuffer, type AContextLike, type AFilter, type AGain, type ANode, type BusName, type MoodId, type SfxName,
} from './types.js';

export interface AudioBusOptions {
  /** inject a context (tests use FakeAudioContext); default = new AudioContext() / webkitAudioContext */
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

interface Layer { gain: AGain; src: Stoppable; synth: boolean }

type EventTargetLike = {
  addEventListener(t: string, fn: () => void): void;
  removeEventListener(t: string, fn: () => void): void;
};
type DocLike = EventTargetLike & { hidden: boolean };

const dbToGain = (db: number): number => (db === -Infinity ? 0 : Math.pow(10, db / 20));

/** Real context if the browser has one (incl. old webkit prefix); otherwise a silent stand-in so nothing throws. */
function createContext(warn: (m: string) => void): AContextLike {
  const g = globalThis as unknown as Record<string, (new () => unknown) | undefined>;
  const Ctor = g['AudioContext'] ?? g['webkitAudioContext'];
  if (Ctor) {
    try {
      return new Ctor() as AContextLike;
    } catch (e) {
      warn(`audio: could not create AudioContext (${e instanceof Error ? e.message : String(e)}); running silent`);
    }
  } else warn('audio: Web Audio is not available; running silent');
  return new FakeAudioContext().asContext();
}

export class AudioBus implements AudioApi {
  readonly ctx: AContextLike;
  readonly loader: AssetLoader;
  private settings: AudioSettings;
  private master: AGain;
  private buses = {} as Record<BusName, AGain>;
  private musicFilter: AFilter;
  private musicDuck: AGain;
  private musicTrim: AGain;
  private ambienceTrim: AGain;
  private music: (Layer & { id: string }) | null = null;
  private ambience = new Map<string, Layer>();
  private duckUntil = 0;
  private mood: MoodId | null = null;
  private readonly xfade: number;
  private readonly warn: (m: string) => void;
  private unlockCleanup: (() => void) | null = null;
  private visCleanup: (() => void) | null = null;
  private userUnlocked = false;
  private onChange: ((s: AudioSettings) => void) | undefined;

  constructor(opts: AudioBusOptions = {}) {
    this.warn = opts.onWarn ?? (() => {});
    const ctx = opts.context ?? createContext(this.warn);
    this.ctx = ctx;
    this.xfade = opts.crossfade ?? 1.5;
    this.onChange = opts.onSettingsChange;
    this.settings = opts.settings === undefined ? defaultSettings() : sanitizeSettings(opts.settings);
    this.loader = new AssetLoader(ctx, opts.fetch ?? (globalThis as { fetch?: FetchLike }).fetch?.bind(globalThis), opts.onWarn);

    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    for (const b of BUS_NAMES) { this.buses[b] = ctx.createGain(); this.buses[b].connect(this.master); }
    // music chain: track gains -> mood low-pass -> duck gain -> mood trim -> music bus -> master
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.musicDuck = ctx.createGain();
    this.musicTrim = ctx.createGain();
    this.musicFilter.connect(this.musicDuck);
    this.musicDuck.connect(this.musicTrim);
    this.musicTrim.connect(this.buses.music);
    // ambience chain: layer gains -> mood trim -> ambience bus
    this.ambienceTrim = ctx.createGain();
    this.ambienceTrim.connect(this.buses.ambience);
    this.applyVolumes(true);
  }

  // ---- AudioApi (spec 01 section 3.1) ----
  /** Play a named SFX (`stamp` or `sfx_stamp`). Unknown ids are ignored, never thrown. */
  play(id: string, opts: { volume?: number } = {}): void {
    const name = (id.startsWith('sfx_') ? id.slice(4) : id) as SfxName;
    if (!(SFX_NAMES as readonly string[]).includes(name)) {
      this.warn(`audio: unknown sound "${id}"`);
      return;
    }
    this.playSfx(name, opts.volume === undefined ? {} : { volume: opts.volume });
  }

  // ---- settings ----
  getSettings(): AudioSettings { return structuredClone(this.settings); }
  /** Serialisable object to persist in the save store (save.settings.audio). */
  serialize(): AudioSettings { return this.getSettings(); }

  setVolume(bus: 'master' | BusName, v: number): void {
    this.settings[bus] = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    this.changed();
  }
  /** AudioApi.setMuted(m) mutes everything; setMuted(bus, m) mutes one bus. */
  setMuted(m: boolean): void;
  setMuted(bus: 'master' | BusName, m: boolean): void;
  setMuted(a: boolean | 'master' | BusName, b?: boolean): void {
    if (typeof a === 'boolean') this.settings.muted.master = a;
    else this.settings.muted[a] = b === true;
    this.changed();
  }
  setMasterMuted(m: boolean): void { this.setMuted('master', m); }
  setReducedSensory(on: boolean): void { this.settings.reducedSensory = on; this.changed(); }

  /** True until the first-run "sound on?" prompt has been answered. */
  get needsSoundPrompt(): boolean { return !this.settings.promptSeen; }
  /**
   * Call from the click/tap handler of the prompt's "yes": unlocks the context, unmutes and
   * records the answer in the same gesture. Returns whether audio is actually running.
   */
  async enableSound(): Promise<boolean> {
    this.settings.promptSeen = true;
    this.settings.muted.master = false;
    this.changed();
    await this.unlock();
    return this.unlocked;
  }
  /** "No sound": remember the choice so the prompt is not shown again; stays muted. */
  declineSound(): void {
    this.settings.promptSeen = true;
    this.settings.muted.master = true;
    this.changed();
  }

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
    if (this.ctx.state === 'running') this.userUnlocked = true;
  }
  /**
   * Resume the context on user gestures. Listeners detach only once the context is really
   * `running`; if the browser later suspends or interrupts it (iOS call, bfcache) they re-arm.
   * Returns a cleanup that removes everything.
   */
  unlockOnFirstGesture(target: EventTargetLike, events: readonly string[] = ['pointerdown', 'keydown', 'touchend']): () => void {
    this.unlockCleanup?.();
    let attached = false;
    const attach = () => {
      if (attached) return;
      attached = true;
      for (const e of events) target.addEventListener(e, handler);
    };
    const detach = () => {
      if (!attached) return;
      attached = false;
      for (const e of events) target.removeEventListener(e, handler);
    };
    const handler = () => {
      void this.unlock().then(() => { if (this.ctx.state === 'running') detach(); });
    };
    const prev = this.ctx.onstatechange ?? null;
    this.ctx.onstatechange = () => {
      prev?.();
      if (this.ctx.state === 'running') detach();
      else attach();
    };
    attach();
    const cleanup = () => {
      detach();
      if (this.ctx.onstatechange !== undefined) this.ctx.onstatechange = prev;
      this.unlockCleanup = null;
    };
    this.unlockCleanup = cleanup;
    return cleanup;
  }

  /** Suspend the context while the page is hidden (music must not play in a background tab). */
  bindVisibility(doc: DocLike): () => void {
    const h = () => {
      if (doc.hidden) void this.ctx.suspend?.();
      else if (this.userUnlocked) void this.ctx.resume().catch(() => {});
    };
    this.visCleanup?.();
    doc.addEventListener('visibilitychange', h);
    this.visCleanup = () => { doc.removeEventListener('visibilitychange', h); this.visCleanup = null; };
    return this.visCleanup;
  }

  // ---- manifest ----
  setManifest(m: AssetManifest): void { this.loader.setManifest(m); }
  /** Lazy preload; never throws. Returns the ids that loaded. */
  async preload(ids: readonly string[]): Promise<string[]> {
    const r = await Promise.all(ids.map(async (id) => ((await this.loader.load(id)) ? id : null)));
    return r.filter((x): x is string => x !== null);
  }

  // ---- layers ----
  private buildLayer(kind: 'music' | 'ambience', id: string, dest: ANode, t: number, fade: number, def?: Pick<MoodDef, 'rootHz' | 'chord'>): Layer {
    const g = this.ctx.createGain();
    g.connect(dest);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + fade);
    const buf = this.loader.getCached(id);
    if (buf) return { gain: g, src: this.bufferSource(buf, g, t), synth: false };
    const pad = def ?? { rootHz: 130.81, chord: [0, 7, 12] };
    const src = kind === 'music' ? synthPad(this.ctx, g, pad.rootHz, pad.chord, t) : synthAmbience(this.ctx, g, id, t);
    return { gain: g, src, synth: true };
  }

  private bufferSource(buf: ABuffer, out: ANode, t: number): Stoppable {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.connect(out); s.start(t);
    return { stop: (w) => s.stop(w), onStopped: (cb) => { s.onended = cb; } };
  }

  /** Ramp a layer to silence and schedule its sources to stop (no polling, no leak). */
  private retire(l: Layer, t: number, fade: number): void {
    const p = l.gain.gain;
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
    else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); } // hold current level: no click
    p.linearRampToValueAtTime(0, t + fade);
    l.src.stop(t + fade);
    l.src.onStopped(() => l.gain.disconnect());
  }

  // ---- music ----
  /** Crossfade to a music cue (file if loaded, synth pad fallback otherwise; a late file hot-swaps in). */
  playMusic(id: string, def?: Pick<MoodDef, 'rootHz' | 'chord'>, fade = this.xfade): void {
    if (this.music?.id === id) return;
    const t = this.ctx.currentTime;
    if (this.music) this.retire(this.music, t, fade);
    const layer = this.buildLayer('music', id, this.musicFilter, t, fade, def);
    this.music = { ...layer, id };
    if (layer.synth) {
      void this.loader.load(id).then((buf) => {
        if (buf && this.music?.id === id && this.music.synth) this.swapMusic(id, buf);
      });
    }
  }
  private swapMusic(id: string, buf: ABuffer): void {
    const old = this.music;
    if (!old) return;
    const t = this.ctx.currentTime;
    this.retire(old, t, this.xfade);
    const g = this.ctx.createGain();
    g.connect(this.musicFilter);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + this.xfade);
    this.music = { gain: g, src: this.bufferSource(buf, g, t), synth: false, id };
  }
  stopMusic(fade = this.xfade): void {
    if (!this.music) return;
    const m = this.music; this.music = null;
    this.retire(m, this.ctx.currentTime, fade);
  }
  get currentMusic(): string | null { return this.music?.id ?? null; }

  // ---- ambience ----
  /** Make exactly these ambience layers audible (fade in new, fade out removed). */
  setAmbience(ids: readonly string[], fade = this.xfade): void {
    const t = this.ctx.currentTime;
    for (const [id, layer] of this.ambience) {
      if (ids.includes(id)) continue;
      this.retire(layer, t, fade);
      this.ambience.delete(id);
    }
    for (const id of ids) {
      if (this.ambience.has(id)) continue;
      const layer = this.buildLayer('ambience', id, this.ambienceTrim, t, fade);
      this.ambience.set(id, layer);
      if (layer.synth) {
        void this.loader.load(id).then((buf) => {
          const cur = this.ambience.get(id);
          if (buf && cur === layer) this.swapAmbience(id, buf);
        });
      }
    }
  }
  private swapAmbience(id: string, buf: ABuffer): void {
    const old = this.ambience.get(id);
    if (!old) return;
    const t = this.ctx.currentTime;
    this.retire(old, t, this.xfade);
    const g = this.ctx.createGain();
    g.connect(this.ambienceTrim);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + this.xfade);
    this.ambience.set(id, { gain: g, src: this.bufferSource(buf, g, t), synth: false });
  }
  get ambienceLayers(): string[] { return [...this.ambience.keys()]; }

  // ---- mood ----
  /** Scene mood (VOICE_BIBLE section 5 id) -> music cue + ambience bed + low-pass colour + trims. */
  setMood(mood: MoodId): void {
    const def = MOODS[mood];
    if (!def) {
      this.warn(`audio: unknown mood "${String(mood)}"`);
      return;
    }
    this.mood = mood;
    const t = this.ctx.currentTime;
    this.musicFilter.frequency.cancelScheduledValues(t);
    this.musicFilter.frequency.setTargetAtTime(def.filterHz, t, this.xfade / 3);
    this.musicFilter.Q.setValueAtTime(def.filterQ, t);
    this.musicTrim.gain.setTargetAtTime(dbToGain(def.musicGainDb), t, this.xfade / 3);
    this.ambienceTrim.gain.setTargetAtTime(dbToGain(def.ambienceGainDb), t, this.xfade / 3);
    if (def.music !== null) this.playMusic(def.music, def);
    if (def.ambience !== 'keep') this.setAmbience(def.ambience);
    if (def.stinger) this.playSfx(def.stinger);
  }
  get currentMood(): MoodId | null { return this.mood; }

  // ---- sfx ----
  /**
   * One-shot SFX: loaded file `sfx_<name>` if cached, else the procedural synth. Returns duration (s).
   * While the context is suspended nothing is scheduled (a frozen clock would fire every queued
   * tick at once on unlock) and 0 is returned.
   */
  playSfx(name: SfxName, opts: { volume?: number; duck?: boolean } = {}): number {
    if (this.ctx.state !== 'running') return 0;
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
    this.visCleanup?.();
    this.stopMusic(0);
    this.setAmbience([], 0);
  }
}
