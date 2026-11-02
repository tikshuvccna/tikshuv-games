import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCENE_MOODS, MUSIC_CUES, type AudioApi } from '@tikshuv/core';
import {
  AudioBus, FakeAudioContext, FakeParam, MOODS, SFX_NAMES, defaultSettings, sanitizeSettings, type MoodId,
} from '../src/index.js';

function make(state = 'running', opts: Record<string, unknown> = {}) {
  const ctx = new FakeAudioContext();
  ctx.state = state;
  const base = defaultSettings();
  const bus = new AudioBus({
    context: ctx.asContext(),
    settings: { ...base, muted: { ...base.muted, master: false } },
    ...opts,
  });
  return { ctx, bus };
}
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('I8: mood table is keyed by the scene mood ids', () => {
  it('has exactly one row per VOICE_BIBLE mood and every cue is a known mus_* id', () => {
    expect(Object.keys(MOODS).sort()).toEqual([...SCENE_MOODS].sort());
    for (const m of SCENE_MOODS) {
      const def = MOODS[m];
      if (def.music !== null) expect(MUSIC_CUES as readonly string[]).toContain(def.music);
      expect(def.filterHz).toBeGreaterThan(0);
    }
  });
  it('setMood works for every mood without assets, and warns on an unknown id', () => {
    const warn = vi.fn();
    const { bus } = make('running', { onWarn: warn });
    for (const m of SCENE_MOODS) expect(() => bus.setMood(m)).not.toThrow();
    bus.setMood('calm' as MoodId);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown mood'));
    expect(bus.currentMood).toBe('mood_finale_roof');
  });
  it('trims: lesson music -6 dB, red check silences the bed, overlays keep music/ambience', () => {
    const { ctx, bus } = make();
    bus.setMood('mood_hub');
    const hubAmb = bus.ambienceLayers;
    bus.setMood('mood_lesson');
    const targets = ctx.ofKind('gain').flatMap((g) => g.gain.calls.filter((c) => c.kind === 'target').map((c) => c.value as number));
    expect(targets.some((v) => Math.abs(v - 0.501) < 0.01)).toBe(true);
    bus.setMood('mood_interview'); // overlay: keeps the current ambience
    expect(bus.ambienceLayers).toEqual(MOODS.mood_lesson.ambience);
    bus.setMood('mood_check_red');
    expect(bus.ambienceLayers).toEqual(MOODS.mood_lesson.ambience); // 'keep', only the trim changes
    expect(targets.length).toBeGreaterThan(0);
    const after = ctx.ofKind('gain').flatMap((g) => g.gain.calls.filter((c) => c.kind === 'target' && c.value === 0).map((c) => c.value));
    expect(after.length).toBeGreaterThan(0);
    bus.setMood('mood_cabinet'); // no music of its own: current music stays
    expect(bus.currentMusic).toBe('mus_deduction');
    expect(hubAmb).toEqual(['amb_office', 'amb_street_rain']);
  });
  it('plays a mood stinger when running, not when suspended', () => {
    const a = make('running');
    a.bus.setMood('mood_tube_note');
    expect(a.ctx.ofKind('source').length).toBeGreaterThan(0);
    const b = make('suspended');
    const before = b.ctx.nodes.length;
    b.bus.setMood('mood_blackout');
    const oscAfter = b.ctx.ofKind('osc').length;
    // only the pad oscillators of the music exist, no one-shot stinger tones
    expect(oscAfter).toBe(MOODS.mood_blackout.chord.length);
    expect(b.ctx.nodes.length).toBeGreaterThan(before);
  });
});

describe('I6: faded-out sources are stopped without polling', () => {
  it('schedules stop at the end of the fade and disconnects when ended (music and ambience)', () => {
    const { ctx, bus } = make();
    bus.setMood('mood_hub');
    ctx.currentTime = 20;
    bus.setMood('mood_mg_easy'); // new music, ambience removed
    const stopped = [...ctx.ofKind('osc'), ...ctx.ofKind('source')].filter((n) => n.stopped.some((t) => t === 21.5));
    expect(stopped.length).toBeGreaterThanOrEqual(MOODS.mood_hub.chord.length + 2); // 4 pad osc + 2 ambience sources
    const gainsBefore = ctx.ofKind('gain').filter((g) => g.disconnected).length;
    stopped.forEach((n) => n.onended?.());
    expect(ctx.ofKind('gain').filter((g) => g.disconnected).length).toBeGreaterThan(gainsBefore);
  });
  it('stopMusic and dispose stop everything immediately', () => {
    const { ctx, bus } = make();
    bus.setMood('mood_hub');
    ctx.currentTime = 5;
    bus.dispose();
    const live = [...ctx.ofKind('osc'), ...ctx.ofKind('source')].filter((n) => n.started.length > 0 && n.loop !== false);
    expect(live.every((n) => n.stopped.includes(5))).toBe(true);
    expect(bus.currentMusic).toBeNull();
    expect(bus.ambienceLayers).toEqual([]);
  });
  it('M10: holds the current level instead of snapping to 1 (uses cancelAndHoldAtTime when present)', () => {
    const { ctx, bus } = make();
    bus.setMood('mood_hub');
    const musicGain = ctx.ofKind('gain').find((g) => g.gain.calls.some((c) => c.kind === 'ramp' && c.value === 1 && c.time === 1.5))!;
    musicGain.gain.value = 0.4; // mid fade-in
    ctx.currentTime = 0.5;
    bus.setMood('mood_mg_hard');
    const calls = musicGain.gain.calls;
    expect(calls.some((c) => c.kind === 'set' && c.value === 1 && c.time === 0.5)).toBe(false);
    expect(calls.some((c) => c.kind === 'set' && c.value === 0.4 && c.time === 0.5)).toBe(true);

    const hold = vi.fn();
    (FakeParam.prototype as unknown as { cancelAndHoldAtTime: (t: number) => void }).cancelAndHoldAtTime = hold;
    try {
      ctx.currentTime = 2;
      bus.setMood('mood_hub');
      expect(hold).toHaveBeenCalled();
    } finally {
      delete (FakeParam.prototype as unknown as Record<string, unknown>)['cancelAndHoldAtTime'];
    }
  });
});

