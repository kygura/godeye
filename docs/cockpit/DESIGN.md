# City Intel ("ATLAS"): interface design brief

Status: v1 design, 2026-09-24; addendum §11 (PLAN view, SPEC §3.5) the same day. Companion
to [SPEC.md](SPEC.md) (scope, data, scoring) and [TASKS.md](TASKS.md). This brief settles
every visible decision. The implementer builds exactly this; where the spec and this brief
differ on presentation, this brief wins.

Visual language: GEV's own glass panels, 9px mono uppercase titles, cyan `--accent`, and the
Cyber re-skin (`:root[data-ui-theme='cyber']`) that swaps the same tokens for slate, off-white
and 1px radii. Everything below uses tokens only, so Cyber restyles it for free. The only new
colour is the score ramp (data, not chrome).

## 0. Decisions at a glance

| Question          | Decision                                                                                                                                   | Why (one line)                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| User-facing label | **ATLAS** (code: City Intel, layer id `city-intel`)                                                                                        | Short, globe-native, no clash with the aircraft Cockpit                      |
| Entry point       | Pill button `#city-intel-toggle` in `#top-center-actions`, icon + "ATLAS", `aria-pressed`                                                  | Same slot the Travel WIP used for its mode; modes live together              |
| Panel placement   | Right rail (`#right-context-rail`), new `#city-intel-panel` above CONTEXT, rail width (330px)                                              | "Left = act, right = inspect"; ranking/scorecard are inspection              |
| Compare           | Separate centred overlay `#city-intel-compare`, 720px max                                                                                  | Four raw+percentile columns do not fit 330px                                 |
| Weights           | Four native range sliders 0–10, step 1, plus a 4-way preset segment                                                                        | Native input, existing `gev-quantitative-slider` skin                        |
| Ranking default   | Grouped by country, best city first, "+N more" expander; segment toggle to flat                                                            | Country-level data ties cities; grouping is honest                           |
| Marker size       | Fixed 8px; ineligible 6px hollow                                                                                                           | Ranking already answers "which"; size would add noise                        |
| Country tint      | **No**                                                                                                                                     | Would double-encode the same national number and hide city-level differences |
| Legend            | Ramp strip inside the panel, directly under the header                                                                                     | One legend, always next to the controls that change the colours              |
| Plan surface      | RANK / PLAN segment at the top of the panel body; the PLAN view (§11) replaces the TRIP block                                              | SPEC §3.5: the plan is the product; ad-hoc trips keep the Trips row chips    |
| Persistence       | `localStorage` key `gev:city-intel:v1` (weights, preset, passport, filters, pins, view mode, mode, homeCityId, monthlySpendUsd, overrides) | Spec §5; mirrors `gev:travel:v1`; the plan's stays live in `tripStore`       |

## 1. Mode: naming, entry, what changes

**Label.** The mode, the toggle, the panel title and voice replies all say **ATLAS**. Code,
files, ids and docs say City Intel. The word "cockpit" never appears in UI copy.

**Entry.** `#city-intel-toggle` is the first child of `#top-center-actions`, styled like the
WIP's `#travel-toggle` (auto width, icon + label, `border-radius: 18px`, sans 13px 500).
Icon: Material Symbol `travel_explore` (add it to the `icon_names` subset in `index.html`;
`src/materialSymbolsSubset.test.mjs` enforces the sync). `aria-pressed="true"` while in mode;
lit state uses `--accent` border and `--accent-dim` fill. Tooltip: "ATLAS: rank and compare
cities". No new global keyboard shortcut (single-letter keys are crowded); the toggle is
reachable by Tab. The `city-intel` layer also has a normal DATA LAYERS row (group it next to
Submarine Cables, the other bundled keyless reference layer, with `trips` directly after it);
toggling the row alone shows markers without entering the mode. Entering the mode is the
only thing that hides other layers.

**Entering the mode** (`src/ui/cityIntelMode.js`, see §10):

1. Snapshot the set of currently enabled layer ids.
2. Disable every enabled layer except `city-intel` and `trips`. This covers aircraft, military,
   vessels, CCTV, radio, traffic, transit, bikeshare, satellites, launches, earthquakes,
   cyclones, fires, weather products, installations, ALPR, wind, submarine cables. Base
   imagery, terrain, style presets, the scope mask and the Intel HUD are untouched.
3. Enable `city-intel` and `trips`.
4. Add `body.city-intel-mode`. Expand `#city-intel-panel`; collapse `#global-context-panel`,
   `#cctv-panel`, `#scene-panel`. `#data-panel` keeps whatever state it had. Do not hide any
   panel; users may reopen anything (reopening a layer inside the mode is allowed and is
   simply restored-over on exit).
5. Toast: "ATLAS on. Other layers paused until you exit."

**Exiting** (toggle again, or the `EXIT` button in the panel header): restore the snapshot
exactly (enable what was on, disable `city-intel`/`trips` unless they were on before), remove
`body.city-intel-mode`, collapse `#city-intel-panel`. Toast: "ATLAS off. Layers restored."
Escape does not exit the mode (Escape already collapses panels app-wide); it closes the
compare overlay or an open scorecard first, per §9.

**Cyber theme.** No special casing beyond tokens. The panel body uses the
`.cyber-panel-body[data-rail-scroller]` wrapper (same DOM shape as `#global-context-panel`),
so Cyber's accordion and scroller rules apply. Score ramp colours are unchanged in Cyber;
they are data. Travel Mode inside Cyber: see §6.

## 2. City Intel panel

Placement: `#right-context-rail > #city-intel-panel.panel-collapsible[data-panel-id]`, inserted
before `#global-context-panel`. Width 100% of the rail (330px; Cyber uses
`--cyber-right-panel-width`). Collapsed width follows `--right-context-collapsed-width`, as
CONTEXT does. Add `#city-intel-panel` to every rail selector list in `layers.css` and
`responsive.css` that enumerates `#global-context-panel` (position, collapsed height 50px,
focus allocation, measuring, ≤720px 100% width). DOM shape:

```
#city-intel-panel.panel-collapsible[data-panel-id="city-intel-panel"]
  .panel-glow
  .city-intel-panel-inner[data-rail-scroller]
    .panel-header  (title, divider, EXIT, collapse button)
    .cyber-panel-body[data-rail-scroller]  (everything below)
```

Section order, top to bottom (default "ranking" view):

```
┌ ATLAS ────────────────────────── [EXIT] [▼] ┐
│ [RANK][PLAN]                                │  ← §11 mode segment
│ Indicative, from public statistics; mostly  │
│ country-level; not relocation advice. (i)   │  ← link: docs/cockpit/METHODOLOGY.md
│ SCORE  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ○ no data │  ← §7 legend strip
│        0    20    40    60    80   100      │
│ WEIGHTS  [BALANCED][BUDGET][SAFETY][CUSTOM] │
│ Quality of life  ──────●────  5             │
│ Cost             ──────●────  5             │
│ Safety           ──────●────  5             │
│ Travel ease      ──────●────  5             │
│ HOME PASSPORT  [Not set            ▾]       │
│ Visa access counts toward Travel ease once  │
│ set.                                        │
│ FILTERS  Region [All regions ▾]             │
│          Min. population [Any ▾]            │
│          [ ] Hide Level 3–4 advisories      │
│          [ ] Show cities with insufficient  │
│              data                           │
│ RANKING · 412 cities   [BY COUNTRY][ALL]    │
│ 1  Lisbon · Portugal       74 ▮▮▮▮▮▮▮▯ 3/4 L1 ☆  [+2] │
│ 2  Valencia · Spain        72 ▮▮▮▮▮▮▮▯ 3/4 L1 ★  [+6] │
│ 3  Montevideo · Uruguay    69 ▮▮▮▮▮▮▯▯ 4/4 L2 ☆       │
│ …                                           │
│ [SHOW 100 MORE]                             │
│ PINS  Lisbon ✕  Valencia ✕   [COMPARE (2)]  │
└─────────────────────────────────────────────┘
```

