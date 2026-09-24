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
- T11 done (sonnet): seasonality v2 from NASA POWER, 2,480 of 2,480 cities.
  - The builder no longer references the archive. The planner verified this with a clean
    run under a fake `HOME`: byte-identical pack.
  - Pack is 1.77 MB, within the 2.2 MB budget.
- T13 done (sonnet): `plan_lifestyle` plus the `rank_cities` months param (report-only
  comfort). Pins updated surgically.
- F2 done (sonnet).
  - Glass surface, including the Cyber override in `city-intel.css`.
  - Horizon occlusion via `EllipsoidalOccluder`.
  - Fly out to globe view on entry, sequenced after layer restore because
    `SceneDirector.stopScene` cancels flights.
- Planner screenshot review: the ranking list is below the fold at 1440×900. T6b
  compacts the layout with inline slider rows and PASSPORT & FILTERS in a collapsed
  `<details>`. This deviates from DESIGN §2 on purpose.
- Coordinator sweep adopted:
  - (a) Meridian seasonality heatmap calendar folded into T12a as the PLAN timeline, with
    rows per plan city.
  - (b) Trip-leg cost rollup with Google Flights links: follow-up (heuristic cost risks the
    honesty rule).
  - (c) `get_seasonality` is covered by `rank_cities` months and the scorecard;
    `get_flight_estimate` is declined because it is a heuristic cost.
  - (d) Reference docs noted.
  - (3) The 150k cutoff misses nomad towns. Most are not in Natural Earth at all (Tulum,
    Canggu, Ubud, Hoi An, Kotor, Bansko, Ericeira); some are below the cutoff (Boulder
    122k, Asheville 143k, Siem Reap 109k). Follow-up: a GeoNames cities15000 (CC BY 4.0)
    supplement.
  - Voice/search now folds diacritics (T12a).
- T6b and T12a run in parallel with disjoint write sets. The `planView` is injected into
  the panel; T12b (resume T12a) does the integration.
- T12a done (sonnet): `planView.js` with `createPlanView`.
  - Pure helpers: gapRuns, heatmapModel, costCopy, visaCopy, rollupCopy.
  - Seasonality heatmap with rows per plan city.
  - `tripStore.setNodes`, the Trips plan guards, diacritic-folding search, and
    `city-intel-plan.css`.
- T6b done (sonnet).
  - New `scorecard.js`, with the view models tested.
  - Compare overlay with best-in-row; BRIEF ME goes to Travel Mode.
  - RANK/PLAN scaffolding, and PASSPORT & FILTERS in a `<details>`.
  - Fixed a collapsed mode segment and an AQI field mismatch.
- Planner review of the T6b screenshots:
  - The first-run launcher covers everything and has no cockpit entry. Added as T14.
  - The scorecard gets only ~100px under the controls. T12b collapses the controls in
    scorecard view.
  - Top balanced ranking is Bandar Seri Begawan, Ipoh, Varna. That is the honest result
    of country-level percentiles; METHODOLOGY explains why.
- T14 done (sonnet): LIFESTYLE PLANNING launcher tile. The launcher closes when ATLAS is
  entered, and the ATLAS handle is read lazily through `readCityIntel`.
- T9 done (sonnet): CHANGELOG, CURRENT-STATE section (voice-tool count fixed to 34),
  format-scope adoption (18 tests plus the builder), and a README line. The planner fixed
  the stale climate text in METHODOLOGY.
- T12b done (sonnet).
  - planView is mounted in the panel with the `cityIntel.plan` handle; the planner wired
    `tools.js`.
  - Scorecard view collapses the controls.
  - Fixed: collapsed-panel leak over the rail, and ADD TO PLAN doing nothing in a fresh
    session (`ensurePlanTrip`).
- **Verification loop 1**
  - Mechanical checks: build, format and boundaries green; `npm test` 5243/5245.
  - `creditAttribution.test` failed on ported Travel CSS repositioning Cesium credits.
    The planner removed those rules so credits stay in their proven-visible position.
  - Lenses: risk found 1 medium and 2 low; resilience 1 blocker, 1 critical and several
    warnings; reliability 2 critical and several warnings.
  - Fix workers A (mode enter/exit), B (proxy) and C (client and build) dispatched.
  - Accepted as-is: horizon-check cost, air-cache FIFO, and upstream `test.only`.
- Loop 1 fixes committed.
  - A: ATLAS enter rolls back on failure and guards exit-during-enter; honest exit toast.
  - B: proxy refresh isolated from client aborts; failure cooldown; ZORI columns read by
    header; advisory URL scheme check.
  - C: advisory link scheme check in the client; tripStore load sanitised; two test
    gaps closed; upstream commits genuinely pinned; build downloads retried.
