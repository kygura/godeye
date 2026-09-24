// Build public/data/travel/cities.json from the meridian datasets.
// Usage: node scripts/build-travel-cities.mjs [meridian-data-dir]
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { haversineKm } from '../src/travel/geo.js';

const src = process.argv[2] || path.join(process.env.HOME, 'projects/_archive/meridian/data');
const out = 'public/data/travel';
mkdirSync(out, { recursive: true });

const COUNTRY_ALIASES = {
  'Korea, South': 'South Korea',
  'Korea, North': 'North Korea',
  Burma: 'Myanmar',
  'Congo (Kinshasa)': 'Democratic Republic of the Congo',
  'Congo (Brazzaville)': 'Republic of the Congo',
  'Côte D’Ivoire': 'Ivory Coast',
  Czechia: 'Czech Republic',
  Macedonia: 'North Macedonia',
  Swaziland: 'Eswatini',
};
const canon = (n) => (COUNTRY_ALIASES[n] ?? n).toLowerCase();
const slug = (city, country) =>
  `${city}-${country}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// ponytail: naive CSV split; worldcities.csv has no quoted fields.
const [, ...rows] = readFileSync(path.join(src, 'worldcities.csv'), 'utf8').trim().split('\n');
const airports = JSON.parse(readFileSync(path.join(src, 'airports.json'), 'utf8'));
const capitals = JSON.parse(readFileSync(path.join(src, 'capitals.json'), 'utf8'));
const capitalSet = new Set(capitals.map((c) => `${c.capital.toLowerCase()}|${canon(c.country)}`));

const cities = rows.map((line) => {
  const [name, lat, lng, country, pop] = line.split(',').map((s) => s.trim());
  return { id: slug(name, country), name, country, lat: +lat, lng: +lng, pop: +pop || 0 };
});

const byCountry = new Map();
for (const a of airports) {
  const k = canon(a.country);
  if (!byCountry.has(k)) byCountry.set(k, []);
  byCountry.get(k).push(a);
}
const used = new Set();
for (const c of cities) {
  const pick = (pool, maxKm) => {
    let best;
    for (const a of pool) {
      const d = haversineKm([c.lng, c.lat], [a.lng, a.lat]);
      if (d > maxKm) continue;
      const score = (a.city.toLowerCase() === c.name.toLowerCase() ? 2 : 0) + (a.size === 'large' ? 1 : 0);
      if (!best || score > best.score || (score === best.score && d < best.d)) best = { a, d, score };
    }
    return best?.a;
  };
  const m = pick(byCountry.get(canon(c.country)) ?? [], 100) ?? pick(airports, 40);
  if (m) {
    c.iata = m.iata;
    c.hub = m.size;
    used.add(m.iata);
  }
  if (capitalSet.has(`${c.name.toLowerCase()}|${canon(c.country)}`)) c.capital = true;
}
const ids = new Set(cities.map((c) => c.id));
for (const a of airports) {
  if (used.has(a.iata)) continue;
  const name = a.city || a.name.replace(/ (International )?Airport$/i, '');
  const id = slug(name, a.country);
  if (ids.has(id)) continue;
  ids.add(id);
  cities.push({ id, name, country: a.country, lat: a.lat, lng: a.lng, pop: 0, iata: a.iata, hub: a.size });
}
for (const c of cities) {
  c.lat = +c.lat.toFixed(4);
  c.lng = +c.lng.toFixed(4);
}
writeFileSync(path.join(out, 'cities.json'), JSON.stringify(cities));
copyFileSync(path.join(src, 'seasonality.json'), path.join(out, 'seasonality.json'));
console.log(`${cities.length} cities (${cities.filter((c) => c.iata).length} with airports)`);
