/**
 * @file City search + seasonality over the City Intel bundled pack.
 *
 * Trips used to ship its own `public/data/travel/{cities,seasonality}.json`
 * (Meridian-derived, unknown provenance). That pack is retired: Trips now
 * reads the same `src/data/local_data/city_intel/` pack the City Intel layer
 * uses, so the app has one city dataset — loaded once through
 * `layers/cityIntel/source.js`'s `loadCityIntelPack`, the single pack loader,
 * rather than a second independent fetch/cache of the same JSON files.
 *
 * Schema (see `scripts/build-city-intel.mjs` / docs/cockpit/SPEC.md §3.2):
 *   cities.json: { version, generatedAt, count, cities: [{ id, name, iso3,
 *     country, admin1, lat, lon, pop, capital, airport: {iata, km, type} | null }] }
 *   seasonality.json: { version, source, license,
 *     cities: { [cityId]: { months: [{score,tempC,precipMm}×12] } } }
 *
 * @module travel/cities
 */
import { loadCityIntelPack } from '../layers/cityIntel/source.js';
import { searchCities } from './citySearch.js';

/** @returns {Promise<Array>} The pack's city records (empty when unset). */
export async function loadCities() {
  return (await loadCityIntelPack())?.cities || [];
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
  const pack = await loadCityIntelPack();
  return pack?.seasonality?.cities?.[cityId]?.months || null;
}