**Header.** `.panel-title` "ATLAS". `EXIT` is a `.panel-layer-toggle`-styled button
(`aria-label="Exit ATLAS mode"`), hidden when the layer is on but the mode is off. Then the
standard `.panel-collapse-btn[data-collapse-target="city-intel-panel"]`.

**Not-advice note** (`.ci-note`, `--text-secondary`, 9px sans, line-height 1.4): exact copy
"Indicative, built from public statistics; mostly country-level; not relocation advice."
followed by a text link "How scores work" to `docs/cockpit/METHODOLOGY.md` (`target="_blank"
rel="noopener"`). Always visible; never collapsible.

**Legend strip**: see §7.

**Weights.** Section label `.ci-section-label` (same skin as `.pp-slider-mini-label`: mono
8px, 1px tracking, `--text-dim`). Preset segment is a `.pp-mode-seg` radiogroup
(`role="radiogroup"`, buttons `role="radio"`): BALANCED 5/5/5/5, BUDGET 3/8/5/3,
SAFETY-FIRST 4/3/9/3 (rendered "SAFETY"), CUSTOM. Moving any slider selects CUSTOM. Each slider
row: `<label>` text (sans 11px, `--text-primary`), `<input type="range" min="0" max="10"
step="1" class="gev-quantitative-slider">`, `<output class="gev-slider-value">`. Value 0 means
the pillar is ignored; the label then reads "Cost · off" and its output shows "0". Re-rank on
`input` (live), announce on `change` (§9). If all four are 0: list body shows "Set at least one
weight above 0." and the globe shows every marker in the neutral style.

**Home passport.** Native `<select id="ci-passport">`, first option "Not set", then every
country in `countries.json` alphabetically ("Portugal · PRT"). Helper line under it (9px,
`--text-secondary`): "Visa access counts toward Travel ease once set." When set, the helper
becomes "Visa access from PRT counted in Travel ease." Changing it re-ranks.

**Filters.** Region: `<select>` "All regions" + World Bank regions from `countries.json`.
Min. population: `<select>` Any / 250k / 500k / 1M / 5M. Two native checkboxes with visible
labels: "Hide Level 3–4 advisories" (default off) and "Show cities with insufficient data"
(default off). Filters change the list and dim (not remove) filtered-out globe markers to the
neutral style; ineligible cities always stay on the globe (§7).

**Ranking header.** "RANKING · N cities" where N is the count after filters. Segment
BY COUNTRY / ALL (radiogroup). Default BY COUNTRY.

**Row anatomy** (`.ci-row`, one `<button>` per row inside `role="list"` > `role="listitem"`;
min-height 34px; grid columns `22px 1fr auto 48px 28px 24px 24px`):

| Slot     | Content                                                                           | Style                                                         |
| -------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Rank     | "1"                                                                               | mono 10px, `--text-dim`, tabular nums                         |
| Name     | "Lisbon · Portugal" (grouped view: best city name · country)                      | sans 12px 500 `--text-primary`; country in `--text-secondary` |
| Score    | "74"                                                                              | mono 12px 600, colour = ramp bin                              |
| Bar      | 48×4px track `rgba(255,255,255,.08)`, fill width = score%, fill colour = ramp bin | radius 2px (Cyber: 1px)                                       |
| Coverage | "3/4" (`title="3 of 4 pillars available"`)                                        | mono 9px `--text-secondary`                                   |
| Advisory | "L1"…"L4" badge; "—" when unavailable                                             | §7 badge colours                                              |
| Pin      | ☆ / ★ toggle, `aria-pressed`, `aria-label="Pin Lisbon for comparison"`            | `--text-dim`, pinned `--accent`                               |

Grouped view adds a trailing `[+N]` expander button (`aria-expanded`) on rows whose country
has more ranked cities; expanded children render as indented rows (padding-left 22px) with
their own ranks and a 1px `--glass-border` left rule. Selected row: `--accent-dim` background
and a 2px `--accent` left border. Hover: `rgba(255,255,255,.03)` like `.data-toggle-row`.
Clicking the row (not the pin) opens the scorecard view and flies the camera to the city
(flight only; no zoom-in below 800 km height).

Render the first 100 rows, then a full-width `.scene-btn` "SHOW 100 MORE". In grouped view
the count applies to country groups.

**Pins tray.** Chips "Lisbon ✕" (✕ unpins). Empty state text: "Pin 2–4 cities to compare."
`COMPARE (n)` is a `.scene-btn`, disabled below 2 pins. A fifth pin is refused with toast
"Compare holds 4 cities. Unpin one first."

## 3. Scorecard (single city)

Replaces the ranking view inside the same panel body (weights, passport, filters and the
legend stay above it, so re-weighting while reading a scorecard is possible). Top of view:

```
│ ‹ RANKING                                   │
│ Lisbon                          74  ▮▮▮▮▮▮▯ │
│ Portugal · Lisboa · 2.9 M · rank 1 of 412   │
│ 3 of 4 pillars · 1 city-level metric · L1   │
│ [PIN] [ADD TO PLAN] [BRIEF ME] [FLY TO]     │
│ In plan: NOV–FEB · 4 mo                     │  ← only when the city is already in the plan
│ QUALITY OF LIFE ·· 71 · FULL · w5           │
│  Life expectancy   82.4 yr    P84 ▮▮▮▮▮▮▮▯  │
│    2023 · World Bank WDI · COUNTRY          │
│  Internet users    87 %       P71 ▮▮▮▮▮▮▯▯  │
│    2023 · World Bank WDI · COUNTRY          │
│  PM2.5 exposure    8.6 µg/m³  P59 ▮▮▮▮▮▯▯▯  │
│    2020 · World Bank WDI · COUNTRY          │
│ COST ············ 43 · FULL · w5            │
│  Price level       0.68 × US  P43 …         │
│    2023 · derived: PA.NUS.PRVT.PP ÷ FCRF    │
│ SAFETY ·········· 88 · FULL · w5            │
│ TRAVEL EASE ····· — · PARTIAL · w5          │
│  Nearest airport   LIS · large · 7 km  P92  │
│    2026 · OurAirports · CITY                │
│  Visa access       Set your passport        │
│ NOT SCORED                                  │
│  Climate comfort  ▁▂▃▅▆▇▇▇▆▅▃▂ Best May–Sep │
│  Air quality now  PM2.5 6 µg/m³ · EU AQI Good│
│    Open-Meteo · 14:10                       │
│  Advisory         Level 1 · Exercise normal │
│    precautions · updated 2026-08-12 · state.gov │
```

**Header block.** City name sans 16px 600; composite mono 22px 600 in ramp colour with a
72×5px bar; meta line (sans 10px `--text-secondary`): "Country · admin1 · population · rank r
of N" (population formatted "2.9 M", "640 k"). Coverage line copies the scoring module's
summary string verbatim ("3 of 4 pillars · 1 city-level metric") plus the advisory badge.
Ineligible city: composite shows "—", rank slot reads "not ranked", and a `.ci-banner`
(1px `--glass-border`, `--text-secondary`) states the reason: "Not ranked: Safety unavailable."
or "Not ranked: only 2 of 4 pillars available."

