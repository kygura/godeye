# City Intel data pack

Bundled reference data for the City Intel cockpit (docs/cockpit/SPEC.md §3).
Built by `node scripts/build-city-intel.mjs`, which pins its upstream commit
SHAs / access dates and records sha256 hashes in `source.json`.

| File | Contents |
|---|---|
| `cities.json` | 2480 cities (pop ≥ 150,000): id, name, ISO3, country, admin1, lat/lon, population, capital flag, nearest scheduled-service airport |
| `countries.json` | Per-ISO3 name/region/continent/subregion + World Bank metrics (life expectancy, internet users, PM2.5, price level, homicide rate, political stability) |
| `seasonality.json` | Monthly climate comfort for 116 cities, re-keyed from the Meridian/Open-Meteo seed by nearest coordinates |

## Rebuild

```
node scripts/build-city-intel.mjs
```

Requires network access; caches raw downloads under `.gev-cache/city-intel-build/`
(gitignored) so re-runs are fast and offline-friendly.

## Licenses / attribution

- Natural Earth (populated places, admin-0 countries, tiny countries) — public domain, "Made with Natural Earth".
- OurAirports — public domain.
- World Bank WDI/WGI indicators and country list — CC BY 4.0, attribution "World Bank".
- Seasonality — CC BY 4.0, derived from the Open-Meteo Historical Weather API via the archived Meridian project's seed. Meridian's `worldcities.csv` was used only to look up seed-city coordinates at build time and is never redistributed.

See `source.json` for exact URLs, pinned commits/access dates and sha256 hashes.