- Loop 1 results:
  - Readability: stale T6a/T6b framing, duplicate re-exports, unnamed fly heights.
  - Drift: voice rank announce missing, voice plan toast missing, one copy-case
    mismatch. Also: the Cyber theme's post-process tints marker colours. That is
    accepted: it is upstream scene-wide behaviour, and the list and legend keep true
    colours and numbers.
  - Checker: two FAILs.
    - The ATLAS pill during Travel Mode doesn't exit Travel first.
    - The METHODOLOGY link 404s in the production build.
  - Checker loose ends:
    - No arcs until PLAN is opened; compare view has no Add to plan.
    - Voice chip lost on re-render; voice plan cost fields; even-split lengths.
    - Exit from PLAN leaves the plan as the active trip.
    - PLAN keeps ranking labels (the likely "S P–" overlap).
    - Panel visible outside the mode.
    - Fallback panel has no plan; `setPrefs` doesn't refresh the plan.
    - Air-quality refetched three times.
  - Ponytail: about −550 lines possible. Taken: clearly dead code and duplicates.
    Skipped: the DOM-helper unification, the stay/node rename, extracting compare, and
    visa-string consolidation (churn beats the gain), plus the server→src import
    (boundary rule).
- Loop 2 dispatched: W1 UI, W2 logic/voice/server.
- Loop 2 committed.
  - W2 logic/voice/server: net −297 lines. Dead trip APIs, `cities.js` and duplicate
    helpers removed; one proxy cache; voice plan costs and even-split lengths.
  - W1 UI: all 22 items; METHODOLOGY is now a Vite asset, so it works in the production
    build.
- mp-standards-spec-review (fixed point `ce671ce`, spec SPEC.md):
  - Standards: no hard violations. Judgement calls: `tools.js` toast duplicate (kept,
    since no ShellFeedback is reachable there), the `gevActions` if-chain (upstream
    style) and large factories.
  - Spec: no scope creep; cut list honoured. SPEC aligned: `model.js` folded into
    `scoring.js`/`scorecard.js`; annual cost needs all 12 months.
- Final mechanical gate: `npm test` 5264 tests, 0 fail; build, format:check and
  check:boundaries all green.
- Temp base worktree removed.
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
| T6a | ATLAS mode plus panel ranking view (weights, presets, passport, filters, list, pins, legend, states, persistence), `cityIntel` handle | sonnet | D0, T2–T5 | `cityIntelMode.js`, `panel.js`, template, `city-intel.css`, `tools.js`, rail CSS lists | done |
| T6b | Scorecard, compare overlay, trip block, Brief-me handoff, live air/rent/visa display | sonnet | T6a | `panel.js` (+ a scorecard module), template, CSS | done |
| T7 | Voice tools `rank_cities`, `compare_cities`, `show_city_intel` | sonnet | T6a contract | `actionSchemas.js`, `toolDescriptions.js`, `src/voice/cityIntelActions.js`, `gevActions.js` hook | done |
| T8 | Data credits plus `.env.example` (only if a key appears) | haiku | T1, T4 | `src/data/dataCredits.js`, `DATA_SOURCES.md` (pulled forward from T9) | done |
| D1 | Design addendum §11 PLAN view (plus §3/§5/§8/§10 edits) | fable | SPEC §3.5 | `DESIGN.md` | done |
| T10 | Plan pure model (`plan.js`) plus tripStore `kind:'plan'` | sonnet | SPEC §3.5 | `plan.js` and test, `tripStore.js` and test | done |
| T11 | Seasonality v2 (NASA POWER, all cities), builder archive-free | sonnet | SPEC §3.5 | builder, `seasonality.json`, `source.json`, README, pack test | done |
| T12a/b | PLAN view UI plus "Add to plan" | sonnet | D1, T6b, T10, T11; implements `cityIntel.plan` contract plus `tripStore.setNodes` | `panel.js` or `planView.js`, CSS, template | done |
| T13 | Voice `plan_lifestyle` plus `rank_cities` months param | sonnet | T10, T12 contract | voice files | done |
| F1 | Restore upstream formatting of `scene-chrome.html` and `index.html` (keep semantic edits) | haiku | T6a | those 2 files | done |
| F2 | ATLAS visual fixes: glass surface, horizon occlusion, camera pull-out on entry | sonnet | T6a | `city-intel.css`, `cityIntel/index.js`, `cityIntelMode.js` | done |
| T14 | First-run launcher tile LIFESTYLE PLANNING leading to ATLAS; launcher closes when ATLAS is entered | sonnet | T6a | `firstRunExperience.js`, `welcome.html`, `startupChrome.js`, `tools.js` | done |
| T9 | Integration: format-scope adoption, `DATA_SOURCES.md`, `CHANGELOG.md`, `CURRENT-STATE.md`, full format/build/test | haiku→sonnet if failures | T1–T8 | shared files | done |
| V | Verification gate: review lenses, checker, ponytail-review, mp-standards-spec-review, design drift, browser smoke | mixed | T9 | fixes delegated | running (loop 2) |

## Follow-ups (not in v1)

- Add a GeoNames cities15000 (CC BY 4.0) supplement for small lifestyle towns missing
  from Natural Earth.
- Trip-leg duration and cost rollup, plus keyless Google Flights deep links. Needs an
  honest cost source.
- Schengen 90/180 zone-wide rule.
- Keyed sources: ACLED, OpenAQ, WAQI. Also UK Police, GDACS, INFORM, Eurostat Urban Audit,
  UK Land Registry.
- Keyless Wikipedia/Wikimedia place images for scorecards (Meridian `docs/research-apis.md`).
- Climate comfort in the composite, now that coverage is 100%. Needs a model review.
- Numbeo commercial licence: the only route to global city-level rent and crime data.
