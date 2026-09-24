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
- Shared registry files are owned by T9 so parallel workers can't collide:
  `format-scope.json`, `package.json`, `DATA_SOURCES.md`, `CHANGELOG.md` and
  `CURRENT-STATE.md`.

## Tasks

| ID | Task | Model | Depends on | Write set (summary) | Status |
|---|---|---|---|---|---|
| D0 | Design pass: DESIGN.md (mode, panel, scorecard, compare, globe ramp, states, a11y) | fable | SPEC | `docs/cockpit/DESIGN.md` | running |
| T1 | Data pack builder plus committed pack | sonnet | SPEC | `scripts/build-city-intel.mjs`, `src/data/local_data/city_intel/*`, pack test | running |
| T2 | Port WIP B (Trips) and WIP C (Travel Mode), re-pointed at the city pack; seams `openTravelBriefing`, tripStore API | sonnet | SPEC | `src/travel/*`, `src/layers/trips/*`, travel template/css, registry edits for Trips | running |
| T3 | Scoring model (pure) plus METHODOLOGY.md | opus | SPEC | `src/layers/cityIntel/scoring.js` and test, `docs/cockpit/METHODOLOGY.md` | running |
| T4 | Server provider `/api/city-intel/{advisories,visa,rent,air}` | sonnet | SPEC | `server/providers/cityIntel.js` and test, `server/providers/local.js` | frontier |
| T5 | Globe layer `city-intel` (markers by composite, legend hook) plus registration | sonnet | D0, T1, T3 | `src/layers/cityIntel/{index,source}.js`, `src/app/layers/cityIntel.js`, catalog and layerState entries | blocked |
| T6 | City Intel panel: ranking, weights, filters, passport, scorecard, compare, mode preset, Trips and Travel Mode hooks | sonnet | D0, T2, T3, T4, T5 | `src/layers/cityIntel/panel.js`, template, `city-intel.css`, mode wiring | blocked |
| T7 | Voice tools `rank_cities`, `compare_cities`, `show_city_intel` | sonnet | T6 | `actionSchemas.js`, `toolDescriptions.js`, `src/voice/cityIntelActions.js`, `gevActions.js` hook | blocked |
| T8 | Data credits plus `.env.example` (only if a key appears) | haiku | T1, T4 | `src/data/dataCredits.js` | blocked |
| T9 | Integration: format-scope adoption, `DATA_SOURCES.md`, `CHANGELOG.md`, `CURRENT-STATE.md`, full format/build/test | haiku→sonnet if failures | T1–T8 | shared files | blocked |
| V | Verification gate: review lenses, checker, ponytail-review, mp-standards-spec-review, design drift, browser smoke | mixed | T9 | fixes delegated | blocked |
