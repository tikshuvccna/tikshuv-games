# Case Files - Style Bible (O1)

Owner: task O1 (`specs/case-files/05`). Binding inputs: `02` section 3 (palette lock, typography, motion), `04` (art pipeline, juice), `00` (RTL, no emoji, Hebrew only in content).
Source of truth in code: `packages/ui/src/tokens.css` (tokens), `packages/ui/src/palette.json` (palette lock for the art pipeline), `packages/ui/src/*.ts` (tk-* components).
Live reference: `games/case-files/design-system.html` (built to `dist/case-files/design-system.html`). Every agent doing UI or art reads this file first.

---

## 1. The look in one breath

**Painted noir, warm and safe.** A rainy 1950s harbour bureau at night, where every lamp is a pool of tungsten amber and every cable glows a little. Ink-blue shadows, cream paper, brass fittings. The UI is the bureau's own stationery: index cards, manila folders, rubber stamps, a brass pocket watch. When a machine speaks, a thin phosphor-green terminal opens like a window into the wiring.

Three layers, never mixed up:

| Layer | What it is | Surfaces | Signature |
|---|---|---|---|
| **Painted-noir** (world) | Backgrounds, portraits, scene light | Raster (Flow + palette-lock) or layered SVG fallback | One light source, visible grain, ordered dither in shadows |
| **Paper-and-brass** (UI) | Everything the player touches | `--cf-night` page, `--cf-slate` panels, `--cf-paper` cards, `--cf-brass` controls | Hairline brass rules, typewriter labels, stamps, small radii |
| **Phosphor inset** (machines) | Terminal, CLI voice, command chips | `--cf-ink` + `--cf-phosphor`, always `dir="ltr"` | Monospace, soft glow, faint scanlines, blinking block cursor |

## 2. Palette (binding)

12 base colours from `02` section 3.2 plus 12 dither tints = **24** (the `05` cap). Tints: brass, amber, teal, blue, rust each get `-deep` (45% toward night) and `-light` (45% toward paper); fog gets `-light` (needed for secondary text on slate); phosphor gets `-deep` (dim terminal output). The neutrals already form their own ramp; olive dithers against night. A vitest test (`packages/ui/src/palette.test.ts`) fails if `tokens.css`, `palette.json` and the spec drift apart.

Rules:
- CSS and SVG use **only `--cf-*` tokens** (or the semantic `--tk-*` aliases built on them). `color-mix(in srgb, var(--cf-x) N%, transparent)` is allowed for glows, hairlines and overlays, **never for text**.
- **One saturated accent per scene.** The scene's accent is `--tk-mood-light` (section 4). UI brass is chrome, not scene light.
- **Text on night/ink: paper or fog. Text on slate: paper or fog-light. Text on paper: ink or slate.** Accent text uses the deep tint on paper and the light tint on dark (`--tk-danger-text`, `--tk-link`, `--tk-success-text`).
- **Never colour alone.** A red check is rust **plus** a stamp icon **plus** the word "אדומה". Success is teal **plus** a check icon.
- Olive and rust are fill colours on dark (pips, borders, sigils). They are never body text on night.

Approved text pairs (all >= 4.5:1) and forbidden pairs live in `palette.json > contrast`; the test re-computes them.

| Need | Use | Ratio |
|---|---|---|
| Body text on page | paper on night | 12.2 |
| Secondary on page | fog on night | 5.2 |
| Secondary inside a slate panel | fog-light on slate | 5.8 |
| Text on a brass button | ink on brass | 7.0 |
| Error text on dark | rust-light on night | 6.0 |
| Error text on paper | rust-deep on paper | 6.7 |
| Link on dark / on paper | blue-light 6.9 / blue-deep 5.6 | |
| Terminal / dim terminal | phosphor 11.4 / phosphor-deep 4.6 on ink | |

## 3. Typography

- **Sans: Heebo** (OFL, variable). Until the self-hosted WOFF2 subset lands (font task, `04` section 3.4, <= 60 KB, no Google runtime call), the stack falls back to Assistant, Rubik, Segoe UI, Arial Hebrew, Noto Sans Hebrew.
- **Mono:** system `ui-monospace` stack for CLI islands and the terminal.
- **Typewriter:** Courier New (ships Hebrew glyphs) for **short labels only**: eyebrows, case numbers, stamp sub-lines, folder tabs. Never for sentences (monospaced Hebrew is slow to read).
- Base 18px desktop, 17px phone. Scale = major third on `rem` (root = `--tk-text-base`, so the S/M/L text-size setting scales everything): 13.5 (meta only) / 15.75 / 18 / 22.5 / 28 / 35 / 44 px at desktop base. Leading 1.55 for Hebrew body, 1.2 for headings. Measure about 62ch.
- Weights: 400 body, 500 memo body, 700 buttons and labels, 800 headings and speaker tags, 900 stamps.
- Hebrew has no capitals and no true italics. Emphasis = weight. The **only** italic is the inner-voice bubble (synthesised oblique is acceptable there because it signals "a thought, not a person").
- LTR islands (`<ltr>` in content, `ltr()` in code) never break across lines and use tabular numbers. A MAC address is one unbreakable token.

