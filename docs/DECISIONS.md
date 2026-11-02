# Decisions
- 2026-11-01 M0: local scaffold only. GitHub repo, Pages, Firebase binding, Flow art await user OK.
- 2026-11-01 Audio/feel: user directive - music, SFX, ambience and emotional feel are first-class; Google Flow music is approved (show prompt batch + credit cost first). Overrides CC0-default in spec 04 section 6.
- 2026-11-02 Palette: 12 locked --cf-* colours plus tints within the 24-colour quantise cap. Two tints for brass, amber, teal, blue, rust; one for fog, phosphor; none for olive and the neutrals (see packages/ui/src/palette.json).
- 2026-11-02 Hosting: one repo, one GitHub Pages site, one folder per game (dist/<game>/), landing page from games.json. Default branch is main; old remote master left in place (delete needs user OK).
- 2026-11-02 Voice bible (specs/case-files/VOICE_BIBLE.md) needs a `mood` field and {name} interpolation in the dialogue schema (M2).

## M2 core packages (2026-11-02)
- `core`: SessionTimer lives in core (no separate package); presets warn 2 min before cap (12 -> 10:00); 20 s grace phase from spec dropped, blackout is game content.
- `save`: localStorage primary + idb-keyval backup, key `tikshuv.cf.save`; newer-version saves load read-only so data is never overwritten; spec checksum/.bak rotation skipped for now.
- `dialogue`: check score = voice level + modifiers + 1 per linked evidence; white retryable, red once; moods neutral/worried/relieved/sly; lint CLI `node packages/dialogue/src/cli.ts <scene|dir>`.
- `audio`: master muted on first run (needs a "sound on" prompt); synth fallback for every cue; Flow asset names listed in packages/audio/README.md.
- 2026-11-02 M2 review: blackout deferral (spec 02 8.2) is game-side: listen for `blackout` and hold until the beat ends. Event log/storageHealth (spec 01 3.6) deferred to M4. `_extra` key preservation skipped. Case unlock follows the literal spec 03 text (both own units; Case 1 after the prologue); revisit if content intends U2 to open Case 2.
