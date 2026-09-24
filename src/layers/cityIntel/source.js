/**
 * @file City Intel bundled pack loader and live-data client.
 *
 * Portable: no Cesium, no DOM (see `scripts/check-import-directions.mjs`).
 * The bundled pack (cities + countries + seasonality) loads once per session
 * and is cached, following the `bundledJson`/`retryableLoad` pattern already
 * used by `src/data/naturalEarthRegions.js` and `src/travel/cities.js`. The
 * live client hits this app's own `/api/city-intel/*` proxy
 * (`server/providers/cityIntel.js`, docs/cockpit/SPEC.md §3.3); every call
 * resolves the server's envelope (`{ ok, data, fetchedAt, stale, source }`)
 * or `{ ok: false, error }` and never throws or rejects.
 *
 * @module layers/cityIntel/source
 */
import { loadBundledJson } from '../../data/bundledJson.js';
import { createRetryableLoader } from '../../data/retryableLoad.js';

const PACK_FILES = Object.freeze({
  cities: Object.freeze({
    url: new URL(
      '../../data/local_data/city_intel/cities.json',
      import.meta.url,
    ),
    importJson: () =>
      import('../../data/local_data/city_intel/cities.json', {
        with: { type: 'json' },
      }),
  }),
  countries: Object.freeze({
    url: new URL(
      '../../data/local_data/city_intel/countries.json',
      import.meta.url,
    ),
    importJson: () =>
      import('../../data/local_data/city_intel/countries.json', {
        with: { type: 'json' },
      }),
  }),
  seasonality: Object.freeze({
    url: new URL(
      '../../data/local_data/city_intel/seasonality.json',
      import.meta.url,
    ),
    importJson: () =>
      import('../../data/local_data/city_intel/seasonality.json', {
        with: { type: 'json' },
      }),
  }),
});

/**
 * Load the City Intel bundled pack (lazy, cached, retryable): the city
 * roster, the per-country indicator set, and the seasonality seed.
 * @returns {Promise<{cities: object[], countries: object, seasonality: object}>}
 */
export const loadCityIntelPack = createRetryableLoader(async () => {
  const [cities, countries, seasonality] = await Promise.all(
    Object.values(PACK_FILES).map((file) =>
      loadBundledJson(file.url, file.importJson),
    ),
  );
  return { cities: cities.cities, countries, seasonality };
});

// ---------------------------------------------------------------------------
// Live client: `/api/city-intel/*` (server/providers/cityIntel.js)
// ---------------------------------------------------------------------------

const BASE_URL = '/api/city-intel';

/**
 * Fetch one route and hand back its envelope, or a `{ ok: false, error }`
 * failure — including on a network error or an abort. Never throws.
 * @param {string} path Route beneath `/api/city-intel`.
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<{ok: true, data: *, fetchedAt: number, stale: boolean, source: object}|{ok: false, error: string}>}
 */
async function getJson(path, { signal } = {}) {
  try {
    const response = await fetch(`${BASE_URL}${path}`, { signal });
    const body = await response.json().catch(() => null);
    if (body && typeof body === 'object' && typeof body.ok === 'boolean')
      return body;
    return { ok: false, error: `bad response (HTTP ${response.status})` };
  } catch (error) {
    return {
      ok: false,
      error:
        error?.name === 'AbortError'
          ? 'aborted'
          : error?.message || 'network error',
    };
  }
}

/**
 * US State Dept travel advisories, keyed by ISO3.
 */
export function fetchAdvisories() {
  return getJson('/advisories');
}

/**
 * Visa access from one passport to every destination.
 * @param {string} passport ISO3 passport code.
 */
export function fetchVisa(passport) {
  return getJson(`/visa?passport=${encodeURIComponent(passport)}`);
}

/**
 * Latest Zillow ZORI metro rent index (US only).
 */
export function fetchRent() {
  return getJson('/rent');
}

/**
 * Current air quality at one coordinate.
 * @param {number} lat
 * @param {number} lon
 * @param {{signal?: AbortSignal}} [options]
 */
export function fetchAir(lat, lon, { signal } = {}) {
  return getJson(
    `/air?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
    { signal },
  );
}

// ---------------------------------------------------------------------------
// Rent matching: ZORI metro rows -> pack city ids (US only)
// ---------------------------------------------------------------------------

/** USPS state abbreviation -> the pack's `admin1` full name (50 states + DC). */
const US_STATE_NAMES = Object.freeze({
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
});

/**
 * Match Zillow ZORI metro rows to pack cities (US only): metro `principal`
 * name + state abbreviation against the pack's city `name` + full `admin1`
 * state name. On a name clash within one state, the largest-population pack
 * city wins.
 *
 * ponytail: exact case-insensitive name match only, no alias table for
 * metro/city name spelling drift (e.g. "St. Louis" vs "Saint Louis"); widen
 * to a lookup table if real ZORI data shows unmatched principals.
 *
 * @param {{metros?: Array<{principal: string, state: string|null, zori: number, month: string, name: string}>}} rentData `fetchRent()`'s `data` payload.
 * @param {Array<{id: string, iso3: string, name: string, admin1: string, pop: number}>} cities Pack cities.
 * @returns {Map<string, {zori: number, month: string, metro: string}>}
 */
export function matchRentToCities(rentData, cities) {
  const result = new Map();
  const metros = rentData?.metros;
  if (!Array.isArray(metros) || !Array.isArray(cities)) return result;
  const usCities = cities.filter((city) => city.iso3 === 'USA');
  for (const metro of metros) {
    const stateName = US_STATE_NAMES[String(metro?.state || '').toUpperCase()];
    const principal = String(metro?.principal || '')
      .trim()
      .toLowerCase();
    if (!stateName || !principal) continue;
    let best = null;
    for (const city of usCities) {
      if (city.admin1 !== stateName) continue;
      if (city.name.trim().toLowerCase() !== principal) continue;
      if (!best || (city.pop || 0) > (best.pop || 0)) best = city;
    }
    if (!best) continue;
    result.set(best.id, {
      zori: metro.zori,
      month: metro.month,
      metro: metro.name,
    });
  }
  return result;
}