## 4. Mood-driven colour grade

Every scene declares a `mood` id (04 addendum). The mood sets `data-mood` on the scene root; the tokens below change, and music, ambience and the Flow grade follow the same id. The UI chrome does not change colour by mood; only the scene light, vignette and motion tempo do.

| `data-mood` | Scene light (`--tk-mood-light`) | Vignette | Tempo | Music / ambience | Use |
|---|---|---|---|---|---|
| `bureau` | amber | 0.55 | 1.0 | `mus_bureau`, `amb_office` | Hub, briefings, Rishon |
| `investigate` | teal | 0.65 | 0.9 | `mus_investigate`, rain | Witness scenes, hotspots |
| `terminal` | phosphor | 0.70 | 0.85 | `mus_terminal`, `amb_server` | CLI tasks, packet sims |
| `deduction` | brass | 0.75 | 1.15 | `mus_deduction` | Check overlays, case board |
| `suspicion` | rust | 0.70 | 1.0 | `mus_investigate` (low) | Lies, rogue devices, red check build-up |
| `solved` | amber-light | 0.35 | 1.2 | `mus_solved` | Result screen, stamp "נסגר" |
| `blackout` | fog | 0.90 | 1.4 | `mus_blackout` | Session cap (minute 12) |

`--tk-mood-tempo` multiplies durations of ambient, mood-aware animation only (dust, lamp flicker, packet travel). It never slows input feedback.

Raster grade (palette-lock script, `04` section 2.1): luminance through night -> slate -> paper at 60%, then quantise to `palette.json > quantise`. Per mood, the script may tint the highlight stop toward the mood light (max 15%) so a teal investigation shot and an amber hub shot still share one family.

## 5. Surfaces and components

Surfaces, from back to front: **night** page (with a soft radial pool of the mood light and a vignette) -> **slate** panels and dialogue boxes -> **paper** cards (ink text, faint grain, ruled lines) -> **brass** controls. **Ink** is the deepest well: terminal, voice bubbles, toasts, voice tags.

All components are plain TS functions returning DOM elements, styled by `components.css`, prefixed `tk-`. Strings come from the caller (or `packages/ui/locales/he.json` for kit defaults), never hard-coded Hebrew in components.

| Component | Function | Look | Notes |
|---|---|---|---|
| Button | `tkButton` | primary = brass with bevel and ink text; secondary = slate with brass hairline; ghost; danger = rust-deep; choice = full-width numbered dialogue option | 44px min, 56px `lg` and phone choices; press scale 0.97 / 90ms; chevron and play mirror in RTL |
| Card | `tkCard` | `index` (paper, blue rules, red header rule), `folder` (manila brass-light with a tab), `memo` (paper, brass-deep top stripe), `panel` (slate) | `pinned` adds a brass pin, `tilt` (-3..3 deg) for the case board; `onActivate` makes the whole card one button |
| Dialog | `tkDialog` | `slate` system dialog with brass top rule; `paper` in-world card (check overlay) | Native `<dialog>` + `showModal` (focus trap, Esc). `modalLocked` for red checks. Bottom sheet on phone, actions stacked, primary nearest the thumb |
| Toast | `tkToast` | ink slab, coloured inline-start bar + icon per tone (info, success, warn, error, reward) | Shared `aria-live` region; error is `role=alert` and sticky; pauses on hover/focus |
| Tabs | `tkTabs` | folder tabs: slate tabs, the selected one turns paper and joins the paper panel | WAI-ARIA tabs, roving tabindex; arrow keys follow the visual direction (RTL aware) |
| ProgressBar | `tkProgress` | ink well, glowing fill in brass/teal/amber/phosphor/rust, optional ticks | `role=progressbar` with value text; fills from inline-start (right in RTL) |
| Bubble | `tkBubble` | `line` (slate box, brass speaker tag, tag colour by mood), `narration` (centred between brass hairlines), `voice` (ink, voice-coloured start border and glow, italic; Command Line in phosphor mono) | Typewriter at 40 cps with punctuation pauses; layout never jumps (ghost copy reserves the box); screen readers get the full line once; tap or `skip()` completes; instant under reduced motion |
| VoiceTag | `tkVoiceTag` | ink pill, sigil in a tinted disc, 5 diamond pips, level word | Level 0 = dashed, lock sigil, "מושתק"; `progress` (0..3) draws a thin underline toward the next level; `compact` for the hub strip |
| Stamp | `tkStamp` | double-ruled rubber stamp, 900-weight letters, slight rotation, worn-ink mask | `stampThunk()` replays the landing (1.3 -> 1 with overshoot, 420ms); tones auto-darken on paper |
| Terminal inset | `.tk-terminal` (CSS) | ink, phosphor text, faint scanlines and glow | Always `dir="ltr"`, `role="log"` in the real terminal (F7) |

## 6. Motion