**Actions.** 2×2 grid of `.scene-btn`: PIN (toggles to PINNED, `aria-pressed`), ADD TO PLAN
(§11.6: appends a stay at the first free month; label never changes because a city may appear
twice; disabled only when the plan is full), BRIEF ME (§6), FLY TO (camera to city, 600 km).
Under the grid, a `.ci-helper` "In plan: NOV–FEB · 4 mo" lists this city's stays; omitted when
it has none.

**Pillar block** (`.ci-pillar`): header row = pillar name (mono 9px uppercase, 2px tracking),
dotted leader, pillar score (mono 12px 600, ramp colour, or "—"), coverage word FULL /
PARTIAL / UNAVAILABLE (mono 8px; UNAVAILABLE in `--text-dim`), weight chip "w5" (or "off").

**Metric row** (`.ci-metric`, two lines): line 1 grid `1fr auto 40px 48px`: label (sans 11px),
raw value + unit (mono 11px `--text-primary`), percentile "P84" (mono 10px), 48×4px bar in
ramp colour. Line 2 (mono 8px `--text-secondary`): "year · source · LEVEL". LEVEL is a badge:
`CITY` (1px `--accent` outline) or `COUNTRY` (1px `--glass-border-hover` outline). Derived
metrics append " · derived" and a `title` with the formula. Higher-is-worse metrics
(PM2.5, homicide) show the percentile after direction handling, so P84 always means "better
than 84% of countries"; the label carries `title="Lower raw value is better"`.

**Special values** (all in line 1's value slot, mono 11px `--text-secondary`, percentile "—",
bar empty):

| Case              | Value text                                                       | Line 2                             |
| ----------------- | ---------------------------------------------------------------- | ---------------------------------- |
| Missing in pack   | "unavailable"                                                    | "no data within 10 years · source" |
| Passport unset    | "Set your passport" as a link-button that focuses `#ci-passport` | "counts once a passport is set"    |
| Live proxy failed | "unavailable (source offline)"                                   | "source · last tried 14:10"        |
| Live proxy stale  | value as normal                                                  | appends " · cached 3 h ago"        |

**Not scored block.** Section label "NOT SCORED" with `title="Shown for context; never part of
the composite"`. Climate comfort: 12 cells (each 100%/12 wide, 10px tall, gap 1px) tinted by
the score ramp from monthly comfort 0–100, month initials underneath in mono 7px, and the
best window text "Best May–Sep" from the seasonality module; absent when the city has no
seasonality row (no placeholder). Air quality: PM2.5 + European AQI category + "Open-Meteo ·
HH:MM"; offline → "unavailable (source offline)". Rent (US cities only): "$2,140 / mo · ZORI
Jul 2026 · Zillow · metro"; non-US cities omit the row entirely. Advisory: "Level n · official
wording · updated date · state.gov" (link). Non-US cities without an advisory record: row
omitted. US cities: row reads "No US advisory for domestic destinations."

## 4. Compare overlay

`#city-intel-compare` is a fixed, non-modal `role="dialog" aria-labelledby` surface: width
`min(720px, 100vw - 32px)`, `left: 50%; transform: translateX(-50%)`, `top: 96px`,
`max-height: 70vh`, scrollable body, `z-index: 120`, same glass skin as panels
(`--glass-bg`, `--glass-border`, `--panel-radius`, the standard panel shadow). Opens from
COMPARE (n) or the voice tool. The rail panel stays usable behind it.

```
┌ COMPARE · 3 CITIES ─────────────────────────── [CLEAR PINS] [CLOSE ✕] ┐
│                 │ Lisbon        ✕ │ Valencia      ✕ │ Montevideo   ✕ │
│                 │ Portugal        │ Spain           │ Uruguay        │
│ COMPOSITE       │ ▲ 74 ▮▮▮▮▮▮▮▯   │   72 ▮▮▮▮▮▮▮▯   │   69 ▮▮▮▮▮▮▯▯  │
│ QUALITY OF LIFE │ ▲ 71            │   70            │   62           │
│  Life expectancy│ ▲ P84 · 82.4 yr │   P82 · 83.2 yr │   P58 · 78.1 yr│
│  Internet users │   P71 · 87 %    │ ▲ P78 · 94 %    │   P66 · 90 %   │
│  PM2.5          │ ▲ P59 · 8.6     │   P52 · 9.9     │   P61 · 8.3    │
│ COST            │   43            │   48            │ ▲ 55           │
│ SAFETY          │ ▲ 88            │   86            │   64           │
│ TRAVEL EASE     │   — · partial   │   — · partial   │   — · partial  │
│  Nearest airport│ ▲ P92 · LIS 7km │   P80 · VLC 8km │   P71 · MVD 19km│
│  Visa access    │   set passport  │   set passport  │   set passport │
│ Advisory        │   L1            │   L1            │   L2           │
│ Rent (US only)  │   —             │   —             │   —            │
└─────────────────────────────────────────────────────────────────────┘
```

Structure: a real `<table>` (`.ci-compare-table`, `table-layout: fixed`): first column 132px
row labels; 2–4 equal city columns. Header cell: city (sans 12px 600), country (9px
`--text-secondary`), unpin ✕ (`aria-label="Unpin Lisbon"`). Row groups per pillar: pillar
score row (mono 12px 600, ramp colour) then metric rows (percentile bold mono 11px, raw value
after " · " in `--text-secondary`). Composite row first, Advisory and Rent rows last. Best in
row: prefix "▲" in `--accent` plus a 2px `--accent` left border on the cell and
`aria-label` suffix "best in row"; ties mark every tied cell; rows with fewer than two values
mark nothing. Missing: "—" with `title="unavailable"`; passport unset: "set passport".
Higher-is-worse metrics still mark the best (lowest raw) cell. Removing pins below 2 closes
the overlay. CLEAR PINS empties the tray and closes. CLOSE and Escape close; focus returns to
COMPARE (n). At ≤720px the overlay becomes a bottom sheet (`inset: auto 0 0 0`, radius
top-only, `max-height: 70vh`) and city columns show percentiles only (raw value moves to the
cell `title`).

## 5. Trips integration

**Superseded by §11.** SPEC §3.5 cut the ATLAS TRIP block: nothing in this section is built,
`#ci-trip` leaves the template, and ad-hoc trips keep the Trips layer's own DATA LAYERS row
chips (FLY / CLEAR). Kept for history only.

**Surface.** A native `<details class="ci-trip">` at the bottom of the panel body. Summary
line: "TRIP · 3 stops · 4,120 km · ~6 h" (mono 9px; "TRIP · no stops" when empty). Open state
persists in `gev:city-intel:v1`. Body:

```
│ ▾ TRIP · 3 stops · 4,120 km · ~6 h          │
│  1 Lisbon      LIS   ▲ ▼ ✕                  │
│  2 Valencia    VLC   ▲ ▼ ✕                  │
│  3 Montevideo  MVD   ▲ ▼ ✕                  │
│  Best shared window: May–Jun (3/3 stops)    │
│  [FLY ROUTE]  [CLEAR]                       │
```

