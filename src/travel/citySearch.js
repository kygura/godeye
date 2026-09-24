/**
 * Rank cities for a query. Pure; the city list is the City Intel pack
 * (`src/data/local_data/city_intel/cities.json`, loaded by `cities.js`).
 * Field names follow that pack's schema: airport is `{iata, km, type}|null`.
 */
function rank(c) {
  let s = 0;
  if (c.capital) s += 400;
  if (c.airport?.type === 'large') s += 300;
  else if (c.airport?.type === 'medium') s += 100;
  if (c.airport?.iata) s += 200;
  return s + Math.min(99, Math.floor((c.pop || 0) / 200000));
}

/** Case- and diacritic-folded compare key ("Medellín" / "medellin" match). */
const norm = (s) =>
  String(s || '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * @param {Array} cities
 * @param {string} query
 * @param {number} limit
 */
export function searchCities(cities, query, limit = 40) {
  const q = norm(query);
  if (!q) return [];
  const inCountry = (c) => norm(c.country).startsWith(q);
  if (q.length >= 4 && cities.some(inCountry)) {
    return cities
      .filter(inCountry)
      .sort((a, b) => rank(b) - rank(a))
      .filter((c, i) => c.airport?.iata || i < 5)
      .slice(0, limit);
  }
  const scored = [];
  for (const c of cities) {
    const name = norm(c.name);
    let s = -1;
    if (name === q || norm(c.airport?.iata) === q) s = 3000;
    else if (name.startsWith(q)) s = 2000;
    else if (name.includes(q)) s = 1000;
    else if (norm(c.country).includes(q)) s = 500;
    if (s >= 0) scored.push({ c, s: s + rank(c) });
  }
  return scored
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c);
}
