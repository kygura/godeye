# Planetary Cockpit: City Intel for God's Eye View

Status: v1 spec, 2026-09-24. Branch `feat/planetary-cockpit`, fixed point `ce671ce`.
Companion docs: [DESIGN.md](DESIGN.md) (interface brief), [TASKS.md](TASKS.md) (build map),
[research/data-sources.md](research/data-sources.md) (source survey).

## 1. What this is

God's Eye View (GEV) is a real-time 3D globe for public spatial data. This build adds a
**planetary intelligence cockpit** for one headline question: **where should I live next?**

The user ranks and compares cities worldwide on four pillars: quality of life, cost
(rent and property where real data exists, otherwise a country price level), safety, and
travel ease. They adjust the pillar weights, see the ranking recolor the globe, open a
per-city scorecard, compare two to four cities side by side, plan trips between them
(Trips), and get a live safety briefing for a destination (Travel Mode). Voice commands
drive the same operations.

It also integrates the ideas from the archived Meridian project: the Trips planner,
great-circle routing, city search and seasonality (climate comfort) come from the
`gev-wip-travel-layer` scaffold. The destination safety briefing comes from the
`gev-wip-travel-ui` scaffold. Meridian's React code and its synthetic "Meridian score" are
not ported.

### Naming

GEV already uses "Cockpit" for the aircraft cockpit camera (`src/ui/cockpitCoordinator.js`,
`cockpit.css`). To avoid a collision, the in-code domain name is **City Intel**:

- Layer id `city-intel`, family directory `src/layers/cityIntel/`.
- Server provider `server/providers/cityIntel.js`, routes under `/api/city-intel/*`.
- Bundled data under `src/data/local_data/city_intel/`.
- The focused view that hides unrelated layers is a mode; DESIGN.md names it.
- "Planetary cockpit" is the product description in docs only.

## 2. Core user flows

1. **Enter the cockpit.** One control switches GEV into the City Intel mode. Unrelated
   layers (aircraft, ships, CCTV, and so on) are hidden for the session and restored on
   exit. They are not deleted or disabled for other users. The City Intel layer and panel
   turn on. Everything works with no API keys.
2. **Rank.** The panel lists cities ordered by composite score. Four weight controls (one
   per pillar) re-rank live. Filters: region/continent, minimum population, minimum data
   coverage. The globe recolors city markers by composite score as weights change.
3. **Inspect.** Clicking a city (globe marker or list row) opens its scorecard. Each
   metric shows its value, unit, year, source, and whether it is city-level or a
   country-level proxy. Missing metrics are shown as missing, not hidden.
4. **Compare.** The user pins two to four cities and opens a side-by-side view with
   per-pillar and per-metric rows, the best value in each row marked.
5. **Plan.** From a scorecard or comparison, "Add to trip" appends the city to the active
   Trip (Trips layer: great-circle arcs, fly-through, seasonality window).
6. **Brief.** "Brief me" opens Travel Mode for that city: live quakes, cyclones, fires,
   weather and nearby help points from GEV's existing live sources.
7. **Voice.** With an OpenAI key present, the user can say things like "compare Lisbon and
   Valencia", "show me the safest affordable cities in Asia", or "what's it like to live
   in Montevideo". The tools report only what actually happened.
8. **Home passport.** The user may set a home passport in the panel. Visa requirements
   only count toward travel ease once it is set. Until then that metric reads
   "set your passport", never a guess.
9. **Advisory filter.** US State Dept advisory levels show as a badge per country. A
   filter hides Level 3–4 destinations.

## 3. Data

### 3.1 Principles (non-negotiable)

- **No fabricated numbers.** Every metric value comes from a named source and carries
  `{ value, unit, year, source, level: 'city' | 'country', coverage }`.
- **No interpolation.** A city with no rent data shows rent as unavailable. It does not
  get a regional average presented as its own figure.
- **Country proxies are labelled.** A country-level value applied to a city is labelled
  "country-level" wherever it is displayed.