describe('I7: a late-loaded file replaces the synth fallback', () => {
  it('music: crossfades from the synth pad to the buffer once it arrives', async () => {
    const ctx = new FakeAudioContext();
    ctx.state = 'running';
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchFn = vi.fn(async () => {
      await gate;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    });
    const bus = new AudioBus({ context: ctx.asContext(), fetch: fetchFn });
    bus.setManifest({ mus_bureau: { url: 'm' }, amb_office: { url: 'a' } });
    bus.setMood('mood_lesson'); // mus_bureau + amb_office start as synth
    expect(ctx.ofKind('source').filter((s) => s.loop && s.buffer?.duration === 2)).toHaveLength(0);
    const pads = ctx.ofKind('osc');
    ctx.currentTime = 3;
    release();
    await flush();
    const files = ctx.ofKind('source').filter((s) => s.loop && s.buffer?.duration === 2);
    expect(files).toHaveLength(2); // music + ambience file layers
    expect(bus.currentMusic).toBe('mus_bureau');
    expect(pads.every((o) => o.stopped.includes(4.5))).toBe(true);
    // a second arrival does not swap again
    const count = ctx.ofKind('source').length;
    bus.playMusic('mus_bureau');
    expect(ctx.ofKind('source').length).toBe(count);
  });
  it('does not swap in if the mood changed before the file arrived', async () => {
    const ctx = new FakeAudioContext();
    ctx.state = 'running';
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const bus = new AudioBus({
      context: ctx.asContext(),
      fetch: async () => {
        await gate;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
      },
    });
    bus.setManifest({ mus_bureau: { url: 'm' } });
    bus.setMood('mood_lesson');
    bus.setMood('mood_mg_hard');
    release();
    await flush();
    expect(ctx.ofKind('source').filter((s) => s.buffer?.duration === 2)).toHaveLength(0);
    expect(bus.currentMusic).toBe(MOODS.mood_mg_hard.music);
  });
});

describe('I5: SFX while the context is suspended', () => {
  it('schedules nothing and returns 0; works again after unlock', async () => {
    const { ctx, bus } = make('suspended');
    const n = ctx.nodes.length;
    for (const name of SFX_NAMES) expect(bus.playSfx(name)).toBe(0);
    expect(ctx.nodes.length).toBe(n);
    await bus.unlock();
    expect(bus.playSfx('typewriter')).toBeGreaterThan(0);
    expect(ctx.nodes.length).toBeGreaterThan(n);
  });
});

describe('I4: unlock keeps trying', () => {
  function targetRig() {
    const handlers = new Map<string, () => void>();
    return {
      handlers,
      target: {
        addEventListener: (t: string, f: () => void) => void handlers.set(t, f),
        removeEventListener: (t: string) => void handlers.delete(t),
      },
    };
  }
  it('a rejected resume leaves the listeners attached for the next gesture', async () => {
    const { ctx, bus } = make('suspended');
    const { handlers, target } = targetRig();
    let allow = false;
    ctx.resume = async () => {
      ctx.resumeCalls++;
      if (!allow) throw new Error('ignored');
      ctx.setState('running');
    };
    bus.unlockOnFirstGesture(target);
    handlers.get('pointerdown')?.();
    await flush();
    expect(handlers.size).toBe(3);
    expect(bus.unlocked).toBe(false);
    allow = true;
    handlers.get('keydown')?.();
    await flush();
    expect(bus.unlocked).toBe(true);
    expect(handlers.size).toBe(0);
  });
  it('re-arms when the browser suspends or interrupts the context later; cleanup restores onstatechange', async () => {
    const { ctx, bus } = make('suspended');
    const { handlers, target } = targetRig();
    const prev = vi.fn();
    ctx.onstatechange = prev;
    const cleanup = bus.unlockOnFirstGesture(target);
    handlers.get('touchend')?.();
    await flush();
    expect(handlers.size).toBe(0);
    ctx.setState('interrupted'); // phone call on iOS
    expect(handlers.size).toBe(3);
    expect(prev).toHaveBeenCalled();
    handlers.get('pointerdown')?.();
    await flush();
    expect(handlers.size).toBe(0);
    ctx.setState('suspended');
    expect(handlers.size).toBe(3);
    cleanup();
    expect(handlers.size).toBe(0);
    expect(ctx.onstatechange).toBe(prev);
    cleanup(); // idempotent
  });
});