Rows: index (mono 9px `--text-dim`), city (sans 11px), IATA (mono 9px `--text-secondary`,
"—" when none), move up / move down / remove as 24px icon buttons (`aria-label="Move Lisbon
up"`; first/last row's up/down disabled). Distances and hours come from the Trips layer's
`tripLegs`; hours are labelled "~" because they are estimates. FLY ROUTE and CLEAR call the
same `setParams({fly})` / `setParams({clear})` the DATA LAYERS chips call, so the row chips
and this block never diverge; CLEAR asks nothing (a toast "Trip cleared" with no undo is the
v1 ceiling).

**Best shared window.** From `seasonality.json`: the longest run of consecutive months where
every stop that has data scores comfort ≥ 60. Copy: "Best shared window: May–Jun (3/3
stops)"; the fraction counts stops with data. No qualifying month: "No shared comfortable
window." No stop with data: line omitted.

**Add to trip feedback.** Button flips to "IN TRIP ✓" (`aria-pressed="true"`, disabled),
toast "Added Lisbon to trip (3 stops)", the TRIP summary count updates, and the globe draws
the new arc (existing layer behaviour). Adding a city already in the trip is impossible
because the button is disabled; voice attempts reply "Lisbon is already in the trip."

## 6. Travel Mode handoff

BRIEF ME calls the Travel Mode controller with `{ name, lat, lon }` for the city: it pre-fills
`#travel-dest-input` with the city name, submits, and enters `body.travel-mode`. Travel Mode
hides the whole GEV shell including the right rail (its own CSS), so the ATLAS panel
disappears underneath. Nothing in City Intel state changes; the scorecard stays the current
view. Returning is Travel Mode's own exit (its ✕ or Escape): the shell fades back and the
ATLAS panel reappears on the same scorecard. Two small adjustments to the ported Travel UI,
both in `travel.css`:

1. Under `:root[data-ui-theme='cyber']`, set `--travel-accent: var(--accent)`,
   `--travel-surface: var(--cyber-panel-surface)` and `--travel-border: var(--glass-border)`
   so the briefing does not look like a different product in Cyber. Radii already follow
   `--panel-radius`.
2. Keep `body.travel-mode` hiding `#top-center-actions > :not(#travel-toggle)` but add
   `#city-intel-toggle` to the exception list so the lit ATLAS pill stays visible as a
   breadcrumb ("you are inside ATLAS"). Its click while in Travel Mode first exits Travel
   Mode, then toggles ATLAS.

Travel Mode's calm sans-serif 14px look is kept on purpose: it is a civilian briefing.

## 7. Globe visualisation

**Score ramp** (new tokens, defined in `city-intel.css` on `:root`; identical in Cyber):

| Token          | Value     | Bin                                |
| -------------- | --------- | ---------------------------------- |
| `--ci-score-0` | `#8a226a` | 0–19                               |
| `--ci-score-1` | `#bc3754` | 20–39                              |
| `--ci-score-2` | `#e45a31` | 40–59                              |
| `--ci-score-3` | `#f98e09` | 60–79                              |
| `--ci-score-4` | `#f6d746` | 80–100                             |
| `--ci-neutral` | `#8a8f98` | ineligible / filtered / no weights |

These are five samples of the Inferno sequence (0.35 → 0.95): lightness rises monotonically
(≈35 → 86 L*), which is what makes it safe for deuteranopia and protanopia, and the warm end
sits far from the greens and blues of satellite imagery and from the cyan/slate chrome of both
themes. Exactly five bins, no continuous interpolation, so the legend, the list bars and the
markers always match. The Cesium layer reads the tokens once via `getComputedStyle` at init
(they never change per theme).

**Markers.** Cesium points, `heightReference: CLAMP_TO_GROUND`,
`disableDepthTestDistance: Infinity`. Eligible and ranked: 8px, fill = bin colour, outline
black 1.5px (legibility over any imagery). Ineligible: 6px, no fill (fully transparent), outline
`--ci-neutral` 1.5px (hollow ring), `title`/pick text "insufficient data". Filtered out by the
current filters: same hollow neutral style (so the map matches the list without removing
cities). Hovered: outline white 2px (cursor pointer). Selected (scorecard open): 12px, outline
white 3px. Pinned: outline `#ffffff` 2px and the label always shown. Priority when combined:
selected > pinned > hovered.