- **Redistribution rules.** Bundle only public-domain, CC BY, OGL or MIT data (with
  attribution in `DATA_SOURCES.md` and the pack's `source.json`). Anything with unclear
  or restrictive terms is fetched at runtime through a server proxy and cached locally
  under `.gev-cache/`, never committed.
- **Skipped on licence grounds:** Numbeo, Inside Airbnb, idealista, RentCast bulk. They
  are listed in the final report as the route to global city-level rent and crime data,
  and are not scraped.

### 3.2 Bundled pack: `src/data/local_data/city_intel/`

Built by `scripts/build-city-intel.mjs`. The script uses the network at build time, pins
its source versions (a commit SHA or download date plus a sha256 recorded in
`source.json`), produces deterministic output, commits the results and can be re-run. The
browser loads the pack with the existing `src/data/bundledJson.js` pattern. The directory
carries `source.json` (provenance, URLs, licences, download date, sha256) and a short
`README.md`, following `local_data/telegeography_submarine_cables/`. The whole pack must
stay under 1.5 MB uncompressed; the builder prints the size.

| File | Contents | Source (licence) |
|---|---|---|
| `cities.json` | Cities with `pop_max` of at least ~150k (the builder reports the final count): id, name, ISO3, country, admin1, lat, lon, population, capital flag, nearest scheduled-service airport (IATA, distance, airport type) | Natural Earth 10m populated places (public domain); OurAirports (public domain) |
| `countries.json` | Per ISO3: name, region, and metrics, each with value and year; indicator metadata (label, unit, source, URL, licence, direction, derived flag) | World Bank WDI and WGI API (CC BY 4.0) |
| `seasonality.json` | Monthly climate comfort (0 to 100), temperature and precipitation for the ~120 cities Meridian seeded, re-keyed to City Intel ids by nearest coordinates (within 25 km) rather than by name | Meridian seed, derived from the Open-Meteo historical archive (CC BY 4.0) |

Build rules:

- **Country join.** Join cities to countries on Natural Earth `ADM0_A3`, not `ISO_A2`,
  which is `-99` for France, Norway, Kosovo and others. Keep an explicit override map. A
  test asserts that every city resolves to a country record, even one with no metrics.
- **Airports.** Only `large_airport` or `medium_airport` with `scheduled_service=yes`
  counts. OurAirports has no passenger counts, so the UI calls this "airport type", never
  "hub size".
- **Staleness.** Each metric stores the year of its latest non-null value. Values more
  than 10 years older than the build year are dropped as unavailable.

Country indicators for v1:

| Key | Indicator | Pillar |
|---|---|---|
| `lifeExpectancy` | `SP.DYN.LE00.IN` life expectancy at birth | Quality of life |
| `internetUsers` | `IT.NET.USER.ZS` internet users, % of population | Quality of life |
| `pm25` | `EN.ATM.PM25.MC.M3` mean annual PM2.5 exposure (lower is better) | Quality of life |
| `priceLevel` | Derived: `PA.NUS.PRVT.PP` ÷ `PA.NUS.FCRF`, consumer price level relative to the US (US = 1.0; lower is cheaper) | Cost |
| `homicideRate` | `VC.IHR.PSRC.P5` intentional homicides per 100k (lower is better) | Safety |
| `politicalStability` | `GOV_WGI_PV.EST` (WGI source 3) political stability and absence of violence | Safety |

GDP per capita is deliberately excluded. It measures wealth, not quality, and it
correlates strongly with the price level, so it would count wealth in two pillars. The
derived `priceLevel` is labelled as derived in the UI and in `source.json`.

The Meridian `worldcities.csv` and the WIP's `public/data/travel/cities.json` are **not**
used because their provenance is unknown, and they must never be committed. Trips city
search moves to `cities.json` above, so the app has one city dataset.

### 3.3 Live data (server proxies, keyless, cached)

Following the `server/providers/firms.js` pattern (memory cache, single-flight, disk cache
under `.gev-cache/`, serve-stale on upstream failure, never log keyed URLs):

| Route | Upstream | Cache | Feeds |
|---|---|---|---|
| `GET /api/city-intel/advisories` | US State Dept `cadataapi.state.gov/api/TravelAdvisories` (US public domain): all countries in one call, normalised to `{ ISO → { level 1..4, updated, url } }` | 6 h | Advisory badge and "hide Level 3–4" filter; Travel Mode |
| `GET /api/city-intel/visa?passport=ISO3` | ilyankou/passport-index-dataset tidy ISO3 CSV (repo MIT, but scraped from passportindex.org, so upstream data terms are unclear). Fetched at runtime and not bundled; the commit date is reported as its "year" | 7 days | Travel ease (visa access), only once a passport is set |
| `GET /api/city-intel/rent` | Zillow Research ZORI metro CSV (free with attribution, terms unclear for redistribution). Fetched at runtime and not bundled. Latest month per metro, matched to US cities in the pack | 7 days | Scorecard and compare only, city level, US only; never in the global composite |
| `GET /api/city-intel/air?lat&lon` | Open-Meteo air quality API (CC BY 4.0, free tier non-commercial), current PM2.5 and European AQI | 1 h | Scorecard only (live reading, not ranked) |

Every proxy returns `{ ok, data, fetchedAt, stale, source }` and validates its query
parameters (ISO3 pattern, lat/lon ranges). If an upstream is down, the dependent element
degrades visibly to "unavailable (source offline)" and the rest of the cockpit keeps
working. Open-Meteo, Zillow, World Bank, Natural Earth, OurAirports, the US State Dept
and passport-index are credited in GEV's existing data-credits surface
(`src/data/dataCredits.js`) and in `DATA_SOURCES.md`.

### 3.4 Pillars and scoring

The scoring task (TASKS.md) owns the model design and its tests, and writes the plain
methodology to `docs/cockpit/METHODOLOGY.md`. These are the constraints it must satisfy:

- **Composite pillars and metrics:**
  - Quality of life: `lifeExpectancy`, `internetUsers`, `pm25` (country level).
  - Cost: `priceLevel` (country level). Zillow city rent is detail only, because it
    cannot share a scale with global country proxies.
  - Safety: `homicideRate`, `politicalStability` (country level).
  - Travel ease: nearest scheduled airport type and distance (city level), plus visa
    access for the chosen passport (country level, only once a passport is set).
- **Excluded from the composite, shown in the scorecard:**
  - Climate comfort covers only ~120 cities, so it would make QoL inconsistent. It
    appears in the scorecard and Trips seasonality.
  - Live air quality.
  - Zillow rent.
  - The advisory level is a badge and a filter, not a score. It largely re-states the
    homicide and WGI data, it ties heavily across only 4 levels, and US cities have no
    US advisory.
- **Normalisation:** each metric maps to 0 to 100 by percentile rank, direction-aware,
  with a defined tie rule (average rank). Country-level metrics are ranked once across
  countries, then copied to their cities, so large countries do not skew the
  distribution. City-level metrics are ranked across cities. Raw values are always shown
  next to normalised ones.
- **Pillar score:** mean of the pillar's available metrics. Pillar coverage is `full`
  (all metrics present), `partial` (some present) or `unavailable` (none present).
- **Composite:** weighted mean over *available* pillars only, with the user's weights
  renormalised across them. It always travels with a coverage summary, for example
  "3 of 4 pillars · 1 city-level metric".
- **Ranking eligibility:** missing data is not random. Homicide gaps cluster in unstable
  countries, so renormalising would reward missingness. A city is therefore ranked only
  when **Safety is available and at least 3 of 4 pillars are available**. Ineligible
  cities still appear on the globe in a neutral "insufficient data" style and in the
  scorecard, with the reason.
- **Ties from country-level data:** most metrics are national, so cities in one country
  score almost identically. The ranking defaults to **grouping by country** (best city
  first, others expandable), with a toggle for a flat city list. DESIGN.md settles the
  presentation. City-level differentiators are named explicitly.
- **Determinism:** pure functions, no DOM, no network. The same inputs always give the
  same scores. Unit tests cover percentile ties, direction, weight renormalisation, the
  eligibility cutoff, staleness handling and missing pillars.
- **Not advice.** The panel carries a one-line "Indicative, built from public statistics;
  mostly country-level; not relocation advice" note, linking to METHODOLOGY.md.

## 4. Components and file map

Additive modules following GEV's own patterns (CONTRIBUTING.md, docs/CODE-BOUNDARIES.md,
docs/UI-OWNERSHIP.md). Upstream features are not rewritten.

