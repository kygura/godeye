/**
 * @file City search + seasonality over the City Intel bundled pack.
 *
 * Trips used to ship its own `public/data/travel/{cities,seasonality}.json`
 * (Meridian-derived, unknown provenance). That pack is retired: Trips now
 * reads the same `src/data/local_data/city_intel/` pack the City Intel layer
 * uses, so the app has one city dataset. Loaded lazily and module-cached
 * through `loadBundledJson`/`createRetryableLoader`, the same pattern as
 * `src/data/naturalEarthRegions.js`.
 *
 * Schema (see `scripts/build-city-intel.mjs` / docs/cockpit/SPEC.md §3.2):
 *   cities.json: { version, generatedAt, count, cities: [{ id, name, iso3,
 *     country, admin1, lat, lon, pop, capital, airport: {iata, km, type} | null }] }
 *   seasonality.json: { version, window, source, license,
 *     cities: { [cityId]: { matchedKm, months: [{score,tempC,precipMm}×12] } } }
 *
 * @module travel/cities
 */
import { loadBundledJson } from '../data/bundledJson.js';
import { createRetryableLoader } from '../data/retryableLoad.js';
import { searchCities } from './citySearch.js';

const PACKS = {
  cities: {
    url: new URL('../data/local_data/city_intel/cities.json', import.meta.url),
    importJson: () =>
      import('../data/local_data/city_intel/cities.json', {
        with: { type: 'json' },
      }),
  },
  seasonality: {
    url: new URL(
      '../data/local_data/city_intel/seasonality.json',
      import.meta.url,
    ),
    importJson: () =>
      import('../data/local_data/city_intel/seasonality.json', {
        with: { type: 'json' },
      }),
  },
};

const loadCitiesPack = createRetryableLoader(() =>
  loadBundledJson(PACKS.cities.url, PACKS.cities.importJson),
);
const loadSeasonalityPack = createRetryableLoader(() =>
  loadBundledJson(PACKS.seasonality.url, PACKS.seasonality.importJson),
);

/** @returns {Promise<Array>} The pack's city records (empty when unset). */
export async function loadCities() {
  return (await loadCitiesPack())?.cities || [];
}

/**
 * @param {string} query
 * @param {number} [limit]
 * @returns {Promise<Array>}
 */
export async function findCities(query, limit = 8) {
  return searchCities(await loadCities(), query, limit);
}

/**
 * 12 months of `{score,tempC,precipMm}`, or null when the city has no
 * seasonality entry (most of the pack — it only covers Meridian's seed set).
 * @param {string} cityId
 * @returns {Promise<Array|null>}
 */
export async function citySeasonality(cityId) {
  const pack = await loadSeasonalityPack();
  return pack?.cities?.[cityId]?.months || null;
}
