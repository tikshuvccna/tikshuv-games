# API changelog

# API changelog

## 2026-11-02 M2 review fixes (ARCH_REVIEW)
- core: new shared seams `Scope`/`createScope`, `Rng`/`createRng` (mulberry32, `fork`), `createLoop`, `GameContext<S>`, `AudioApi`, `Result`, `IsoDate`, `VOICE_IDS`/`VoiceId`, `SCENE_MOODS`/`MUSIC_CUES`. `systemClock` is now `performance.now`.
- core SessionTimer: `pause(reason)`/`resume(reason?)` with a reason set, `pauseWhenHidden` default true, `snapshot()`, options `initialElapsedMs`/`warned`/`ended`, `sessionResume()`, `extend(ms)`; tick gaps over 60 s are not play time.
- save (v1 extended in place, no migration): `settings.audio` replaces musicVolume/sfxVolume/muted; `sessionCapMinutes` 10|12|15|null default 12; new `flags`, `evidence`, `thoughts`, `coins`, `achievements`, `minigames`, `dialogue`, `session`; `voices` is `{level,pips}` keyed by VoiceId; `cabinet`, `units[].complete`, `cases[].unlocked` removed (derived: `isCaseUnlocked`, `cabinetSlots`); `units[].lessonViewed` added. `SaveStore.bindLifecycle`, `adoptExternal`, corrupt quarantine, newer-of-local/backup load.
- dialogue (deviation from spec 01 3.5 DialogueRuntime): the runner is `DialogueRunner` with `snapshot()/restore(scene, snap)` instead of `load/resume/snapshot/onEffect`; terminal/quiz/inspect nodes pause with `View.type 'external'` and resume via `resolveExternal(outcome)` (spec effects startLesson/startMinigame are not implemented; game code reacts to `external` events). `check` is now a stopping node: `confirm()` / `bail()` (new `onBail`), `CheckResult.terms`, evidence cap +3, targets 2..9, `reasoning`, `tags`, `mustInspect`. `choice.options` min 2. Lint: `lintScenes`, cross-scene flags, `auto-cycle`, registries, mood/music validation.
- audio: `setMood` takes VOICE_BIBLE mood ids (table in moods.ts); `play(id)`/`setMuted(bool)` satisfy `AudioApi`; `AudioSettings.promptSeen`, `enableSound()`/`declineSound()`; `reap()` removed (sources stop on schedule); new SFX `level-up`, `sparkle`, `whoosh`.
