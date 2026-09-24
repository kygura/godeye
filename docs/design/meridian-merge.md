# Meridian merge: God's Eye View as a sovereign travel-intelligence globe

Status: design + Phase 1 scope. 2026-09-24.

## Thesis

God's Eye View (GEV) stays the surviving codebase. Meridian's real assets are
ported into GEV's existing contracts (layer object, rail card blocks, voice
action schemas, localStorage persistence, Vite middleware routes). Nothing in
GEV's shell is rewritten. Meridian's synthetic scoring is NOT ported.

Sovereign means: every travel feature works keyless and offline-first from
committed data; no account, no server-side user data, no third-party booking
required. Estimates are labeled estimates. Bookings stay out of scope.

## What ports (from ~/projects/_archive/meridian)

| Asset | Form in GEV | Notes |
| --- | --- | --- |
| worldcities.csv (4,660) + airports.json (3,274) + capitals.json | `public/data/travel/cities.json` (built once by `scripts/build-travel-cities.mjs`) | city id = slugify(city-country); airport match rule copied |
| seasonality.json (120 cities, Open-Meteo 2015-2024) | `public/data/travel/seasonality.json` | extendable by the existing meridian script |
| comfortScore / comfortBin / bestWindow | `src/travel/seasonality.js` | pure, tested |
| haversine / greatCirclePoints / flightPath / estimateFlightHours / estimateLegCostUSD | `src/travel/geo.js` | pure, tested |
| searchCities ranking | `src/travel/citySearch.js` | pure, tested |
| Trip / TripNode / Shortlist | `src/travel/tripStore.js` localStorage `gev:travel:v1` | one JSON blob, same pattern as scenes |
| Command palette (Cmd/Ctrl+K) | `src/ui/commandPalette.js` | THE ergonomic change. One box: places, cities, layers, panels, voice ask |
| Agent tools search_places / get_seasonality / get_flight_estimate | new entries in `src/voice/actionSchemas.js` + runner in `gevActions.js` | the realtime agent already owns fly/route/layers |

Not ported: MeridianScore, metric surfaces, conflict/disaster mock arrays,
booking pipeline, news ticker (GEV has regional-brief), React/Zustand/Tailwind.

## Ergonomics redesign (shell-level, no re-skin)

1. **Command palette** replaces "find the search box in the collapsed tray".
   Ctrl/Cmd+K anywhere. Rows: coordinates, presets, cities (local, instant),
   geocoder (debounced 160 ms), layer toggles, panel open/close, "Ask: ..."
   which hands the text to the voice agent as a text turn. Arrow/Enter/Esc.
2. **Left = act, right = inspect.** Travel panel joins the left rail
   (#left-panel-stack) next to Data/CCTV/Scenes. Selecting a city fills a
   right-rail Travel card (seasonality strip, best window, distance from
   previous trip node) using rail card blocks.
3. **Shortcuts:** `[` toggles left rail, `]` toggles right rail, `T` opens
   Travel. Existing keys unchanged.
4. **Tokens:** add semantic tokens to foundation.css (--ink*, --paper,
   --good, --warn, --hazard, --heat-b0..b5, --route). New code uses only
   tokens. Existing 1,033 literals are left alone (separate cleanup).

## Globe integration

`src/layers/trips/index.js` implements the layer contract: draws the active
trip as great-circle polylines (hub-routed over 14,800 km) with node pins,
color from a 12-color palette. Row controls: FLY (cameraVerbs.flyRoute over
the nodes), CLEAR. Toggle comes free from registration.

## Phases

- **Phase 1 (now):** data build, pure modules + tests, tripStore, trips layer,
  travel panel + right card, command palette, voice tools, tokens.
- **Phase 2:** seasonality calendar view (rows = shortlist + trip cities),
  on-demand Open-Meteo extension via a Vite middleware route with disk cache.
- **Phase 3:** draw mode (click snaps to nearest airport city, appends node),
  offline export/import of trips (JSON, like scenes).

## Out of scope, permanently

Duffel/booking, passenger PII, server-side user data, synthetic scores
labeled as sourced.