describe('I2/I3: settings and the first-run prompt', () => {
  it('first run: muted, prompt pending; enableSound unmutes, unlocks and records the answer', async () => {
    const onSettingsChange = vi.fn();
    const ctx = new FakeAudioContext();
    const bus = new AudioBus({ context: ctx.asContext(), onSettingsChange });
    expect(bus.needsSoundPrompt).toBe(true);
    expect(bus.effectiveVolume('master')).toBe(0);
    expect(await bus.enableSound()).toBe(true);
    expect(bus.needsSoundPrompt).toBe(false);
    expect(bus.effectiveVolume('master')).toBeGreaterThan(0);
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ promptSeen: true }));
    expect(bus.serialize().promptSeen).toBe(true);
  });
  it('declineSound stays muted but is not "first run" any more; promptSeen survives sanitize', () => {
    const ctx = new FakeAudioContext();
    const bus = new AudioBus({ context: ctx.asContext() });
    bus.declineSound();
    expect(bus.needsSoundPrompt).toBe(false);
    expect(bus.effectiveVolume('master')).toBe(0);
    const again = new AudioBus({ context: new FakeAudioContext().asContext(), settings: bus.serialize() });
    expect(again.needsSoundPrompt).toBe(false);
    expect(sanitizeSettings({ promptSeen: 'yes' }).promptSeen).toBe(false);
    expect(defaultSettings().promptSeen).toBe(false);
  });
});

describe('C4: AudioBus satisfies the core AudioApi', () => {
  it('play(id), setMuted(bool) and the two-argument overload', () => {
    const warn = vi.fn();
    const { bus } = make('running', { onWarn: warn });
    const api: AudioApi = bus;
    api.play('stamp');
    api.play('sfx_confirm', { volume: 0.5 });
    api.play('nope');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nope'));
    api.setMuted(true);
    expect(bus.effectiveVolume('master')).toBe(0);
    api.setMuted(false);
    expect(bus.effectiveVolume('master')).toBeGreaterThan(0);
    bus.setMuted('music', true);
    expect(bus.effectiveVolume('music')).toBe(0);
  });
});

describe('M10/M11: context fallback, hidden tabs, new stingers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('no Web Audio at all: runs silent and never throws', () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    const warn = vi.fn();
    const bus = new AudioBus({ onWarn: warn });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not available'));
    expect(() => {
      bus.setMood('mood_hub');
      bus.playSfx('click');
    }).not.toThrow();
    expect(bus.unlocked).toBe(false);
  });
  it('falls back to webkitAudioContext; a throwing constructor degrades to silent', () => {
    const made = vi.fn();
    class Webkit extends FakeAudioContext {
      constructor() {
        super();
        made();
      }
    }
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', Webkit);
    new AudioBus();
    expect(made).toHaveBeenCalledTimes(1);
    vi.stubGlobal('webkitAudioContext', class {
      constructor() {
        throw new Error('nope');
      }
    });
    const warn = vi.fn();
    expect(() => new AudioBus({ onWarn: warn })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not create'));
  });
  it('suspends while hidden and resumes when visible again (only after a user unlock)', async () => {
    const { ctx, bus } = make('suspended');
    const handlers = new Set<() => void>();
    const doc = {
      hidden: false,
      addEventListener: (_: string, f: () => void) => void handlers.add(f),
      removeEventListener: (_: string, f: () => void) => void handlers.delete(f),
    };
    const off = bus.bindVisibility(doc);
    const fire = () => handlers.forEach((h) => h());
    doc.hidden = false;
    fire();
    expect(ctx.resumeCalls).toBe(0); // never unlocked by the user: do not auto-resume
    await bus.unlock();
    doc.hidden = true;
    fire();
    expect(ctx.suspendCalls).toBe(1);
    doc.hidden = false;
    fire();
    await flush();
    expect(ctx.state).toBe('running');
    off();
    expect(handlers.size).toBe(0);
  });
  it('level-up, sparkle and whoosh exist with synth fallbacks', () => {
    const { ctx, bus } = make();
    for (const n of ['level-up', 'sparkle', 'whoosh'] as const) {
      const before = ctx.nodes.length;
      expect(bus.playSfx(n)).toBeGreaterThan(0);
      expect(ctx.nodes.length).toBeGreaterThan(before);
    }
    expect(SFX_NAMES).toEqual(expect.arrayContaining(['level-up', 'sparkle', 'whoosh']));
  });
});