**Labels.** Cesium labels, mono 11px, white fill, black outline 3px (the Trips scaffold's
label style), pixelOffset (0, −14). Shown for: the top 20 ranked cities in the current view
mode (grouped: top 20 countries' best cities), every pinned or selected city, and every
eligible city once the camera height is under 1,500 km. Text: city name only.

**Legend** (in-panel strip, §2 sketch): label "SCORE" (section label skin), a 5-segment bar
(each 20% wide, 6px tall, the five tokens in order, radius 2px on the ends), tick labels
0 · 20 · 40 · 60 · 80 · 100 underneath in mono 7px `--text-dim`, then a hollow neutral 8px ring
with "no data" beside it. `aria-label="Score colour scale, 0 to 100; hollow grey ring means
insufficient data"`. No floating on-map legend: the panel auto-expands on entry, hover text on
markers shows the score, and a second legend would be a second thing to keep in sync.

**Country tint: no.** A choropleth would repeat the national number the markers already
carry, wash out the imagery, and bury the two city-level differentiators (airport, climate).
If the map looks blocky by country, that is the data, and the grouped list says so.

## 8. States

| State                   | Where                    | Exact presentation                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pack loading            | Panel body               | Weights/filters rendered but `disabled`; list area shows "LOADING CITY PACK…" (mono 8px, 0.09em tracking, centred, `--text-dim`, like the missions roster empty state). Globe empty.                                                                                                                                       |
| Pack failed             | Panel body               | "CITY PACK UNAVAILABLE" + one line "Reload the page to retry." No retry button (reload is the retry). Toggle stays lit; exit still works.                                                                                                                                                                                  |
| Advisories offline      | Badges, filter           | Every badge renders "—" with `title="Advisory unavailable (source offline)"`; the "Hide Level 3–4" checkbox is disabled with helper "advisories offline". Ranking unaffected.                                                                                                                                              |
| Advisories stale        | Badges                   | Normal badge; `title` appends "cached 5 h ago".                                                                                                                                                                                                                                                                            |
| Visa offline            | Travel ease row          | "unavailable (source offline)"; Travel ease coverage becomes PARTIAL; composite recomputes without it.                                                                                                                                                                                                                     |
| Air / rent offline      | Not scored rows          | "unavailable (source offline)".                                                                                                                                                                                                                                                                                            |
| Empty after filters     | List                     | "No cities match. Loosen the filters." + `.scene-btn` RESET FILTERS (restores defaults, keeps weights).                                                                                                                                                                                                                    |
| No pins                 | Pins tray                | "Pin 2–4 cities to compare." COMPARE disabled.                                                                                                                                                                                                                                                                             |
| One pin                 | Pins tray                | Chip + "Pin one more to compare."                                                                                                                                                                                                                                                                                          |
| Passport unset          | Travel ease rows, helper | §3 special values; helper copy §2.                                                                                                                                                                                                                                                                                         |
| All weights 0           | List, globe              | "Set at least one weight above 0."; all markers neutral.                                                                                                                                                                                                                                                                   |
| Voice `rank_cities`     | Panel                    | Applies weights and region; preset segment jumps to CUSTOM; ranking re-renders; a `.ci-voice-chip` "VIA VOICE" (mono 8px, `--accent` outline) appears in the panel header for 4 s; `role="status"` announces "Ranking updated by voice: 1 Lisbon, 2 Valencia, 3 Montevideo." If the mode is off, the tool first enters it. |
| Voice `compare_cities`  | Overlay                  | Replaces the pin set with the resolved cities (max 4), opens the overlay, VIA VOICE chip on the overlay header; unresolved names are listed in a toast "Could not find: Springfeld" and spoken by the tool.                                                                                                                |
| Voice `show_city_intel` | Scorecard                | Opens the scorecard, flies to the city, VIA VOICE chip on the panel header.                                                                                                                                                                                                                                                |
| Plan empty              | PLAN view                | Profile block and the empty 12-cell timeline ("0/12 months") render; STAYS shows "No stays yet. Open a city in RANK and use ADD TO PLAN." + `.scene-btn` GO TO RANK; rollup hidden (§11.7).                                                                                                                                |
| Plan full (12/12)       | Scorecard, voice         | ADD TO PLAN disabled, `title="Plan is full (12/12). Remove or shorten a stay in PLAN."`; voice add replies the same sentence.                                                                                                                                                                                              |
| Home unset              | Stay cost rows, rollup   | Cost row "set home to compare costs" (link-button focuses `#ci-home`); rollup ANNUAL COST "set home and monthly spend".                                                                                                                                                                                                    |
| Spend unset             | Stay cost rows, rollup   | "×0.62 home · set monthly spend for a dollar estimate"; rollup ANNUAL COST "set monthly spend".                                                                                                                                                                                                                            |
| Stay overlap            | Stay card, voice         | Start/length options that would overlap are `disabled`; a programmatic or voice overlap is refused whole, `.ci-stay-error` "Overlaps Lisbon (NOV–FEB). Shorten or move one of them." under the controls, announced in `#ci-status`; toast for voice "Lisbon MAR–MAY overlaps Valencia (APR–JUN). Nothing was changed."     |
| Seasonality missing     | Stay comfort, timeline   | COMFORT "unavailable"; that stay's timeline cells fill `--ci-neutral` (`title="comfort unavailable"`); rollup COMFORT appends "· 4 months without data".                                                                                                                                                                   |
| Price level missing     | Stay cost row            | "cost data unavailable for this country" (stay or home country lacks `priceLevel`); the $ override input still works and counts as "your figure".                                                                                                                                                                          |
| Trips layer off in PLAN | PLAN header              | `.ci-helper` "Plan arcs hidden (Trips layer off)." + link-button TURN ON (enables the `trips` layer; the mode enabled it on entry, so this only follows a manual toggle).                                                                                                                                                  |
| Voice `plan_lifestyle`  | PLAN view                | Enters the mode if off, switches to PLAN, replaces the plan atomically, VIA VOICE chip on the panel header; `#ci-status` "Plan replaced by voice: Lisbon JAN–APR, Valencia MAY–AUG, Montevideo SEP–DEC. 12 of 12 months."; toast "Plan replaced by voice (3 stays)". Unresolved names or an overlap change nothing.        |

Every toast uses GEV's existing `#toast`. Nothing pulses or animates to signal change.

## 9. Accessibility and responsive

- **Focus rings:** inherit `foundation.css`'s global `:focus-visible` (2px `--text-primary`).
  No `outline: none` anywhere in `city-intel.css`. Rows inside the scroller use
  `outline-offset: -3px` like `.data-toggle-btn` so the ring is not clipped.
- **Keyboard:** the list is `role="list"`; each row is a `<button>` (Enter/Space opens the
  scorecard); the pin and expander are sibling buttons, not nested inside the row button.
  Arrow Up/Down move focus between visible rows (roving `tabindex`, one Tab stop for the
  list); Home/End jump. Sliders are native ranges (arrows, Home/End, PageUp/Down work).
  Preset and view segments are radiogroups with arrow-key movement, copying
  `#detection-allocation-seg`'s behaviour. Escape: closes the compare overlay if open, else
  returns from scorecard to ranking, else falls through to the panel's collapse-on-Escape.
- **Names and live regions:** every icon-only button has `aria-label`. Sliders have visible
  `<label for>` and `<output for>`. One `role="status" aria-live="polite"` region at the top of
  the panel body announces ranking updates (debounced to the slider's `change` event, never
  per `input`), pin changes ("Lisbon pinned, 2 of 4"), and voice-driven changes. The compare
  table has `<caption>` "Comparison of pinned cities" (visually hidden) and `scope` on header
  cells. The best-in-row marker is text ("▲") plus `aria-label`, never colour alone; level
  badges are text; coverage is text.
- **Contrast:** values, names and scores use `--text-primary`. Sources, years and helper
  copy use `--text-secondary`; selected rows switch their line 2 to `--text-primary` at 0.7
  opacity so it never sits on `--accent-dim` at 50%. `--text-dim` is only for ranks, ticks and
  section labels that repeat information shown elsewhere. Ramp colour is never the sole
  carrier: the number is always beside the bar.
- **Reduced motion:** bars and marker sizes have no transition under
  `prefers-reduced-motion: reduce`; otherwise bar width may use `--transition-fast`. Nothing
  else animates.
- **Responsive (respect `responsive.css` breakpoints):** ≤720px the rail is already
  edge-to-edge and scrollable; add `#city-intel-panel` to its 100%-width selector list. The
  row grid drops the coverage column (moves to `title`), the compare overlay becomes a bottom
  sheet (§4), the climate strip wraps to 6×2, and the ATLAS pill shows the icon only
  (label visually hidden, `aria-label` kept). ≤520px nothing further.

## 10. Component boundaries, naming, tokens

**Files** (per SPEC §4):

| File                               | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ui/templates/city-intel.html` | Static shell: `#city-intel-panel` (inside the right rail markup order, before CONTEXT), `#ci-mode-seg`, `#ci-plan-view` (empty mount), `#city-intel-compare`; `#ci-trip` is removed; the `#city-intel-toggle` button is added to `scene-chrome.html`'s `#top-center-actions` instead                                                                                                                                                                     |
| `src/ui/styles/city-intel.css`     | Every `.ci-*` rule including the `.ci-plan-*` / `.ci-stay*` / `.ci-timeline*` / `.ci-rollup*` block (§11.9, no new tokens), the six ramp/neutral tokens, the three advisory tokens, Cyber overrides (only radii and the `.cyber-panel-body` hookup), responsive additions                                                                                                                                                                                |
| `src/layers/cityIntel/panel.js`    | Renders ranking, scorecard and compare into the shell; owns the RANK/PLAN segment and `mode`/`homeCityId`/`monthlySpendUsd`/`overrides` persistence, list state (view mode, expanded countries, selected city, page count), pins, weights UI, passport UI and filters UI; mounts `planView` and routes ADD TO PLAN to it; exposes pure `renderRow`, `renderScorecard`, `renderCompare`, `bestInRow` helpers for node tests                               |
| `src/layers/cityIntel/plan.js`     | Pure (T10, shipped): `monthsOf`, `spanLabel(stay)` → "NOV–FEB · 4 mo", `overlaps(stays, candidate, ignoreId)`, `firstFreeMonth(stays)`, `evenSplit(n)`, `addStay` / `updateStay` / `removeStay` → `{ok, stays, months}` or `{ok:false, error, months}`, `stayMetrics(stay, ctx)`, `rollup(stays, metrics, citiesById)`; every number the PLAN view shows comes from here                                                                                 |
| `src/layers/cityIntel/planView.js` | DOM for `#ci-plan-view` (§11): profile block, timeline, stay cards, rollup; `createPlanView({ doc, store, getCtx, showToast, flyTo, layer, switchMode })` exposing `show()`, `hide()`, `render()`, `addStay(cityId)`, `replacePlan(stays)`; pure `gapRuns(months)`, `timelineModel`, `costCopy`, `visaCopy` for node tests. A sibling, not more `panel.js`: that file is ~1k lines before the scorecard lands, and the plan has its own edit/focus state |
| `src/layers/cityIntel/index.js`    | Cesium markers, labels, hover/selected/pinned styles, pick → `panel.select(cityId)`                                                                                                                                                                                                                                                                                                                                                                      |
| `src/layers/trips/index.js`        | Three guards for `trip.kind === 'plan'`, nothing else: label text `"NOV–FEB LIS"` (span from `MONTH_ABBR` + `n.iata \|\| n.name`) instead of `"1 LIS"`; `tripLegs` appends the last→first leg when `nodes.length > 1` and the `len` sum is 12 (exact: the store never holds overlaps); the CLEAR chip calls `clearTrip`, not `removeTrip`, so the plan trip is never deleted                                                                             |
| `src/travel/tripStore.js`          | T10 shipped `getPlanTrip()`, `ensurePlanTrip()` (not made active) and a start-ordered `addNode` that passes extra fields (`id`, `start`, `len`) through. Still needed: `setNodes(tripId, nodes)`, one commit, used by every stay edit, removal and voice replace                                                                                                                                                                                         |
| `src/ui/cityIntelMode.js`          | Mode enter/exit: layer snapshot and restore, `body.city-intel-mode`, panel collapse choreography, the toggle's `aria-pressed`, toasts. Add a row to `docs/UI-OWNERSHIP.md`                                                                                                                                                                                                                                                                               |
| `src/voice/cityIntelActions.js`    | Calls `mode.enter()`, `panel.setWeights()`, `panel.setPins()`, `panel.select()`; adds the VIA VOICE chip via `panel.markVoice(surface)`                                                                                                                                                                                                                                                                                                                  |

**Class prefix:** `ci-` for everything City Intel owns. Reuse without prefix: `.panel-header`,
`.panel-title`, `.panel-divider`, `.panel-collapse-btn`, `.panel-glow`, `.cyber-panel-body`,
`.scene-btn` (all action buttons), `.panel-layer-toggle` (EXIT), `.pp-mode-seg` /
`.pp-mode-btn` (segments), `.gev-quantitative-slider` / `.gev-slider-value` (sliders),
`.pp-slider-mini-label` (section labels), `.pp-select` (selects). Do not restyle any of them.

**Token mapping:**

| Role                                                           | Token                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Panel surface, border, radius, shadow                          | `--glass-bg`, `--glass-border`, `--panel-radius`, the panel shadow triple from `.global-context-panel-inner` |
| Selected row, lit toggle, pinned star, CITY badge, best-in-row | `--accent`, `--accent-dim`                                                                                   |
| Names, values, scores' numerals                                | `--text-primary`                                                                                             |
| Sources, years, helper copy, country names                     | `--text-secondary`                                                                                           |
| Ranks, ticks, section labels                                   | `--text-dim`                                                                                                 |
| Bars' empty track, row hover                                   | `rgba(255,255,255,.08)` / `rgba(255,255,255,.03)` (the literals `layers.css` already uses)                   |
| Button radius                                                  | `--btn-radius`                                                                                               |
| Mono / sans                                                    | `--font-mono` / `--font-sans`                                                                                |

**New tokens** (nine, all in `city-intel.css`):

| Token                           | Value     | Rationale                                                                                                  |
| ------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| `--ci-score-0` … `--ci-score-4` | §7        | The one thing GEV has no ramp for; five stops keep list, legend and globe identical                        |
| `--ci-neutral`                  | `#8a8f98` | Ineligible / filtered marker ring; deliberately not a theme colour so it reads as "no data" in both themes |
| `--ci-adv-2`                    | `#ffd27a` | Level 2 badge; same literal as `.feed-stale`                                                               |
| `--ci-adv-3`                    | `#ffad72` | Level 3 badge; same literal as `.feed-degraded`                                                            |
| `--ci-adv-4`                    | `#ff8585` | Level 4 badge; same literal as `.feed-unavailable`                                                         |

Advisory badge: mono 8px, 1px outline in the level colour, transparent fill, text "L2";
Level 1 uses `--text-secondary`; unavailable uses `--text-dim` and "—". The three advisory
values reuse GEV's existing degraded-state literals so amber, orange and red already mean
what the eye expects. All user-facing strings are given verbatim in the section that owns
them; there is no separate copy table to drift.

## 11. Lifestyle Plan (PLAN view)

Implements SPEC §3.5. The plan is the single `kind:'plan'` trip in `tripStore` (T10). This
section owns only what the user sees; every number comes from `plan.js` (§10) and the view
never computes one. Same tokens, same `ci-` prefix, no new colours: comfort is tinted through
the score ramp exactly as the scorecard climate strip already is (`--heat-b0..b5` exist only
as a comment in `seasonality.js`, so nothing is defined for them), the comfort word comes from
`COMFORT_LABELS[comfortBin(score)]`, errors reuse `--ci-adv-4`, warnings `--ci-adv-3`.

### 11.1 Entry, persistence, globe

- **Segment.** `#ci-mode-seg` (`.pp-mode-seg` radiogroup, buttons RANK / PLAN, `role="radio"`,
  arrow keys via `stepRadioIndex`, `aria-label="Panel view"`) is the first visible child of
  `.cyber-panel-body`, after `#ci-status` and above the not-advice note. Not in
  `.panel-header`: that strip is shared rail chrome (collapse, EXIT) under Cyber's accordion
  rules. `#city-intel-panel[data-ci-mode="rank|plan"]` mirrors it; legend, weights, passport,
  filters, ranking and scorecard sections carry `.ci-rank-only` and are `display:none` in PLAN,
  `#ci-plan-view` is hidden in RANK. The not-advice note shows in both. Escape never switches
  modes. PLAN does not repeat the sliders: the rail is 330px and weights change rarely once a
  plan exists; it links back instead (§11.2).
- **Persistence.** `mode`, `homeCityId`, `monthlySpendUsd` and `overrides` (`{ stayId: usd }`,
  the exact `ctx` shape `plan.js` takes; pruned when a stay disappears) join
  `gev:city-intel:v1`; default mode `rank`. Overrides stay out of `tripStore` because it has
  no node setter and the panel already owns this blob.
- **Globe.** Entering PLAN calls `store.ensurePlanTrip()`, remembers `activeTripId` and
  `setActive(plan.id)`, so the Trips layer draws the plan unchanged: dashed arcs in the plan's
  trip colour, 9px stops, labels. Leaving PLAN (RANK or mode exit) restores the remembered
  trip when it still exists. Ranking markers keep their composite colours (they are the
  "where next" context for the next stay) but the top-20 ranking labels are dropped
  (`labelIds` = pinned + selected) so stay labels win. Selecting a stay card selects its city
  on the globe (12px white ring, flight ≥ 800 km) like a ranking row. Stay labels
  ("NOV–FEB LIS") and the closing arc at 12/12 are derived by the Trips layer from the plan's
  own nodes (§10): the store has no trip-field setter, so nothing is written back.
- **Trips chips.** FLY flies the plan; CLEAR on the active plan empties its stays (§10 guard).
  PLAN has no CLEAR of its own: per-stay ✕ and voice replace cover it. ADD TO PLAN from RANK
  writes to `plan.id` explicitly, so it works while another trip is active.

### 11.2 Layout

```
│ [RANK][PLAN]                                │
│ Indicative, built from public statistics…   │
│ HOME  [Lisbon, Portugal                  ]  │  ← input + datalist
│       Home: Lisbon · Portugal · PRT         │
│ MONTHLY SPEND  $ [ 3000 ] / mo              │
│       All-in monthly spend at home, USD…    │
│ Fit uses weights BALANCED (5·5·5·5) ·       │
│ passport PRT · edit in RANK                 │
│ YEAR   J  F  M  A  M  J  J  A  S  O  N  D   │
│        ▓▓ ▓▓ ░░ ░░ ▓▓ ▓▓ ▓▓ ▓▓ ░░ ░░ ▓▓ ▓▓  │  ← §11.4, "2" and "1" on first cells
│        8/12 months · gaps MAR–APR, SEP–OCT  │
│ STAYS · 2                                   │
│ ─ gap · MAR–APR · 2 mo ─                    │
│ 1  Valencia · Spain                     ✕   │
│    MAY–AUG · 4 mo   [MAY ▾]  [4 mo ▾]       │
│    FIT      72 ▮▮▮▮▮▮▮▯ · 3/4               │
│    COST     ×0.71 home · ≈ $2,130/mo est.   │
│             $ [ your figure ]               │
│    COMFORT  74 · GOOD                       │
│    SAFETY   86 · FULL · L1                  │
│    VISA     ok · 90 days visa-free          │
│ ─ gap · SEP–OCT · 2 mo ─                    │
│ 2  Lisbon · Portugal                    ✕   │
│    NOV–FEB · 4 mo   [NOV ▾]  [4 mo ▾]       │
│    …                                        │
│ ROLLUP · YEAR                               │
│  MONTHS COVERED   8/12 · gaps MAR–APR, SEP–OCT │
│  FIT · WEIGHTED   73                        │
│  ANNUAL COST      ≈ $16,500 · partial, 8/12 months │
│  COMFORT · WEIGHTED 70 · GOOD               │
│  HIGHEST ADVISORY L1                        │
│  MOVES            2 · 1,020 km · open       │
│  Visa flags are per stay. The Schengen…     │
```

**Profile block** (`.ci-profile`, section label skin):

- **HOME.** `<label for="ci-home">HOME</label>`, `<input id="ci-home" type="search"
list="ci-home-list" autocomplete="off" placeholder="City to compare costs against">`
  (`.pp-select` skin), `<datalist id="ci-home-list">` with one option per pack city, value
  "Lisbon, Portugal" (duplicates get admin1: "Springfield (Illinois), United States"), built
  lazily on first PLAN show so RANK pays nothing. On `change`: exact option value → city id,
  else `searchCities(cities, text, 1)[0]`, so browsers that ignore datalist (iOS Safari) still
  resolve on Enter. Helper `#ci-home-helper`: "Home: Lisbon · Portugal · PRT · price level 0.68
  (2023)"; unresolved: "No city called “X” in the pack." (home unchanged); empty: "Set home to
  compare costs." Native datalist over a custom combobox: keyboard and AT semantics for free.
  No "Set as home" scorecard action: the 2×2 grid is full, and RANK has no text search, so
  scrolling to your own city is slower than typing it.
- **MONTHLY SPEND.** `<input id="ci-spend" type="number" min="0" step="50"
inputmode="numeric">` between a "$" prefix and "/ mo" suffix; helper: "All-in monthly spend
  at home in USD, rent included. Only used to turn ×home ratios into dollar estimates." Blank
  = unset. Persists on `change`.
- **Using line** (`.ci-helper`): "Fit uses weights BALANCED (5·5·5·5) · passport PRT" (or
  "passport not set") + `.ci-link-btn` "edit in RANK" (switches mode, focuses the active preset
  radio). `.ci-link-btn` is the one text-button style (accent, underline, no border) also used
  by "set your passport" in §3; define it once.

### 11.3 Stay cards

`<ol class="ci-stays">` (ordered = ordered by start; T10 sorts) of `<li class="ci-stay">`.
Anatomy, top to bottom:

| Part    | Content / element                                                                                                                                                                                                 | Style                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Head    | index (mono 10px `--text-dim`) · `<button class="ci-stay-title">` "Valencia · Spain" (selects the stay on the globe) · `<button class="ci-stay-remove">` ✕ `aria-label="Remove Valencia (MAY–AUG) from plan"`     | grid `22px 1fr 24px`; selected: `--accent-dim` + 2px `--accent` left border |
| When    | `<output class="ci-stay-when" for="…-start …-len">` "MAY–AUG · 4 mo" · `<select>` start JAN…DEC `aria-label="Start month, Valencia"` · `<select>` length "1 mo"…"12 mo" `aria-label="Length in months, Valencia"` | outputs mono 10px `--text-primary`; selects `.pp-select`, each ≤ 84px       |
| Metrics | `.ci-stay-metric` rows below, grid `56px 1fr`: label mono 8px uppercase `--text-dim`, value mono 11px `--text-primary`                                                                                            | same rhythm as `.ci-metric` line 2                                          |
| Error   | `.ci-stay-error` under the selects, sans 10px `--ci-adv-4`; cleared on the next successful edit of that stay                                                                                                      | see overlap below                                                           |

Native selects, not a month chip strip: keyboard and touch work with zero code, and the
timeline (§11.4) already gives the visual. Options that would overlap another stay are
`disabled` (`overlaps(stays, candidate, stay.id)` per option, 24 checks per card), so the
inline error is only the safety net for programmatic paths; when `updateStay` returns
`error: 'overlap'` the select snaps back and the error names the stay owning `months[0]`.
Every edit goes `updateStay` → `store.setNodes(plan.id, stays)` (one commit); the list
re-sorts and `#ci-status` announces "Valencia moved to JUN–SEP. 8 of 12 months covered."
Removing announces "Valencia removed. 4 of 12 months covered.", drops its override, and moves
focus to the next card's title button, else to GO TO RANK. No reorder controls (order is start).

**Gap rows** (`.ci-gap`, mono 9px `--text-dim`, 1px dashed `--glass-border` top/bottom,
`role="listitem"` inside the same `<ol>`): "— gap · SEP–OCT · 2 mo —". A gap sits between the
stays it separates; the gap that ends at stay 1's start is drawn above stay 1 (it may wrap
through DEC). Gaps are static: ADD TO PLAN from a scorecard fills the first one (§11.6).

