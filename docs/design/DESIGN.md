# Godeye — Night Chart

The interface is a map's margin, not a cockpit. Everything that sits over the
globe should read like the furniture of a well-made chart: the neatline, the
legend, the scale bar, the cartouche, the graticule ticks along the edge. Quiet
ink on a dark ground, one survey-red accent, hairline rules, and type that
carries hierarchy without glow, gradients or wide tracking.

The visual mock lives at `docs/design/mock.html`. Open it in a browser.

## What we are removing

- Cyan (`#00d4ff`, `#22e6e6`) glows, glow shadows, glowing text and pulsing halos.
- Frosted "glass" cards with 16px radii and drop shadows.
- Letter-spacing above `0.08em`. The old UI tracks everything at `0.2–0.4em`.
- Faux-classified copy: "TOP SECRET // SI-TK // NOFORN", "NO PLACE LEFT BEHIND",
  "forbidden cockpit".
- Monospace as the default voice. Mono is for figures only.
- Gradient fills and gradient borders.

## Palette

All colors are tokens on `:root` in `src/ui/styles/foundation.css`. No component
should introduce a raw hex for chrome; data colors on the globe are out of scope.

| Token | Value | Use |
|---|---|---|
| `--ink-0` | `#0c1012` | page ground, behind the globe |
| `--ink-1` | `#12171a` | opaque surfaces (menus, selects) |
| `--surface` | `rgba(14, 18, 20, 0.88)` | panels over the map |
| `--surface-raised` | `rgba(20, 25, 28, 0.94)` | dialogs, popovers |
| `--rule` | `rgba(232, 226, 212, 0.14)` | hairlines, panel borders |
| `--rule-strong` | `rgba(232, 226, 212, 0.32)` | hover, neatline |
| `--vellum` | `#e8e2d4` | primary text |
| `--vellum-2` | `rgba(232, 226, 212, 0.64)` | secondary text |
| `--vellum-3` | `rgba(232, 226, 212, 0.40)` | tertiary, captions |
| `--cinnabar` | `#d9583b` | the single accent: active state, selection, focus of attention |
| `--cinnabar-wash` | `rgba(217, 88, 59, 0.14)` | active fill |
| `--ochre` | `#c9a35a` | warnings, pending |
| `--sage` | `#8fae8b` | live / ok |
| `--slate` | `#8ea5ad` | informational, water |

The legacy names (`--accent`, `--accent-dim`, `--accent-glow`, `--glass-bg`,
`--glass-border`, `--text-primary`, …) are kept as aliases so existing rules and
JS that read them keep working; they now resolve to the tokens above.
`--accent-glow` resolves to transparent: glows are gone.

## Type

- **Newsreader** (serif, roman + italic) — display and naming: the wordmark,
  dialog titles, panel titles, place names. Italic for place names and the
  active style, the way charts set water and regions in italic.
- **IBM Plex Sans** — UI text, buttons, descriptions.
- **IBM Plex Mono** — figures only: coordinates, times, altitudes, counts,
  frequencies.

Section labels use Plex Sans at 10.5px, `font-variant-caps: all-small-caps`
or uppercase, tracking `0.06em`, `--vellum-3`. Never wider.

Scale: 10.5 / 12 / 13 / 15 / 20 / 28px. Body 13px. Line height 1.45.

## Shape and line

- Radius `2px` on controls and panels (`--panel-radius`, `--btn-radius`).
  Round only things that are physically round: the mic, the compass, dots.
- Borders are 1px `--rule`. Active controls get a 1px `--cinnabar` rule and
  `--cinnabar-wash` fill, never a glow.
- Dialogs use a **neatline**: 1px outer rule plus a second 1px rule inset 4px
  (`box-shadow: inset 0 0 0 4px var(--surface-raised), inset 0 0 0 5px var(--rule)`).
- Shadows: one soft ink shadow for floating surfaces only,
  `0 12px 32px rgba(0,0,0,0.38)`. No colored shadows.
- Backdrop blur allowed at 8px max, for legibility over imagery.

## Layout and furniture

The layout of panels stays where it is today (left stack, right rail, bottom
dock, top-center actions). What changes is how each piece reads.

- **Title (top-left)**: Newsreader wordmark "Godeye" at 22px, roman, with a
  small compass-star mark; subtitle in italic `--vellum-3`: "an atlas of the
  living Earth".
- **Active style (top-right)**: caption "Style" + value in Newsreader italic.
- **HUD corners**: map-margin annotations. Mono 11px `--vellum-2`, no
  tracking, short 8px corner ticks in `--rule-strong`. Classification line
  replaced by the session line ("Survey · KH11-4122").
- **Graticule ticks** along the viewport edges (decorative, `--rule`), every
  10% with a longer tick every 50%.
- **Scale bar** bottom-left above attribution: alternating ink/vellum segments.
- **Panels**: flat `--surface`, 1px `--rule`, 2px radius, title in Plex Sans
  small caps with a hairline running to the right edge (legend style).
- **Top-center actions**: a single segmented bar with hairline dividers
  instead of separate floating pills.
- **Dock**: flat bar, mic as a round ink button with a cinnabar ring when live.
- **Toasts / chips**: flat rectangles, mono figures, left 2px rule in state
  color.

## Interaction and motion

- Hover: border to `--rule-strong`, text to `--vellum`. 150ms.
- Active/selected: cinnabar rule + wash. Focus ring: 2px `--vellum` outline
  (existing global rule, unchanged).
- Motion: fades and 4–8px translates only. No pulsing glows; live indicators
  use a slow 2s opacity breathe on a 6px dot.

## Out of scope

Data-layer colors drawn on the globe (aircraft, ships, quakes, heatmaps), the
Cesium imagery, and the visual-style post-processing shaders keep their own
palettes. The cyber sonar mode keeps its own scoped theme but loses its glow.
