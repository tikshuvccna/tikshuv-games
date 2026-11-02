import { describe, expect, it, vi } from 'vitest';
import { AudioBus, FakeAudioContext, MOODS, SFX_NAMES, defaultSettings, sanitizeSettings } from '../src/index.js';

function make(extra: Record<string, unknown> = {}, state = 'running') {
  const ctx = new FakeAudioContext();
  ctx.state = state;
  const base = defaultSettings();
  const bus = new AudioBus({
    context: ctx.asContext(),
    settings: { ...base, muted: { ...base.muted, master: false }, ...extra },
  });
  return { ctx, bus };
}

describe('volume and mute', () => {
  it('defaults to muted master and clamps volumes', () => {
    const ctx = new FakeAudioContext();
    const bus = new AudioBus({ context: ctx.asContext() });
    expect(bus.effectiveVolume('master')).toBe(0);
    bus.setMasterMuted(false);
    bus.setVolume('music', 5);
    expect(bus.getSettings().music).toBe(1);
    bus.setVolume('sfx', Number.NaN);
    expect(bus.getSettings().sfx).toBe(0);
  });
  it('per-bus mute zeroes effective gain and notifies persistence', () => {
    const onSettingsChange = vi.fn();
    const ctx = new FakeAudioContext();
    const bus = new AudioBus({ context: ctx.asContext(), onSettingsChange });
    bus.setMuted('music', true);
    expect(bus.effectiveVolume('music')).toBe(0);
    bus.setMuted('music', false);
    expect(bus.effectiveVolume('music')).toBeGreaterThan(0);
    expect(onSettingsChange).toHaveBeenCalledTimes(2);
    bus.setReducedSensory(true);
    expect(bus.serialize().reducedSensory).toBe(true);
    const gains = ctx.ofKind('gain');
    expect(gains[0]!.gain.calls.some((c) => c.kind === 'target')).toBe(true);
  });
  it('sanitizeSettings tolerates garbage and round-trips', () => {
    expect(sanitizeSettings(null)).toEqual(defaultSettings());
    const s = sanitizeSettings({ master: 2, music: 'x', muted: { sfx: true, ui: 3 } });
    expect(s.master).toBe(1);
    expect(s.music).toBe(defaultSettings().music);
    expect(s.muted.sfx).toBe(true);
    expect(s.muted.ui).toBe(false);
    expect(sanitizeSettings(s)).toEqual(s);
  });
});

describe('unlock', () => {
  it('resumes once on first gesture and detaches listeners once running', async () => {
    const { ctx, bus } = make({}, 'suspended');
    const handlers = new Map<string, () => void>();
    const target = {
      addEventListener: (t: string, f: () => void) => { handlers.set(t, f); },
      removeEventListener: (t: string) => { handlers.delete(t); },
    };
    bus.unlockOnFirstGesture(target);
    expect(bus.unlocked).toBe(false);
    handlers.get('pointerdown')?.();
    await bus.unlock();
    await Promise.resolve();
    expect(handlers.size).toBe(0);
    expect(ctx.resumeCalls).toBe(1);
  });
  it('unlock is a no-op when running; cleanup removes listeners', async () => {
    const { ctx, bus } = make({}, 'suspended');
    await bus.unlock();
    await bus.unlock();
    expect(ctx.resumeCalls).toBe(1);
    expect(bus.unlocked).toBe(true);
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    bus.unlockOnFirstGesture(target)();
    expect(target.removeEventListener).toHaveBeenCalledTimes(3);
  });
  it('resume rejection leaves bus locked without throwing', async () => {
    const { ctx, bus } = make({}, 'suspended');
    ctx.resume = () => Promise.reject(new Error('blocked'));
    await expect(bus.unlock()).resolves.toBeUndefined();
    expect(bus.unlocked).toBe(false);
  });
});

describe('mood and crossfade', () => {
  it('setMood starts music, ambience and colours the filter', () => {
    const { ctx, bus } = make();
    bus.setMood('mood_c1_post');
    expect(bus.currentMood).toBe('mood_c1_post');
    expect(bus.currentMusic).toBe(MOODS.mood_c1_post.music);
    expect(bus.ambienceLayers).toEqual(MOODS.mood_c1_post.ambience);
    const filter = ctx.ofKind('filter')[0]!;
    expect(filter.frequency.calls.some((c) => c.kind === 'target' && c.value === MOODS.mood_c1_post.filterHz)).toBe(true);
  });
  it('switching mood fades old music out and new in over the crossfade window', () => {
    const { ctx, bus } = make();
    bus.setMood('mood_hub');
    ctx.currentTime = 10;
    const before = ctx.ofKind('gain').length;
    bus.setMood('mood_mg_hard');
    const oldGain = ctx.ofKind('gain').find((g) => g.gain.calls.some((c) => c.kind === 'ramp' && c.value === 0 && c.time === 11.5));
    expect(oldGain).toBeDefined();
    const newGain = ctx.ofKind('gain').slice(before).find((g) => g.gain.calls.some((c) => c.kind === 'ramp' && c.value === 1 && c.time === 11.5));
    expect(newGain).toBeDefined();
    expect(bus.currentMusic).toBe(MOODS.mood_mg_hard.music);
    // sources are scheduled to stop when the fade ends (no polling), then the gain disconnects
    const oldOsc = ctx.ofKind('osc').filter((o) => o.stopped.includes(11.5));
    expect(oldOsc.length).toBeGreaterThan(0);
    expect(oldGain!.disconnected).toBe(false);
    oldOsc.forEach((o) => o.onended?.());
    expect(oldGain!.disconnected).toBe(true);
  });
  it('same track is not restarted; blackout drops ambience; stop/dispose work', () => {
    const { bus } = make();
    bus.setMood('mood_hub');
    const layers = bus.ambienceLayers;
    bus.playMusic(bus.currentMusic!);
    bus.setMood('mood_blackout');
    expect(layers.length).toBeGreaterThan(0);
    expect(bus.ambienceLayers).toEqual([]);
    bus.stopMusic();
    expect(bus.currentMusic).toBeNull();
    bus.stopMusic(); // no-op
    bus.dispose();
  });
});

