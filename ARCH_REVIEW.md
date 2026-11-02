# ARCH_REVIEW - M2 packages (O3)

Scope: `packages/core`, `save`, `dialogue`, `audio` (ui was reviewed in M1). I checked them against specs 01 (seams), 02 (design), 03 (unit rule), 04 (audio addendum), 06 (M2 acceptance), VOICE_BIBLE and docs/DECISIONS.md. I read the code and did not run it.

Totals: **4 critical, 16 important, 12 minor**. M2 acceptance (06) requires "no unresolved critical".

Nothing ships yet, so the fix for the save gaps is to **extend v1 in place** now. Do not add a v2 migration for this.

---

## Critical

**C1. The save cannot hold the resume state spec 02 section 8.3 requires.**
`packages/save/src/schema.ts:22-52`. Spec 02 section 8.3 lists what a save holds: `sessionElapsedMs`, `sceneId`, `nodeId`, flags, evidence, thoughts and voice levels. Spec 01 section 4.2 adds `progress.dialogue`, `inventory.evidence`, `session`, skill xp, minigame best per difficulty, coins and achievements. The schema has none of these except `voices` and `cases[].currentScene`. The runner cannot export its state either: `runner.ts:93-103`'s `state` drops `currentId`, `used` (once-options) and `modifiers`, and `RunnerOptions` (`runner.ts:15-23`) cannot seed `redResults`. As a result, M4's "save -> reload -> state restored" cannot pass, and a red check can be re-rolled by reloading the page, which breaks the "one attempt" rule.
*Fix:* add these to `SaveV1`:
- `flags`
- `evidence: string[]`
- `thoughts: Record<id, {state, progressMs, slot?}>` (spec 02 section 5 `ThoughtState`)
- `dialogue?: {sceneId, nodeId, flags, visited, used, redResults}`
- `session: {elapsedMs, lastActiveAt?}`
- `skills: Record<VoiceId, {level, pips}>`
- `minigames`, `coins`, `achievements`

Then add `DialogueRunner.snapshot(): DialogueSnapshot` and `restore(scene, snap)`, which put the player back at the last beat start (02 section 8.3). Round-trip it in a test.

**C2. The SessionTimer does not survive a reload, so F5 resets the 12-minute cap.**
`packages/core/src/session.ts:36-59`. There is no way to serialize or restore elapsed time, and nothing in the save stores it. Spec 01 section 3.7 says the timer "survives page reload (elapsed stored in `save.session`)", and a new session starts only after 30 minutes of inactivity.
*Fix:*
- Add `initialElapsedMs` and `warned` to `SessionTimerOptions`, plus `snapshot(): {elapsedMs, warned, ended}`.
- The game persists the snapshot to `save.session` on warning, on blackout, on `visibilitychange` hidden and every 15 s.
- On load, if `now - lastActiveAt >= 30 min` start fresh, otherwise restore.
- Test both paths with fake timers.

**C3. Dialogue has no seam for external steps (terminal, quiz, inspect).**
`packages/dialogue/src/schema.ts:17-59`. Spec 02 section 6.2/6.3 defines these node types:
- `terminal {deviceId, goal, onDone, onGiveUp}`
- `quiz {questionId, onRight, onWrong}`
- `inspect {evidenceId}`

None of them exist. The runner can only stop on line, narration, voice and choice (`runner.ts:217-221`). M3 (net-sim/terminal), M4 (vertical slice) and the check `reasoning` question all need the runner to pause, hand control to an external component, and resume with an outcome. Without that, every screen will invent its own convention.
*Fix:*
- Add the three node types.
- Add a `View.type: 'external'` that carries `{kind, payload}`.
- Add `runner.resolveExternal(outcome: 'done'|'giveUp'|'right'|'wrong')`.
- Lint the targets.

Also log the deviation from the spec 01 section 3.5 `DialogueRuntime` (`load/resume/snapshot/onEffect`, effects `startLesson`/`startMinigame`) in `docs/CHANGELOG-API.md`, which is currently empty. Spec 01 section 3 requires an entry for any seam change.