Calm and short. `--tk-dur-press` 90ms, `fast` 150, `base` 200, `slow` 250, `page` 360, `stamp` 420. Ease-out `cubic-bezier(.2,.7,.2,1)` for everything that enters; the stamp alone may overshoot. Screens slide 8px from the inline-start (right in RTL) with a crossfade.

- `prefers-reduced-motion` **or** the in-game calm toggle (`<html data-calm>`) sets every duration to ~0, the typewriter to instant, and stops looping motion (cursor blink, continue bob, dust).
- No flashing, no strobe, no shake outside the one mini-game moment (`04` section 7). Blackout is a fade.

## 7. Icons and voice sigils

24x24 grid, 1.5px round stroke, `currentColor`, no fills except tiny dots. Decorative icons are `aria-hidden`; icon-only buttons carry the label as `aria-label` and tooltip. The full ~60-icon sprite (task A4) must match `packages/ui/src/icons.ts`.

Voice sigils (same grid, the voice accent is applied by CSS, never baked in): Logic = small flowchart (blue), Packet Sense = envelope with radar arcs (teal), Patience = hourglass (amber), Suspicion = narrowed eye (rust), Recall = index card (olive), Command Line = `>_` window (phosphor). If voice portraits are produced in Flow, the sigil is still drawn on top as an SVG badge.

## 8. Raster art direction (Flow prompts, A1)

Every prompt file in `art/prompts/` uses this frame, then adds subject and composition:

> Hand-painted noir illustration, visible brush grain, flat-ish shapes, deep ink-blue shadows, a single warm tungsten light source, soft vignette, 1950s harbour-city office with tangled network cables and old terminals, rainy night outside the window, calm and slightly melancholic mood, school-friendly, no text, no logos.

- **Lighting rule:** one key light per image (lamp, terminal glow, window neon) in the scene's mood colour; everything else falls into ink-blue. Portraits: 3/4 bust, chin-up key light, rim light from the mood colour.
- **Composition:** 16:9 with the story-critical area in the centre 4:5 (phone crop). Leave the lower 30% quiet: dialogue sits there.
- **Characters:** stylised, warm, readable silhouettes; three expressions per NPC. Skin tones come from the paper / rust / amber mix after palette-lock (no extra hues).
- **Never:** weapons, blood, cigarettes, alcohol, gambling, political or religious symbols, real brands or logos, living artists' names, real people, photoreal faces, horror lighting, heavy lens flares, neon cyberpunk overload.
- The palette-lock + dither pass is mandatory; an image that only looks good before quantisation is rejected.

## 9. Do / Don't

| Do | Don't |
|---|---|
| Let paper be the "content you hold": evidence, memos, case files, quiz cards | Put long text on brass or amber |
| Keep one glowing accent per scene, matched to the mood | Mix teal, rust and amber light in one background |
| Use brass for the primary action, at inline-start (right in RTL) | Use more than one primary button per view |
| Wrap every IP, MAC, command and English term in an LTR island | Let a MAC address break at its hyphens or flip direction |
| Pair every status colour with an icon and a word | Rely on red/green alone (the red check is a stamp + "אדומה") |
| Use SVG icons from the kit | Use emoji anywhere in student UI |
| Keep labels short and typewriter-styled; keep sentences in Heebo | Set Hebrew paragraphs in Courier |
| Use small radii (2-8px); paper does not round | Pill-shaped cards or bubbly 24px radii |
| Use ink-coloured shadows (`--tk-shadow-*`) | Pure black shadows or glows on paper |
| Make focus rings visible on every surface (amber + ink halo) | Remove outlines, or style focus only on hover |
| Offer a 44px target for every control, 56px for phone answers | Shrink tap targets to fit a row on 390px; wrap instead |

## 10. Accessibility checklist (per screen)

- Text pairs only from section 2; run the palette test after any token change.
- 44px targets (56px for quiz answers on phone), visible focus, logical tab order following RTL reading order, Esc closes non-locked dialogs.
- Dialogue: one `aria-live="polite"` region per scene; bubbles expose full text immediately to screen readers; voice bubbles start with the voice name.
- Respect reduced motion and the calm toggle. Nothing essential is conveyed by motion or sound alone.
- Phone 390x844 and desktop 1280x720 screenshots in RTL for every screen (QA gate in `05`).

## 11. RTL rules

`<html lang="he" dir="rtl">`. Components use logical properties only (`inline-start/end`, `block-start/end`, `border-start-start-radius`). Directional icons (chevron "forward", play) are drawn LTR and mirrored by CSS in RTL. Terminal regions are `dir="ltr"` with `unicode-bidi: isolate`. Numbers that carry a sign or unit (`+45`, `3/8`, timers) go in an LTR island.

## 12. Open items for the M6 review pass

- Swap in the Heebo WOFF2 subset and re-check line lengths and the speaker-tag size.
- Review the first palette-locked Flow batch against section 8; adjust the mood highlight tint in the grade if images feel too uniform.
- Re-shoot the design-system page at 390 and 1280 with Playwright once T1 lands, and compare.
