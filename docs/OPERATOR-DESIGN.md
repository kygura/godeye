# Operator: interface design brief

Status: v1, 2026-10-18. Applies to the default (`tactical`) shell. The opt-in Cyber
layout keeps its own palette but inherits the effect bans in §4.

## 1. Direction

A restrained, brutalist operator console. The globe is the only thing allowed to look
rich; every piece of chrome around it is flat, opaque, square and quiet. Think avionics
MFD bezels, a broadcast vision mixer, a terminal multiplexer: hairline rules, dense
tabular numbers, labels you read once and then stop noticing.

What it replaces: frosted glass, cyan glow, gradient fills, pill buttons, 3–6px letter
tracking on every label, and spy-film copy (fake classification banners, taglines).

Rules of thumb:

- Structure comes from 1px rules and alignment, never from shadows or blur.
- State is shown by inversion and weight, not by colour and glow.
- Colour is a signal. If it is not live, armed, caution or warning, it is grey.
- Numbers are mono and tabular. Prose is sans. Nothing is both.

## 2. Tokens (defined in `src/ui/styles/foundation.css` `:root`)

Surfaces (opaque; no `backdrop-filter` anywhere in the default shell):

| Token                 | Value     | Use                                       |
| --------------------- | --------- | ----------------------------------------- |
| `--bg-dark`           | `#070808` | page, behind the globe                    |
| `--surface-0`         | `#0c0d0e` | panels, dock, menus                       |
| `--surface-1`         | `#131516` | raised rows, inputs, hover fill           |
| `--surface-2`         | `#1b1d1f` | pressed / active row fill                 |
| `--glass-bg`          | `rgba(10, 11, 12, 0.94)` | legacy name, now near-opaque |
| `--menu-bg`           | `#0c0d0e` | native select popups                      |

Rules:

| Token                  | Value     | Use                                     |
| ---------------------- | --------- | --------------------------------------- |
| `--rule`               | `#26292b` | default 1px border, dividers            |
| `--rule-strong`        | `#3a3e41` | hover border, panel outer frame         |
| `--glass-border`       | = `--rule`        | legacy alias                    |
| `--glass-border-hover` | = `--rule-strong` | legacy alias                    |

Ink:

| Token              | Value     | Use                                         |
| ------------------ | --------- | ------------------------------------------- |
| `--text-primary`   | `#e6e7e8` | values, active labels                       |
| `--text-secondary` | `#9a9fa3` | labels, body copy                           |
| `--text-dim`       | `#62676b` | units, disabled, tertiary metadata          |
| `--ink-inverse`    | `#070808` | text on an inverted (selected) control      |

Signal (the only chromatic colours in chrome):

| Token          | Value     | Meaning                                                     |
| -------------- | --------- | ----------------------------------------------------------- |
| `--accent`     | `#e6e7e8` | "lit / selected" — deliberately the primary ink, not a hue  |
| `--accent-dim` | `rgba(230, 231, 232, 0.08)` | selected-row fill                  |
| `--accent-glow`| `rgba(230, 231, 232, 0.22)` | legacy name; use only as a border  |
| `--signal`     | `#ffb020` | live / armed / recording / focus-of-attention. Sparingly.   |
| `--signal-dim` | `rgba(255, 176, 32, 0.14)` | fill behind a signal element         |
| `--ok`         | `#5fbf6a` | nominal / connected                                         |
| `--warn`       | `#ff5a4e` | error, failure, destructive                                 |

Data colours (score ramps, layer markers, weather, map symbology, FLIR palettes) are
data, not chrome. Leave them alone.

Geometry: `--panel-radius: 0`, `--btn-radius: 0`. Circles that encode a dot or a
dial (status LEDs, the mic button, the scope keyhole, compass) stay round; everything
rectangular is square. No pills.

Motion: `--transition-fast: 90ms linear`, `--transition-smooth: 160ms
cubic-bezier(0.2, 0, 0, 1)`. Transitions on colour/border/opacity only. No pulsing,
breathing, shimmer or glow animations on chrome. Progress and loading indicators
may animate; a REC dot may blink at 1Hz with a hard step (`steps(1)`), not a fade.

## 3. Type

Faces: IBM Plex Mono (data, labels, controls) and IBM Plex Sans (prose: descriptions,
toasts, help text). Loaded in `index.html`; `--font-mono` / `--font-sans` point at them.

| Role                    | Face | Size | Weight | Tracking | Case  |
| ----------------------- | ---- | ---- | ------ | -------- | ----- |
| Panel title             | mono | 10px | 600    | 0.08em   | upper |
| Field label             | mono | 10px | 500    | 0.06em   | upper |
| Control / button        | mono | 11px | 500    | 0.04em   | upper |
| Value / readout         | mono | 12px | 500    | 0        | as-is, `tabular-nums` |
| Large readout           | mono | 15–20px | 500 | 0       | as-is |
| Prose                   | sans | 12–13px | 400 | 0       | sentence |
| Heading (dialogs)       | sans | 18–20px | 500 | -0.01em | sentence |

