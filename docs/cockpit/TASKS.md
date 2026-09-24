# Planetary Cockpit Build Map

**Destination:** Keyless lifestyle-planning cockpit in GEV: ATLAS city ranking with honest
provenance, plus a Lifestyle Plan of stays (city + months) with fit, cost, safety,
seasonality and yearly rollups on the Trips arcs. Plus Travel Mode. See [SPEC.md](SPEC.md) §6 for "done".

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
- T8 done (haiku), with factual fixes by the planner (country count 171, air-quality
  fields, admin-0 use, skip reasons). Credit keys are `city-intel-*`.
- T5 done (sonnet).
  - Layer token '4', in the Infrastructure group; Trips moved directly after it.
  - Pick via a layer-owned handler plus `pickRegistry` (the bikeshare pattern).
  - `src/travel/cities.js` now delegates to `layers/cityIntel/source.js`, so there is one
    pack loader.
  - Zillow rent matching is exact name only (`ponytail:` noted).
- Planner override of DESIGN §2: the Region filter uses the pack's continents, not World
  Bank regions, to match `rank({continent})` and voice queries.
- T6 split into T6a (mode plus ranking view) and T6b (scorecard, compare, trip, handoff).
  T7 runs in parallel with T6a against a fixed `cityIntel` handle contract, which is
  passed to `initGevVoiceCommands({...,cityIntel})` from `tools.js`.
- T7 done (sonnet). Voice tools are `rank_cities`, `compare_cities` and
  `show_city_intel`.
  - Compare disambiguates by majority continent, so Lisbon + Valencia resolves to Spain.
  - The planner re-pinned the tool-payload digest. The planner also reverted T7's Prettier
    reformat of `radioMarkup.test.mjs`, which is not in format scope.
- Found: T2 Prettier-reformatted `scene-chrome.html` and `index.html` (not in format
  scope). They need restoring to upstream formatting with only the semantic edits kept;
  queued for after T6a. T6a restored its own `context.html` reformat.
- **User clarification (via coordinator): the core use is lifestyle planning and
  formation.** SPEC §1 is reframed and §3.5 Lifestyle Plan added. The opus discussion
  cuts were adopted:
  - Stays are `start/len` and may wrap. The plan is a `kind:'plan'` trip in `tripStore`.
  - Cost shows ×home first, then a $ estimate, plus a manual override. Rent is info-only.
  - Visa-days flag.
  - Cut: the TRIP block, the safety floor, month auto-assign and the runtime climate
    route.
  - Seasonality v2 comes from NASA POWER for all cities, which drops the Meridian seed and
    the archive dependency.
- Haiku carry-forward builder change (`GEV_MERIDIAN_DATA`) is superseded by T11 and not
  committed separately.
- T6a done (sonnet): ATLAS mode plus ranking view, committed.
  - Fixed a latent bug: `update()` returned false in the city-intel and trips layers, which
    made them impossible to enable.
  - Browser check: 2,455 eligible cities, zero console errors.
  - Planner screenshot review found three issues, queued as F2: the panel has no glass
    surface; markers render through the globe; the camera is not pulled out on entry.
- T10 done (sonnet): `plan.js` (monthsOf, spanLabel, overlaps, firstFreeMonth, evenSplit,
  add/remove/updateStay, stayMetrics, rollup). tripStore got `getPlanTrip`,
  `ensurePlanTrip` and a field-preserving, start-ordered `addNode`.
- D1 done (fable): DESIGN §11 PLAN view.
  - RANK/PLAN segment `#ci-mode-seg`; home picker is a search input with a datalist.
  - Stay cards use start/length selects; there is a 12-cell comfort timeline.
  - Code goes in a new `planView.js`.
  - Needs `tripStore.setNodes(tripId, nodes)`, assigned to T12.
- F1 done (haiku): templates restored to upstream formatting (11+/1− vs `ce671ce`).
- Regressions found against the base worktree and fixed:
  - `loadingFeedback.test`: fixed by F1.
  - `firstRunExperience` schema pin: the new tools are excluded from the legacy pin, the
    same way `set_cyber_sonar` is.
- API session rate limit (429) killed the planner and F2 mid-run. Resumed with ≤3
  concurrent children. F2 re-dispatched.
- T13 dispatched early against a fixed `cityIntel.plan` contract: `ready`, `show`,
  `getStays`, `replaceStays`, `getSummary`. `markVoice` gains `'plan'`.
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
| T5 | Globe layer `city-intel` (markers by composite, legend hook) plus registration | sonnet | D0, T1, T3 | `src/layers/cityIntel/{index,source}.js`, `src/app/layers/cityIntel.js`, catalog and layerState entries | done |
| T6a | ATLAS mode plus panel ranking view (weights, presets, passport, filters, list, pins, legend, states, persistence), `cityIntel` handle | sonnet | D0, T2–T5 | `cityIntelMode.js`, `panel.js`, template, `city-intel.css`, `tools.js`, rail CSS lists | running |
| T6b | Scorecard, compare overlay, trip block, Brief-me handoff, live air/rent/visa display | sonnet | T6a | `panel.js` (+ a scorecard module), template, CSS | blocked |
| T7 | Voice tools `rank_cities`, `compare_cities`, `show_city_intel` | sonnet | T6a contract | `actionSchemas.js`, `toolDescriptions.js`, `src/voice/cityIntelActions.js`, `gevActions.js` hook | done |
| T8 | Data credits plus `.env.example` (only if a key appears) | haiku | T1, T4 | `src/data/dataCredits.js`, `DATA_SOURCES.md` (pulled forward from T9) | done |
| D1 | Design addendum §11 PLAN view (plus §3/§5/§8/§10 edits) | fable | SPEC §3.5 | `DESIGN.md` | done |
| T10 | Plan pure model (`plan.js`) plus tripStore `kind:'plan'` | sonnet | SPEC §3.5 | `plan.js` and test, `tripStore.js` and test | done |
| T11 | Seasonality v2 (NASA POWER, all cities), builder archive-free | sonnet | SPEC §3.5 | builder, `seasonality.json`, `source.json`, README, pack test | running |
| T12 | PLAN view UI plus "Add to plan" | sonnet | D1, T6b, T10, T11; implements `cityIntel.plan` contract plus `tripStore.setNodes` | `panel.js` or `planView.js`, CSS, template | blocked |
| T13 | Voice `plan_lifestyle` plus `rank_cities` months param | sonnet | T10, T12 contract | voice files | running |
| F1 | Restore upstream formatting of `scene-chrome.html` and `index.html` (keep semantic edits) | haiku | T6a | those 2 files | done |
| F2 | ATLAS visual fixes: glass surface, horizon occlusion, camera pull-out on entry | sonnet | T6a | `city-intel.css`, `cityIntel/index.js`, `cityIntelMode.js` | running |
| T9 | Integration: format-scope adoption, `DATA_SOURCES.md`, `CHANGELOG.md`, `CURRENT-STATE.md`, full format/build/test | haiku→sonnet if failures | T1–T8 | shared files | blocked |
| V | Verification gate: review lenses, checker, ponytail-review, mp-standards-spec-review, design drift, browser smoke | mixed | T9 | fixes delegated | blocked |