| Area | Files |
|---|---|
| Data build | `scripts/build-city-intel.mjs`, `src/data/local_data/city_intel/*` |
| Pure logic | `src/layers/cityIntel/scoring.js` (pillars, normalisation, composite, ranking), `model.js` (metric records, formatting helpers), `source.js` (pack loader and live fetch client); `docs/cockpit/METHODOLOGY.md` |
| Globe layer | `src/layers/cityIntel/index.js` (layer contract `init/enable/disable/update/destroy/getStats`; markers coloured by composite), `src/app/layers/cityIntel.js`, entries in `constructCatalog.js` and `layerState.js` |
| Panel UI | `src/layers/cityIntel/panel.js` (ranking, weights, filters, scorecard, compare), a template, and `src/ui/styles/city-intel.css` built on `foundation.css` tokens and respecting the Cyber HUD overlay |
| Mode | A preset that hides unrelated layers and restores them on exit; DESIGN.md sets the entry point |
| Server | `server/providers/cityIntel.js` registered in `server/providers/local.js` |
| Trips (port) | `src/travel/{geo,seasonality,citySearch,cities,tripColors,tripStore}.js`, `src/layers/trips/index.js`, `src/app/layers/trips.js`; cities come from the City Intel pack |
| Travel Mode (port) | `src/travel/{briefing,controller}.js`, `src/ui/templates/travel.html`, `src/ui/styles/travel.css`, plus the WIP's small wiring edits |
| Voice | Schemas in `src/voice/actionSchemas.js`, descriptions in `server/providers/openai/toolDescriptions.js`, and handlers in a new `src/voice/cityIntelActions.js` that `gevActions.js` delegates to |
| Docs | `DATA_SOURCES.md`, `docs/CURRENT-STATE.md`, `CHANGELOG.md`, and `.env.example` if any optional key is added |