**C4. The core is missing the shared seams that M3-M5 plugins code against.**
`packages/core/src/index.ts:1-18`. Spec 01 section 3.1 puts these in core: `Scope`, `Rng` (seeded mulberry32), `IsoDate`, `AudioApi` and `GameContext`. Section 2 also lists the rAF `Loop` (pauses on hidden) and `Result`. None are exported. `MiniGameInit.seed`/`ctx.rng`, `SimulationDefinition.mount(host, ctx)` and `QuestionRenderer.render(..., ctx)` all depend on `GameContext`. If M3 agents start in parallel, each will define its own.
*Fix:*
- Add `scope.ts` (idempotent dispose, `child()`), `rng.ts` (mulberry32 + `fork(label)`, with a golden-sequence test) and `loop.ts` (rAF, injectable clock, pauses on hidden).
- Export the `GameContext`/`AudioApi` types from core.
- Have `AudioBus` structurally satisfy `AudioApi`: add `play(id, opts)` and `setMuted(m)`. Today it only has `playSfx` and `setMasterMuted`.

---

## Important

**I1. The save cannot store the default session cap (D7).**
`save/src/schema.ts:34`. `sessionCapMinutes` only allows `10 | 15 | null` and defaults to 15. Core defaults to 12 and offers presets 10/12/15/off (`core/src/session.ts:14-21`, and spec 02 line 698). Storing 12 would make `update()` reject the whole mutation silently (`store.ts:210-214`).
*Fix:* allow `10 | 12 | 15 | null` with default 12, or store `sessionCapMs` as in spec 01.

**I2. Audio settings have two sources of truth, and the first-run defaults contradict each other.**
`save/src/schema.ts:35-37` has `musicVolume`, `sfxVolume` and `muted` (default **false**). `audio/src/settings.ts:16-22` has master, music, sfx, ambience and ui volumes, per-bus mute, `reducedSensory`, and master muted **true**. The audio README example uses `save.audio`, which does not exist. If the game binds the save fields, sound is ON at first run, which contradicts spec 04 section 6.
*Fix:* replace these fields with `settings.audio: AudioSettings` (re-use `sanitizeSettings` through `z.custom`/`preprocess`), and keep a single default.

**I3. There is no way to tell a first run from "the user chose mute".**
`audio/src/settings.ts:19`. Master muted is the default, but nothing records whether the "sound on?" prompt has been shown. The game would either prompt every session or never.
*Fix:* add `settings.audio.promptSeen: boolean` (or `muted.master: boolean | 'unset'`). Show the prompt on the Start gesture, and call `unlock()` and `setMasterMuted(false)` in the same handler.

**I4. `unlockOnFirstGesture` gives up after one try.**
`audio/src/bus.ts:107`. `cleanup()` runs before `resume()` settles, so if the resume is rejected or ignored (iOS Safari on `pointerdown`, or an `interrupted` state) the listeners are already gone and audio stays locked for the rest of the session. Nothing re-arms after iOS suspends the context (a phone call, bfcache).
*Fix:* detach only once `ctx.state === 'running'`, and re-arm on `ctx.onstatechange` when the state goes to `suspended` or `interrupted`. Add a test with a rejecting `resume`.

**I5. SFX triggered while the context is suspended play all at once on unlock.**
`audio/src/bus.ts:214-226`. A suspended context's `currentTime` is frozen. Sounds such as typewriter ticks on the title or intro are scheduled at that frozen time, so they all fire together when the context resumes.
*Fix:* `if (this.ctx.state !== 'running') return 0;` in `playSfx`. Music and ambience can still be set up, because they are long loops.

**I6. Faded-out sources are never stopped (resource leak).**
`audio/src/bus.ts:155-166`. Stops only happen in `reap()`, and nothing calls it except `dispose()` and tests. Every mood change leaves 4 synth oscillators or a looping noise source running at gain 0, for the whole session.
*Fix:* call `src.stop(t + fade)` directly (Web Audio supports scheduled stop) and disconnect in `onended`. Drop `pendingStops`.

