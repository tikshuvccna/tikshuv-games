# @tikshuv/audio

Web Audio `AudioBus`: buses master / music / sfx / ambience / ui, per-bus volume and mute (persistable `AudioSettings`, sound OFF by default on first run), unlock on first gesture, music crossfade between mood tracks, ambience loop layers, SFX with music ducking (-35 percent), `setMood(mood)` and a lazy asset manifest that fails soft. Every named SFX has a procedural synth fallback, so the game is fully audible with zero files. Inject a context (`FakeAudioContext` for tests).

```ts
const bus = new AudioBus({ settings: save.state.settings.audio, onSettingsChange: (s) => save.update((d) => { d.settings.audio = s; }) });
bus.unlockOnFirstGesture(window);
bus.setManifest({ mus_bureau: { url: `${BASE}audio/mus_bureau.opus` } }); // urls come later from Flow
bus.setMood("mood_c1_post"); bus.playSfx('stamp');
```

Moods: the 25 VOICE_BIBLE ids (mood_hub, mood_check_red, ...), see `src/moods.ts`. Settings live in `save.settings.audio` (`promptSeen` marks the first-run prompt answered).

## Assets to generate in Flow later (names only, nothing generated yet)

Music (Flow, loops 60-90 s unless noted; show prompt batch + credit estimate first):
`mus_title`, `mus_bureau` (calm), `mus_investigate` (tense), `mus_terminal` (melancholy), `mus_minigame_easy`, `mus_minigame_hard` (danger), `mus_deduction` (discovery), `mus_solved` (triumph, 20 s), `mus_blackout` (stinger), `mus_finale`. Optional per-case tonal variants.

Ambience (30 s loops): `amb_office`, `amb_server`, `amb_street_rain`.

SFX (optional foley overrides of the synth, manifest id `sfx_<name>`): `sfx_click`, `sfx_confirm`, `sfx_deny`, `sfx_stamp`, `sfx_typewriter`, `sfx_paper`, `sfx_notification`, `sfx_check-pass`, `sfx_check-fail`, `sfx_blackout`.
