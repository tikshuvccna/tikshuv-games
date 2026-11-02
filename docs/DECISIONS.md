# Decisions
- 2026-11-01 M0: local scaffold only. GitHub repo, Pages, Firebase binding, Flow art await user OK.
- 2026-11-01 Audio/feel: user directive - music, SFX, ambience and emotional feel are first-class; Google Flow music is approved (show prompt batch + credit cost first). Overrides CC0-default in spec 04 section 6.
- 2026-11-02 Palette: 12 locked --cf-* colours plus tints within the 24-colour quantise cap. Two tints for brass, amber, teal, blue, rust; one for fog, phosphor; none for olive and the neutrals (see packages/ui/src/palette.json).
- 2026-11-02 Hosting: one repo, one GitHub Pages site, one folder per game (dist/<game>/), landing page from games.json. Default branch is main; old remote master left in place (delete needs user OK).
- 2026-11-02 Voice bible (specs/case-files/VOICE_BIBLE.md) needs a `mood` field and {name} interpolation in the dialogue schema (M2).