**I7. A late-loaded music or ambience file never replaces the synth fallback.**
`audio/src/bus.ts:124,140,191`. The first `playMusic(id)` starts the synth pad and kicks off the load. Later calls with the same id return early. So the real Flow track only plays after a mood change away and back, which means the first scene almost always plays the synth.
*Fix:* in the `load(id).then(buf => ...)` callback, if `this.music?.id === id` and the layer is a synth, crossfade to the buffer. Do the same for ambience.

**I8. Scene mood ids and audio mood ids do not match.**
- VOICE_BIBLE section 5 declares about 26 scene moods (`mood_hub`, `mood_c1_post`, `mood_check_red` and so on), each with a music cue, an ambience bed and a gain trim (-6 dB, -3 dB, ducked 50%).
- `audio/src/types.ts:53` and `moods.ts:16-24` hard-code 7 different ids (`calm`, `tense`, and so on).
- `dialogue/src/schema.ts:65-66` accepts any `mood` or `music` string, and lint does not check either.

*Fix:*
- Make the mood table data, keyed by the VOICE_BIBLE ids, with `music`, `ambience[]`, `filterHz` and `musicGainDb`.
- Have `setMood(id)` take that type.
- Have lint validate `scene.mood` and `scene.music` against the table and the 04 cue list.

**I9. The check model deviates from spec 02 section 4.2/4.6 and gives the UI nothing to show.**
- `checks.ts:18`: the evidence bonus is uncapped. The spec caps it at +3; the schema allows `evidence.max(4)`.
- There is no `thoughtBonus` (tags), `applyBonus` (`reasoning` question) or `overreachPenalty`.
- The target range is 1..12 instead of 2..9 (`schema.ts:38`).
- `CheckResult` returns only the total, but the UI must show "Logic 3 + Evidence 2 + Reasoning 2 = 7, needed 6".
- Checks resolve automatically inside `settle()` (`runner.ts:253-266`). The player cannot see a preview, and on a red check cannot "bail out with לא עכשיו" (spec 02 section 4.4).

*Fix:*
- Return `{terms: {voice, evidence, thought, apply, overreach}, score, target, passed, missing}`.
- Make `check` a stopping node that returns a preview `View`, with `confirm()` and `bail()` methods.
- Add `reasoning?`, cap evidence at 3, and set target to 2..9.

**I10. Lint reports false dead branches for flags set in other scenes.**
`lint.ts:24`. Any flag not `set` in the same scene is statically treated as `false`. Cross-scene flags (case progress, minigame outcomes, `runner.setFlag`) then produce `dead-branch` warnings, and `choice-no-exit` and `unreachable` **errors**.
*Fix:* `lintParsed(scene, {knownFlags})`, built from every scene in the CLI directory plus a `flags.json` registry. Unknown flags should evaluate to `null` and produce a warning, not `false`.

**I11. Lint misses a runtime crash and two kinds of id errors.**
- A cycle made only of automatic nodes (for example a check whose `onFail` leads through a `goto` back to the same check, where the score cannot change) passes lint, because `onPass` reaches an end (`lint.ts:183-191`). At runtime it trips the `MAX_STEPS` guard and throws (`runner.ts:269`).
- `voice:<unknown>` in a condition silently evaluates to 0 (`condition.ts:95`).
- `ev:` and `thought:` ids, and the evidence and thought node ids, are not checked against a registry. Spec 02 section 6.1 requires that.

*Fix:*
- Detect SCCs that contain only set/goto/branch/check/evidence/thought nodes and report an error.
- Validate voice atoms against `VOICES` at parse time.
- Accept `{evidenceIds, thoughtIds}` registries in lint options.

**I12. Unit completion and case unlock are stored flags, and the unit rule is incomplete.**
`save/src/schema.ts:13,17` stores `complete` and `unlocked`. Spec 01 section 4.2 says derivable data is recomputed, not stored. `isUnitComplete` (`schema.ts:85`) also leaves out the "lesson beats viewed" condition from spec 03 line 46, and there is no `isCaseUnlocked`.
*Fix:*
- Add `lessonViewed: boolean` to the unit progress.
- `isUnitComplete = lessonViewed && checks >= 2 && quizScore >= 5`.
- `isCaseUnlocked(caseId, units, CASE_UNITS)`: both units complete; Case 1 after the prologue; the finale needs all 10; unit 1 alone opens Case 1 scene 2.
- Drop the stored booleans, or keep them only as "never demote" latches.
- Test it as a table.