**Metric rows, exact copy** (value slot; "—" and `--text-secondary` for unavailable):

| Row     | Copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FIT     | "72" in ramp colour + 48×4 bar + " · 3/4" (`title` = coverage text). Ineligible or all weights 0: "—" + "not ranked" / "set a weight in RANK".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| COST    | Keyed by `cost.basis`. `no-home`: "set home to compare costs" (link-button → `#ci-home`). `ratio-only`: "×0.62 home · set monthly spend for a dollar estimate". `estimate`: "×0.62 home · ≈ $1,850/mo est." with `title="Estimate from country price levels (consumption basket, World Bank 2023); expat costs often differ"` where the year is `ratioYears.stay`; append " · home country year 2022" when `ratioYears.home` differs. `override`: "×0.62 home · $2,000/mo · your figure" + ✕ `aria-label="Clear your figure for Lisbon"` (the "×… home · " prefix is omitted when `ratio` is null). `unavailable`: "cost data unavailable for this country". Ratio always two decimals; dollars `en-US` grouping (`plan.js` already rounds to $10). |
| (input) | `<input type="number" min="0" step="50" inputmode="numeric" placeholder="your figure" aria-label="Your monthly figure for Lisbon, USD">` with "$" prefix; commits on `change`; blank clears. Always present, even when the estimate is unavailable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| (rent)  | US stays only, `.ci-helper`: "Rent ref. $2,140/mo · ZORI Jul 2026 · Zillow · metro · not added (spend includes housing)". Omitted when offline or non-US.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| COMFORT | "74 · GOOD": number in the ramp bin colour of 74, word from `COMFORT_LABELS`; `title="Mean monthly comfort over MAY–AUG · NASA POWER 2001–2020"`. No seasonality row: "unavailable".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| SAFETY  | "86 · FULL · L1": pillar score in ramp colour, coverage word (UNAVAILABLE in `--text-dim`), advisory badge (`.ci-row-advisory[data-level]`, "—" when offline with the §8 title).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| VISA    | Keyed by `visa.status`. `ok` with `allowanceDays`: "ok · 90 days visa-free"; `ok` without (−1 in the source): "ok · no visa needed"; `exceeds`: "stay exceeds visa-free days (90)" in `--ci-adv-3`; `no-passport`: "set your passport" link-button (switches to RANK, focuses `#ci-passport`); `unknown` with `requirement`: "e-visa · days not known" (the raw requirement, lowercase); `unknown` without: "no visa data for this destination"; `offline`: "unavailable (source offline)".                                                                                                                                                                                                                                                         |

