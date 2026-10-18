# City Intel data pack

Bundled reference data for the City Intel cockpit (docs/cockpit/SPEC.md §3).
Built by `node scripts/build-city-intel.mjs`, which pins Natural Earth and
OurAirports to a commit SHA (immutable raw URLs), and records sha256 hashes
+ download/access dates for GeoNames, the live World Bank and NASA POWER APIs
and Inside Airbnb, in `source.json`.

| File | Contents |
|---|---|
| `cities.json` | 7903 cities as compact rows (`fields` header): id, name, ISO3, admin1, lat/lon, population, capital flag, nearest scheduled-service airport, monthly housing USD (Inside Airbnb or model), origin, GeoNames id. GeoNames population ≥ 50,000, 39 curated lifestyle towns, 1 manual record(s), and every earlier pack id |
| `countries.json` | Per-ISO3 name/region/continent/subregion + World Bank metrics (life expectancy, internet users, PM2.5, price level, homicide rate, political stability) |
| `seasonality.json` | v3: 5875 NASA POWER grid cells × 12 months (comfort score, °C, mm) and a city → cell map covering 7903/7903 cities (2001-2020 climatology) |

The client (`src/layers/cityIntel/source.js`) decodes the rows and cells back into
plain objects on load.

## Rebuild

```
node scripts/build-city-intel.mjs
```

Requires network access; caches raw downloads under `.gev-cache/city-intel-build/`
(gitignored) so re-runs are fast and offline-friendly. The previous
`cities.json` is the id registry: every id it holds survives the rebuild.

## Licenses / attribution

- GeoNames (cities1000, admin1 codes, country info) — CC BY 4.0, "GeoNames (geonames.org)".
- Natural Earth (admin-0 countries, tiny countries; legacy city records) — public domain, "Made with Natural Earth".
- OurAirports — public domain.
- World Bank WDI/WGI indicators and country list — CC BY 4.0, attribution "World Bank".
- Inside Airbnb listings summaries — CC BY 4.0, "Inside Airbnb (insideairbnb.com)".
- Seasonality — NASA POWER monthly climatology (2001-2020, MERRA-2), public data. "These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program."

See `source.json` for exact URLs, pinned commits (Natural Earth, OurAirports),
download/access dates, sha256 hashes, and the housing model's coefficients and fit.