**I13. Voice progression and cabinet state do not match spec 02.**
- `voices` is a record of string to 0..5 (`schema.ts:43`). Keys are not checked against the six voices, and there are no pips (02 section 4.3: 3 pips = 1 level).
- `cabinet.slots` defaults to 3, but the spec says start at 2, +1 per solved case, max 6 (`schema.ts:45`). Slots can be derived from cases solved.
- `internalising[].minutesLeft` cannot represent `known`/`forgotten` or "keep 50% on forget".

*Fix:* key by `VoiceId` with `{level, pips}`, use the `ThoughtState` from spec 02 section 5 with `progressMs`, and derive slots.

**I14. Load prefers a stale local save over a newer backup.**
`save/src/store.ts:154-159`. If a quota error left localStorage behind while IndexedDB was mirrored (`store.ts:186-196`), the next load adopts the older local copy and loses progress.
*Fix:* when both parse, adopt the one with the newer `updatedAt`.

**I15. One missing nested object discards the whole save, and multi-tab writes clobber each other.**
- `profile`, `settings` and `cabinet` (`schema.ts:26,31,44`) have no `.default()`. A save missing one of them fails `safeParse`, falls back to the default save, and all progress is lost. Spec 01 section 4.3 step 4 says to merge over `createDefault()`.
- There is no `storage` event, BroadcastChannel or Web Lock, so two tabs (common in class) overwrite each other's progress.

*Fix:*
- Deep-merge the parsed object over `createDefaultSave()` before validating, or add `.default(...)` to every object.
- On a `storage` event for `SAVE_KEY`, reload or show "open in another tab".

**I16. The session timer behaves wrongly on hidden tabs, menu pauses and machine sleep.**
`core/src/session.ts:33,54-57`, `scheduler.ts:24`.
- `pauseWhenHidden` defaults to false, but spec 01 section 3.7 says the timer pauses automatically.
- The visibility handler calls `resume()` blindly, so returning to the tab un-pauses a menu or cutscene pause (spec: `pause(reason)`).
- `systemClock` is `Date.now`. A wall-clock change, or a laptop sleeping without a `visibilitychange` event, adds the gap to elapsed time, and the player gets an instant blackout on wake.

*Fix:*
- Default `pauseWhenHidden: true`.
- Track a set of pause reasons and resume only when the set is empty.
- Use `performance.now()`.
- Treat any tick gap over 60 s as hidden time.
- Tests: hidden then visible while menu-paused; a clock jump.

---

## Minor

