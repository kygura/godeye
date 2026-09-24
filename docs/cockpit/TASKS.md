# Planetary Cockpit Build Map

**Destination:** Keyless "where to live next" cockpit in GEV. Cities are ranked and
compared on quality of life, cost, safety and travel ease, with honest per-metric
provenance, plus Trips and Travel Mode. See [SPEC.md](SPEC.md) §6 for "done".

Tracker: this file (local-markdown fallback, no issue tracker). Branch
`feat/planetary-cockpit`, fixed point `ce671ce`. Workers never commit; the planner
commits each finished work unit with explicit paths.

Status key: `done`, `running`, `frontier` (open, unblocked, not yet delegated),
`blocked` (waiting on its dependencies).

## Decisions so far

- Resolved the clarifying gate by default: headline use is "where to live next". The
  user was away.
- Named the feature City Intel (layer `city-intel`) because GEV's "Cockpit" is already
  the aircraft cockpit camera. "Planetary cockpit" appears in docs only.
- Took the discussion-agent review (opus) into the spec:
  - City base changed to Natural Earth plus OurAirports (public domain). Meridian's
    worldcities.csv has unknown provenance and is excluded.
  - Country join on ADM0_A3 with overrides. Airports need scheduled service.
  - Seasonality joined by coordinates.
  - GDP excluded. Advisory is a badge and filter, not a score.
  - Zillow rent and climate are excluded from the composite.
  - Country metrics are percentile-ranked once per country.
  - Eligibility requires Safety plus 3 of 4 pillars. Staleness cap of 10 years.
  - Ranking grouped by country by default.
  - Passport and Zillow data are fetched at runtime because their redistribution terms
    are unclear.
- Price level is derived as `PA.NUS.PRVT.PP ÷ PA.NUS.FCRF`, because
  `PA.NUS.PPPC.RF` is no longer served. Verified 2026-09-24.
- T3 done (opus). `createCityIntelIndex({cities,countries}) → {score(weights,{visa}), rank(scored,opts)}`
  - Percentile uses average rank; one value = 50.
  - Airport access = typeFactor × max(0, 1 − km/100), where large = 1 and medium = 0.5;
    no airport = 0 (a fact).
  - Visa ordinal runs from 0 to 5.
  - Metric `status` is ok, missing, stale or no-passport.
  - Re-score plus rank takes about 1.8 ms for 3,000 cities. 11 tests.
- D0 done (fable).
  - The mode is called ATLAS: a `#city-intel-toggle` pill in `#top-center-actions`.
  - Panel `#city-intel-panel` sits in the right rail above CONTEXT. Compare is a 720px
    overlay. Trips is a `<details>` block at the panel's foot.
  - Five-bin Inferno ramp, no country tint.
  - New files: `src/ui/cityIntelMode.js`, `src/layers/cityIntel/panel.js`,
    `src/ui/templates/city-intel.html`, `src/ui/styles/city-intel.css`.
  - Local headless Chrome lacks `libnss3`, `libnspr4` and `libasound2`; fix before the
    smoke test.
- T1 done (sonnet).
  - 2,480 cities (pop ≥ 150k) and 171 countries. 116 of 120 seasonality cities matched.
  - Pack is 602 KB and rebuilds deterministically.
  - Pinned SHAs: NE `ca96624`, OurAirports `44d4715`.
  - ISO3 overrides: SDS→SSD, KOS→XKX, PSX→PSE, SAH→ESH. Manual geo entries for GIB,
    HKG and MAC.
- T4 done (sonnet). Only 87 of 218 advisories carry an ISO3 slug, so the primary path is
  a 126-entry FIPS→ISO3 table validated against geonames; 213 of 218 resolve. 13 tests.
- T2 done (sonnet).
  - Trips token '3'. `style.css` imports `travel.css` before `cyber.css`, which must stay
    last.
  - Reused the Material Symbols subset (12 glyphs added).
  - Seams: `tools.travelMode.openTravelBriefing({name, lat, lon})`, plus
    `tripStore.clearTrip` added.
  - Known cosmetic gaps: `#travel-toggle` is not hidden in cockpit or recording modes, and
    a few ids in `travel.css` are stale.
- Headless Chrome fixed for smoke tests: `LD_LIBRARY_PATH=<scratchpad>/chromelibs/root/usr/lib/x86_64-linux-gnu`
  with `~/.cache/puppeteer/chrome/linux-152.0.7977.75/chrome-linux64/chrome`.
- Shared registry files are owned by T9 so parallel workers can't collide:
  `format-scope.json`, `package.json`, `DATA_SOURCES.md`, `CHANGELOG.md` and
  `CURRENT-STATE.md`.

## Tasks

| ID | Task | Model | Depends on | Write set (summary) | Status |
|---|---|---|---|---|---|
| D0 | Design pass: DESIGN.md (mode, panel, scorecard, compare, globe ramp, states, a11y) | fable | SPEC | `docs/cockpit/DESIGN.md` | done |
| T1 | Data pack builder plus committed pack | sonnet | SPEC | `scripts/build-city-intel.mjs`, `src/data/local_data/city_intel/*`, pack test | done |
| T2 | Port WIP B (Trips) and WIP C (Travel Mode), re-pointed at the city pack; seams `openTravelBriefing`, tripStore API | sonnet | SPEC | `src/travel/*`, `src/layers/trips/*`, travel template/css, registry edits for Trips | done |
| T3 | Scoring model (pure) plus METHODOLOGY.md | opus | SPEC | `src/layers/cityIntel/scoring.js` and test, `docs/cockpit/METHODOLOGY.md` | done |
| T4 | Server provider `/api/city-intel/{advisories,visa,rent,air}` | sonnet | SPEC | `server/providers/cityIntel.js`, `src/data/cityIntelProxy.test.mjs`, `server/providers/local.js` | done |
| T5 | Globe layer `city-intel` (markers by composite, legend hook) plus registration | sonnet | D0, T1, T3 | `src/layers/cityIntel/{index,source}.js`, `src/app/layers/cityIntel.js`, catalog and layerState entries | running |
| T6 | City Intel panel: ranking, weights, filters, passport, scorecard, compare, mode preset, Trips and Travel Mode hooks | sonnet | D0, T2, T3, T4, T5 | `src/layers/cityIntel/panel.js`, template, `city-intel.css`, mode wiring | blocked |
| T7 | Voice tools `rank_cities`, `compare_cities`, `show_city_intel` | sonnet | T6 | `actionSchemas.js`, `toolDescriptions.js`, `src/voice/cityIntelActions.js`, `gevActions.js` hook | blocked |
| T8 | Data credits plus `.env.example` (only if a key appears) | haiku | T1, T4 | `src/data/dataCredits.js`, `DATA_SOURCES.md` (pulled forward from T9) | running |
| T9 | Integration: format-scope adoption, `DATA_SOURCES.md`, `CHANGELOG.md`, `CURRENT-STATE.md`, full format/build/test | haiku→sonnet if failures | T1–T8 | shared files | blocked |
| V | Verification gate: review lenses, checker, ponytail-review, mp-standards-spec-review, design drift, browser smoke | mixed | T9 | fixes delegated | blocked |