### Voice tools (v1)

- `rank_cities { region?, weights?, limit? }`: re-ranks, updates the panel and globe, and
  returns the top N with their coverage.
- `compare_cities { cities: string[2..4] }`: resolves names to pack ids, opens the
  compare view, and returns per-pillar scores. Ambiguous names (San José, Springfield)
  are resolved by population and country hints and reported. Unresolved names are said
  out loud.
- `show_city_intel { city }`: opens the scorecard, flies to the city, and returns the
  headline metrics with sources.

All three tool responses include the coverage caveat, for example "mostly country-level
data".

## 5. Out of scope for v1

- Booking of flights or stays (the Meridian Duffel pipeline).
- Keyed sources: ACLED, OpenAQ, WAQI.
- Other sources deferred to later: UK Police, GDACS, INFORM, Eurostat Urban Audit, UK
  Land Registry, FX conversion.
- Neighbourhood-level analysis, user accounts, and server-persisted shortlists. Pins and
  weights persist in `localStorage` only.

## 6. Done means

1. `npm run dev`, then open `http://localhost:4173`. With no keys, entering City Intel mode
   shows coloured city markers on the globe and a ranked list. Moving a weight control
   re-ranks the list and recolours the globe.
2. Clicking a city opens a scorecard where every metric shows its source, year and level.
   Missing data is visibly marked.
3. Pinning two to four cities opens the compare view.
4. "Add to trip" draws the Trip arcs. "Brief me" opens Travel Mode for the city.
5. Leaving the mode restores the previous layer set.
6. The voice tools are registered and unit-tested; live voice needs `OPENAI_API_KEY`.
7. `npm run build`, `npm run format:check`, `npm run check:boundaries` and `npm test` are
   all green. New modules have node:test coverage, including the scoring edge cases in
   §3.4.
8. With the advisory upstream unreachable, the cockpit still ranks and shows the advisory
   badge as unavailable.
9. A headless browser smoke test shows the cockpit rendering with no console errors from
   the new code.
10. `METHODOLOGY.md` exists, and the panel links it with the not-advice note.
11. `DATA_SOURCES.md` lists every new source with its licence and attribution.