- **M1.** `session.ts:50-51`: passing only `capMs` (for example 8 min) keeps `warnAtMs` at 10 min, which is past the cap, so the warning is silently dropped. Derive the warning as `cap - 2 min` when it is not given. There is no `extend(ms)` for teacher mode (01 section 3.7). A timer started while `document.hidden` counts that time.
- **M2.** Blackout deferral for red checks and minigames (02 section 8.2, up to 3 min) is not covered after the grace phase was dropped. Document the game-side contract in DECISIONS: listen for `blackout` and hold until the beat ends. A `holdUntil(promise)` helper would also work.
- **M3.** `store.ts:229` `flush()`: there is no lifecycle binding. Add `bindLifecycle(window)` that flushes on `pagehide` **and** on `visibilitychange` hidden; iPad Safari often skips `pagehide`.
- **M4.** `store.ts:129`: zod strips unknown keys, so the spec's `_extra` preservation is missing. A corrupt local save is overwritten on the next save without a quarantine copy. Store it as `SAVE_KEY + '.corrupt'`.
- **M5.** The event log is missing: there is no `logEvent`/`readEvents` (01 section 3.6), and the teacher CSV and analytics need it. There is also no `storageHealth`. Can be deferred to M4, but record it in DECISIONS.
- **M6.** `condition.ts:20,64`: `flag:x>=2` tokenizes as a flag named `x>=2`, which is always false. Numeric flags or counters (the `set` node allows numbers) cannot be compared. Reject comparisons on `flag:` or support them.
- **M7.** `runner.ts:108`: `modifiers` persist across `start()` and scenes, with no way to clear them. `View.speaker` is a translated name for lines but a raw voice id for voice nodes (`runner.ts:135,146`). A listener that throws during `settle()` leaves the runner half-advanced.
- **M8.** Schema drift from spec 02 section 6.3: `choice.options.min(1)` instead of 2, no `hintCost` on voice nodes, `speakers[].portrait` optional, `location` optional. Lint does not check for emoji (01 line 709).
- **M9.** `VoiceId` is defined in both `ui/src/voices.ts:4` and `dialogue/src/schema.ts:9`. Define it once (core or a shared content-types module) so the six ids cannot drift.
- **M10.** `audio/src/bus.ts:153`: `fadeOut` snaps gain to 1 before ramping, which clicks when a layer was mid-fade-in. Use `cancelAndHoldAtTime` where supported. `bus.ts:48` creates the `AudioContext` eagerly, has no `webkitAudioContext` fallback, and throws where Web Audio is absent. Music keeps playing in hidden tabs; suspend the context on hidden.
- **M11.** The 04 addendum stingers are missing from `SfxName`: voice-level-up swell, collectible sparkle and the pneumatic whoosh.
- **M12.** Tooling:
  - No coverage provider or threshold is configured. M2 acceptance requires at least 80% lines on core, save and dialogue. Add `@vitest/coverage-v8` and a `vitest.config.ts` threshold.
  - `save` and `audio` import without `.js` while `core` and `dialogue` use `.js`. This breaks if Node tools import them as the dialogue CLI does.
  - There is no golden test that lints the VOICE_BIBLE sample scenes, which would have caught the mood-id mismatch.

---

## Missing tests (summary)

- **core:** visibility pause and resume, including while menu-paused; `setConfig` lowering the cap below elapsed; snapshot and restore; Rng golden sequence.
- **save:** backup newer than local; missing nested object; storage event from another tab; derived unlock table; a value of 12 for the session cap.
- **dialogue:** snapshot and restore; external nodes; lint with cross-scene flags; an automatic cycle through `onFail`; unknown voice in a condition; lint of the VOICE_BIBLE samples.
- **audio:** sources stopped after a fade without `reap()`; a late-loaded file replacing the synth; SFX dropped while suspended; re-arming unlock after a failed resume.

---

## Resolution (fix pass)

Fixed: C1-C4, I1-I16 (all 20), minor M1, M3, M4 (quarantine), M6, M7, M8 (partial), M9, M10, M11, M12. Every fix has tests; `npx tsc -b` and `npx vitest run --coverage` are green (161 tests; lines core 100%, save 97.7%, dialogue 99.4%; threshold 80% per package in `vitest.config.ts`).

Notes on how:
- C1: `skills` is the `voices` record (`{level,pips}`); evidence/thoughts/voices stay in the save, the dialogue snapshot carries only runner state. C3: `docs/CHANGELOG-API.md` logs the DialogueRuntime deviation.
- I9: checks are stopping nodes (`confirm`/`bail`); inspect also grants the evidence. I11: automatic cycles are an error unless a set/evidence/thought sits inside (then a warning).
- I10: unknown flags evaluate to unknown plus a warning; the CLI lints all scenes together and reads `flags.json`.
- I12: stored `complete`/`unlocked` dropped; case unlock follows the literal spec 03 sentence (flagged in DECISIONS).

Skipped / partial (why):
- M2: documented in DECISIONS (game-side contract), no `holdUntil` helper.
- M4 `_extra` preservation: skipped, not trivial.
- M5: event log deferred to M4, recorded in DECISIONS.
- M8: `location`/`portrait` stay optional (content compatibility); min-2 options, `hintCost` and emoji lint done.
- M12: `.js` import suffixes fixed in save/audio; golden VOICE_BIBLE lint test skips itself if the specs folder is absent.
- `@tikshuv/core` is imported by dialogue/save/audio via workspace hoisting but not declared in their package.json (avoids a lockfile change; add on the next install).