### 11.4 Timeline strip: yes

`.ci-timeline` under the profile block, `role="img"`, `aria-label` = "Year: gap JAN–FEB,
Lisbon MAR–MAY, gap JUN–OCT, Valencia NOV–DEC. 7 of 12 months covered." Month initials row
(mono 7px `--text-dim`, `repeat(12, 1fr)`), then 12 cells 14px tall, gap 1px, radius 2px
(Cyber 1px). Cell fill = ramp bin of the owning stay's comfort in that month (the one place the
per-month variation shows, which is the payoff of a seasonal plan); stay without seasonality
→ `--ci-neutral`; gap → track `rgba(255,255,255,.08)` with a 1px dashed `--glass-border`
inset. The first cell of each stay gets a 2px `--text-primary` left border and the stay index
in mono 8px `--text-primary` with `text-shadow: 0 0 2px #000`. Cell `title`: "MAY · Valencia
· comfort 74 GOOD" / "MAR · gap". Caption (`.ci-timeline-caption`, mono 9px
`--text-secondary`): "8/12 months · gaps MAR–APR, SEP–OCT", "12/12 months · loop closed",
"0/12 months". Cells never animate.

### 11.5 Rollup

`.ci-rollup`, section label "ROLLUP · YEAR", rows `.ci-rollup-row` grid `96px 1fr` (label mono
8px uppercase `--text-dim`, value mono 11px `--text-primary`). Hidden while the plan is empty.

