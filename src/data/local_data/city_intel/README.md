# City Intel data pack

Bundled reference data for the City Intel cockpit (docs/cockpit/SPEC.md §3).
Built by `node scripts/build-city-intel.mjs`, which pins its upstream commit
SHAs / access dates and records sha256 hashes in `source.json`.

| File | Contents |
|---|---|
| `cities.json` | 2480 cities (pop ≥ 150,000): id, name, ISO3, country, admin1, lat/lon, population, capital flag, nearest scheduled-service airport |
| `countries.json` | Per-ISO3 name/region/continent/subregion + World Bank metrics (life expectancy, internet users, PM2.5, price level, homicide rate, political stability) |
| `seasonality.json` | Monthly climate comfort for 2480/2480 cities (v2), from NASA POWER monthly climatology 2001-2020 |

## Rebuild

```
node scripts/build-city-intel.mjs
```

Requires network access; caches raw downloads under `.gev-cache/city-intel-build/`
(gitignored) so re-runs are fast and offline-friendly. NASA POWER climatology is
fetched once per unique rounded (lat,lon) and cached under
`.gev-cache/city-intel-build/power/`; a city is skipped from `seasonality.json`
only if NASA POWER has no data for its coordinates (fill value) or the fetch
fails after retries.

## Licenses / attribution

- Natural Earth (populated places, admin-0 countries, tiny countries) — public domain, "Made with Natural Earth".
- OurAirports — public domain.
- World Bank WDI/WGI indicators and country list — CC BY 4.0, attribution "World Bank".
- Seasonality — NASA POWER monthly climatology (2001-2020, MERRA-2), public data. "These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program."

See `source.json` for exact URLs, pinned commits/access dates and sha256 hashes.
