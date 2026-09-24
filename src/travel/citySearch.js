/** Rank cities for a query. Pure; the city list is the built cities.json. */
function rank(c) {
  let s = 0;
  if (c.capital) s += 400;
  if (c.hub === 'large') s += 300;
  else if (c.hub === 'medium') s += 100;
  if (c.iata) s += 200;
  return s + Math.min(99, Math.floor((c.pop || 0) / 200000));
}

/**
 * @param {Array} cities
 * @param {string} query
 * @param {number} limit
 */
export function searchCities(cities, query, limit = 40) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const inCountry = (c) => c.country.toLowerCase().startsWith(q);
  if (q.length >= 4 && cities.some(inCountry)) {
    return cities
      .filter(inCountry)
      .sort((a, b) => rank(b) - rank(a))
      .filter((c, i) => c.iata || i < 5)
      .slice(0, limit);
  }
  const scored = [];
  for (const c of cities) {
    const name = c.name.toLowerCase();
    let s = -1;
    if (name === q || c.iata?.toLowerCase() === q) s = 3000;
    else if (name.startsWith(q)) s = 2000;
    else if (name.includes(q)) s = 1000;
    else if (c.country.toLowerCase().includes(q)) s = 500;
    if (s >= 0) scored.push({ c, s: s + rank(c) });
  }
  return scored
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c);
}