| Label              | Value                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MONTHS COVERED     | "8/12 · gaps MAR–APR, SEP–OCT" or "12/12 · no gaps". `rollup.gaps` is a month list; `planView.gapRuns` joins consecutive months into wrap-aware runs (DEC–JAN is one gap)                                                                                                                                                                                                             |
| FIT · WEIGHTED     | `fitMean` "73" in ramp colour, `title="Month-weighted mean of stay fit under the current weights"`; "—" when null                                                                                                                                                                                                                                                                     |
| ANNUAL COST        | `annualCost.complete`: "≈ $27,600 / yr est." (+ " · includes your figures" when any stay's `cost.basis` is `override`), `title` = the §11.3 estimate text with the years used as a range ("World Bank 2021–2023"). Otherwise no dollar figure, per SPEC: "partial, 8/12 months priced"; with 0 priced months: "set home and monthly spend" / "set monthly spend" / "no priced months" |
| COMFORT · WEIGHTED | `comfortMean` "70 · GOOD" (ramp colour + word); append " · 4 months without data" when stays lack seasonality; "—" when null                                                                                                                                                                                                                                                          |
| HIGHEST ADVISORY   | `maxAdvisory` badge "L2"; "—" with the offline title                                                                                                                                                                                                                                                                                                                                  |
| MOVES              | "2 · 1,020 km · open (loop closes at 12/12)" or "3 · 6,840 km · loop closed"; one stay: "0 · 0 km". `rollup.km` is straight great-circle between consecutive stays (plus the closing leg at 12/12); the globe's hub-routed arcs can be longer, so the row `title` says "great-circle, direct"                                                                                         |

Under the rows, `.ci-helper`: "Visa flags are per stay. The Schengen 90/180-day rule across
stays is not checked in v1." The not-advice note is the top `.ci-note`, visible in both views;
it is not repeated.

### 11.6 Add flow (scorecard ADD TO PLAN)

start = `firstFreeMonth(stays)`; len = the largest of 3, 2, 1 for which `overlaps` is empty
(three checks; no new helper). A mid-year gap is exactly where the next stay belongs, and
three months is a quarter and the commonest visa-free allowance. With this rule an
interactive add can never overlap; `addStay` then `store.setNodes(plan.id, stays)`. Success:
toast and `#ci-status` "Added Lisbon to plan: MAR–MAY (3 mo). 7 of 12 months covered."; the
button label stays ADD TO PLAN (a city may appear twice); the §3 "In plan:" helper updates; the
view does not switch to PLAN (the user is often adding several from RANK; the toast names the
view). Full plan: button disabled with the §8 title. The compare overlay gains no add button.

### 11.7 Empty state, voice, errors

- **Empty:** see §8 "Plan empty". GO TO RANK switches mode and focuses the first ranking row.
- **Voice `plan_lifestyle`:** names resolve like `compare_cities`; omitted months →
  `evenSplit(n)` from JAN in the given order (12 mod n leading cities get the extra month). The
  whole plan is validated first and then **replaced** atomically: a spoken plan is a whole-year
  statement, and no undo is the same v1 ceiling as Trips CLEAR. Landing per §8; when months
  were omitted the spoken reply adds "I split the year evenly: 4/4/4 months." (lengths joined
  with "/"). Overlap or an unresolved name: nothing changes, toast and reply per §8.
- **Errors:** overlap, visa offline, seasonality or price level missing, home unresolved: §8
  and §11.3. Blocked storage is already swallowed by `tripStore` (memory only).

### 11.8 Accessibility and ≤720px

Everything in §9 applies. Additions: the segment is a radiogroup with one Tab stop; each card's
title, selects, override input and ✕ are sibling controls (never nested in a button); selects
have `aria-label` and the `<output>` names both; `#ci-status` is the only live region (edit,
remove, add, home set: "Home set to Lisbon, Portugal.", overlap errors, voice). Colour is never
the sole carrier: fit, comfort and safety carry numbers and words, timeline cells carry `title`
and the strip an `aria-label`, disabled options are native. Focus rings inherit, cards use
`outline-offset: -3px` inside the scroller. ≤720px: the rail is already full width; the
timeline stays 12×1 (cells ≥ 24px at 320px), the two selects sit side by side at 50% each, the
`96px` rollup label column becomes `84px`; nothing else changes.

### 11.9 Classes

New: `.ci-mode`, `.ci-rank-only`, `.ci-plan`, `.ci-profile`, `.ci-home-row`, `.ci-spend-row`,
`.ci-link-btn`, `.ci-timeline{,-months,-cell,-cell-gap,-cell-start,-caption}`, `.ci-stays`,
`.ci-stay{,-selected,-head,-title,-remove,-when,-metric,-flag,-error}`, `.ci-gap`,
`.ci-rollup{,-row}`. Reused unchanged: `.pp-mode-seg`, `.pp-select`, `.scene-btn`,
`.ci-section-label`, `.ci-helper`, `.ci-row-advisory`, `.ci-row-bar`, `.ci-list-empty`.
