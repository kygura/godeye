/** Lazy loaders for the committed travel datasets. Cached per page. */
import { searchCities } from './citySearch.js';

const base = () => `${import.meta.env?.BASE_URL || '/'}data/travel/`;
let _cities = null;
let _seasonality = null;

export async function loadCities(fetchImpl = globalThis.fetch) {
  _cities ||= fetchImpl(`${base()}cities.json`).then((r) => {
    if (!r.ok) throw new Error(`cities.json ${r.status}`);
    return r.json();
  });
  return _cities;
}

export async function loadSeasonality(fetchImpl = globalThis.fetch) {
  _seasonality ||= fetchImpl(`${base()}seasonality.json`).then((r) => {
    if (!r.ok) throw new Error(`seasonality.json ${r.status}`);
    return r.json();
  });
  return _seasonality;
}

export async function findCities(query, limit = 8) {
  return searchCities(await loadCities(), query, limit);
}

/** 12 months of {score,tempC,precipMm} or null when the city is not seeded. */
export async function citySeasonality(cityId) {
  const data = await loadSeasonality();
  return data?.cities?.[cityId]?.months || null;
}