describe('sfx and ducking', () => {
  it('every named SFX makes sound with zero assets', () => {
    const { ctx, bus } = make();
    for (const n of SFX_NAMES) {
      const before = ctx.ofKind('osc').length + ctx.ofKind('source').length;
      expect(bus.playSfx(n)).toBeGreaterThan(0);
      expect(ctx.ofKind('osc').length + ctx.ofKind('source').length).toBeGreaterThan(before);
    }
  });
  it('stingers duck music by 35 percent then restore; clicks do not', () => {
    const { ctx, bus } = make();
    bus.setMood('mood_hub');
    const duckGain = ctx.ofKind('filter')[0]!.connections[0]!;
    bus.playSfx('click');
    expect(duckGain.gain.calls.length).toBe(0);
    bus.playSfx('check-pass');
    expect(bus.ducking).toBe(true);
    const targets = duckGain.gain.calls.filter((c) => c.kind === 'target');
    expect(targets[0]!.value).toBeCloseTo(0.65);
    expect(targets[1]!.value).toBe(1);
    expect(targets[1]!.time).toBeGreaterThan(0.7);
    ctx.currentTime = 5;
    expect(bus.ducking).toBe(false);
    bus.playSfx('click', { duck: true });
    expect(bus.ducking).toBe(true);
  });
  it('reduced sensory shortens long stingers', () => {
    const { bus } = make({ reducedSensory: true });
    expect(bus.playSfx('blackout')).toBe(0.5);
  });
});

describe('manifest soft-fail', () => {
  it('missing file, http error and decode error never throw and fall back to synth', async () => {
    const warn = vi.fn();
    const ctx = new FakeAudioContext();
    const fetchFn = vi.fn(async (url: string) => {
      if (url === 'boom') throw new Error('network');
      return { ok: url !== '404', arrayBuffer: async () => new ArrayBuffer(4) };
    });
    const bus = new AudioBus({ context: ctx.asContext(), fetch: fetchFn, onWarn: warn });
    bus.setManifest({ a: { url: '404' }, b: { url: 'boom' }, c: { url: 'ok' }, mus_bureau: { url: 'nope' } });
    expect(await bus.preload(['a', 'b', 'missing'])).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(await bus.preload(['a'])).toEqual([]); // remembered failure, no second warn
    expect(warn).toHaveBeenCalledTimes(3);
    ctx.decodeFails = true;
    expect(await bus.preload(['c'])).toEqual([]);
    expect(() => bus.setMood('mood_hub')).not.toThrow();
    expect(() => bus.playSfx('stamp')).not.toThrow();
  });
  it('loaded file is used for music and sfx; concurrent loads are shared', async () => {
    const ctx = new FakeAudioContext();
    ctx.state = 'running';
    const fetchFn = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
    const bus = new AudioBus({ context: ctx.asContext(), fetch: fetchFn });
    bus.setManifest({ mus_bureau: { url: 'm' }, sfx_stamp: { url: 's' } });
    const [a, b] = await Promise.all([bus.preload(['mus_bureau']), bus.preload(['mus_bureau', 'sfx_stamp'])]);
    expect(a).toEqual(['mus_bureau']);
    expect(b).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    bus.setMood('mood_hub');
    expect(ctx.ofKind('source').some((s) => s.loop && s.buffer?.duration === 2)).toBe(true);
    expect(bus.playSfx('stamp')).toBe(2);
  });
  it('works without fetch (soft-fails)', async () => {
    const ctx = new FakeAudioContext();
    const warn = vi.fn();
    const bus = new AudioBus({ context: ctx.asContext(), fetch: undefined, onWarn: warn });
    (bus.loader as unknown as { fetchFn: undefined }).fetchFn = undefined;
    bus.setManifest({ x: { url: 'u' } });
    expect(bus.loader.has('x')).toBe(true);
    expect(await bus.preload(['x'])).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