Hard cap: no `letter-spacing` above `0.12em` anywhere (the old 3–6px tracking is the
loudest slop tell). The title wordmark is 13px mono 600, 0.12em.

## 4. Banned in default chrome

- `backdrop-filter` / `-webkit-backdrop-filter`
- `text-shadow` (exception: HUD/cockpit text drawn directly over imagery may use a
  single tight legibility shadow `0 1px 0 rgba(0,0,0,0.9)` — no blur radius > 2px, no colour)
- `box-shadow` with blur or colour (glows, drop shadows, inset glows). Allowed: a
  0-blur 1px inset/outset stroke used as a border substitute, and focus rings.
- `linear-gradient` / `radial-gradient` as decoration on surfaces, buttons or borders.
  Allowed: functional gradients (data ramps, progress fills, fade masks for scrollers,
  the scope vignette, legends).
- `filter: drop-shadow(...)` / `blur(...)` on chrome.
- Emoji as UI icons where a Material Symbol or text will do.

## 5. Components

**Panel.** `--surface-0` fill, 1px `--rule` border, square. Header row 32px: title
left (panel-title style), controls right, 1px `--rule` bottom border. Body padding 10px.
Collapsed panel = header row only.

**Button (default).** 26–28px tall, `--surface-1` fill, 1px `--rule` border,
control type, `--text-secondary`. Hover: border `--rule-strong`, ink `--text-primary`.
Selected / pressed (`aria-pressed=true`, `.active`, `.selected`): inverted —
fill `--text-primary`, ink `--ink-inverse`, border `--text-primary`. Disabled: ink
`--text-dim`, border `--rule`, no fill change.

**Icon button.** Same as button, square footprint (28×28), icon 18px.

**Segmented control.** Buttons share borders (no gaps), selected segment inverted.

**Input / select.** `--surface-1`, 1px `--rule`, 28px, mono 12px; focus border
`--text-primary`.

**Slider.** 2px track `--rule-strong`, filled part `--text-primary`, thumb 10×14 square
`--text-primary`.

**Toggle row (layer list).** Row 30px, 1px `--rule` bottom divider. Off: label
`--text-secondary`, a 8×8 square outline indicator. On: indicator filled `--text-primary`
(or the layer's own data colour if it has one), label `--text-primary`. Live layer
streaming: indicator `--signal`.

**Chip / status pill.** Square, 1px border, mono 10px upper. Signal chips (live, REC,
keys waiting) use `--signal` border + ink, no fill glow.

**Toast.** `--surface-0`, 1px `--rule-strong`, prose type, square, bottom-centre.

**Dialog (first run, provider settings, compare).** `--surface-0`, 1px `--rule-strong`,
no shadow; a scrim `rgba(0,0,0,0.6)` behind (no blur). Heading in sans.

**Focus ring.** Unchanged contract: 2px solid `--text-primary` outline, 2px offset.

## 6. HUD overlay (the corner readouts over the globe)

Keep the information; drop the theatre. Mono 11px, `--text-primary` at 0.86 opacity
for values, `--text-dim` for labels. No glow. Corner brackets stay (they frame the
imagery), drawn in `--rule-strong`.

Copy changes:

- Classification banner `TOP SECRET // SI-TK // NOFORN` → `OPEN SOURCE // PUBLIC FEEDS`.
- `KH11-####` / `OPS-####` → `SESSION ####` / `SENSOR ####` (honest identifiers).
- Title subtitle `NO PLACE LEFT BEHIND` → removed (element kept, empty-safe).
- REC dot uses `--warn`, hard 1Hz blink.

## 7. Aircraft cockpit mode

The cockpit HUD is an instrument, so it keeps one symbology colour, but desaturated:
civil `--cockpit-accent: #9fe0c0` (phosphor green-white), military `#ffb020`. The glow
`text-shadow` is replaced with the single legibility shadow from §4.

## 8. Copy

Sentence case for prose, upper case for labels. No marketing voice in the UI. First-run
description becomes: "Live public data on a 3D globe. Pick a starting view." Toggle
labels: `ATLAS`, `TRAVEL` (upper like every other control).

## 9. Out of scope

Map imagery, visual presets (FLIR/NVG/CRT/anime), canvas overlays drawn by layers,
marker colours, the Cyber layout's palette, and all geometry that layout tests pin
(widths, heights, positions, z-index). This is a skin change; do not move things.
