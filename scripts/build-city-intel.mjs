#!/usr/bin/env node
/**
 * Build src/data/local_data/city_intel/{cities,countries,seasonality,source}.json
 * for the City Intel pack (docs/cockpit/SPEC.md §3.1-3.2).
 *
 * Sources (network at build time, pinned + hashed in source.json):
 *   - Natural Earth 10m populated places simple (public domain)
 *   - Natural Earth 110m admin-0 countries + tiny-countries (public domain)
 *   - OurAirports airports.csv (public domain)
 *   - World Bank WDI/WGI API v2 (CC BY 4.0, keyless)
 *   - Meridian seasonality.json seed (CC BY 4.0, read-only) re-keyed by nearest
 *     coordinates, using Meridian's worldcities.csv ONLY for seed coordinates
 *     (never redistributed — see source.json).
 *
 * Usage: node scripts/build-city-intel.mjs
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, '.gev-cache/city-intel-build');
const OUT_DIR = path.join(ROOT, 'src/data/local_data/city_intel');
const MERIDIAN_DATA = path.join(
  os.homedir(),
  'projects/_archive/meridian/data',
);

const BUILD_YEAR = new Date().getUTCFullYear();
const MAX_AGE_YEARS = 10;
const MIN_METRIC_YEAR = BUILD_YEAR - MAX_AGE_YEARS;
const POP_FLOOR_START = 150000;
const MAX_CITIES = 3000;

const NE_REPO = 'nvkelso/natural-earth-vector';
const OURAIRPORTS_REPO = 'davidmegginson/ourairports-data';

// NE ADM0_A3 codes that are not the ISO3 this pack needs (verified against the
// World Bank country list — see docs/cockpit research + build console output).
const ISO3_OVERRIDES = {
  SDS: 'SSD', // South Sudan: NE admin-0 polygon uses "SDS"; NE populated places + WB use SSD
  KOS: 'XKX', // Kosovo: WB pseudo-code
  PSX: 'PSE', // Palestine: WB "West Bank and Gaza"
  SAH: 'ESH', // Western Sahara: standard ISO3, not a WB economy (empty metrics, like Taiwan)
};

// Micro-territories absent from BOTH ne_110m_admin_0_countries and
// ne_110m_admin_0_tiny_countries (110m resolution drops them entirely), but
// present as World Bank economies. Continent/subregion are uncontested
// geography, filled in manually rather than escalating to the 10m dataset.
const MANUAL_GEO = {
  GIB: { continent: 'Europe', subregion: 'Southern Europe' },
  HKG: { continent: 'Asia', subregion: 'Eastern Asia' },
  MAC: { continent: 'Asia', subregion: 'Eastern Asia' },
};

const INDICATORS = {
  lifeExpectancy: {
    code: 'SP.DYN.LE00.IN',
    label: 'Life expectancy',
    unit: 'years',
    pillar: 'qol',
    direction: 'higher',
    source: 'World Bank WDI',
    url: 'https://data.worldbank.org/indicator/SP.DYN.LE00.IN',
    license: 'CC BY 4.0',
  },
  internetUsers: {
    code: 'IT.NET.USER.ZS',
    label: 'Internet users',
    unit: '% of population',
    pillar: 'qol',
    direction: 'higher',
    source: 'World Bank WDI',
    url: 'https://data.worldbank.org/indicator/IT.NET.USER.ZS',
    license: 'CC BY 4.0',
  },
  pm25: {
    code: 'EN.ATM.PM25.MC.M3',
    label: 'PM2.5 exposure',
    unit: 'µg/m³',
    pillar: 'qol',
    direction: 'lower',
    source: 'World Bank WDI',
    url: 'https://data.worldbank.org/indicator/EN.ATM.PM25.MC.M3',
    license: 'CC BY 4.0',
  },
  priceLevel: {
    code: 'PA.NUS.PRVT.PP / PA.NUS.FCRF',
    label: 'Consumer price level',
    unit: '× US',
    pillar: 'cost',
    direction: 'lower',
    source: 'World Bank WDI',
    url: 'https://data.worldbank.org/indicator/PA.NUS.PRVT.PP',
    license: 'CC BY 4.0',
    derived: true,
  },
  homicideRate: {
    code: 'VC.IHR.PSRC.P5',
    label: 'Intentional homicides',
    unit: 'per 100k',
    pillar: 'safety',
    direction: 'lower',
    source: 'World Bank WDI',
    url: 'https://data.worldbank.org/indicator/VC.IHR.PSRC.P5',
    license: 'CC BY 4.0',
  },
  politicalStability: {
    code: 'GOV_WGI_PV.EST',
    label: 'Political stability',
    unit: 'index −2.5…2.5',
    pillar: 'safety',
    direction: 'higher',
    source: 'World Bank WGI',
    url: 'https://databank.worldbank.org/source/worldwide-governance-indicators',
    license: 'CC BY 4.0',
  },
};

/** slugify a display string into an id fragment. */
function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Great-circle distance in km between two [lat, lon] points. */
function haversineKm([lat1, lon1], [lat2, lon2]) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Minimal RFC-4180 CSV parser (quoted fields, embedded commas/quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  return rows.map((r) =>
    Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])),
  );
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Fetch (or reuse a cached copy of) a URL, recording its provenance. */
async function cachedFetch(url, cacheKey, { json = false } = {}) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, cacheKey);
  let text;
  try {
    text = readFileSync(cachePath, 'utf8');
    console.log(`cache hit: ${cacheKey}`);
  } catch {
    console.log(`fetching ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    text = await res.text();
    writeFileSync(cachePath, text);
  }
  const hash = sha256(Buffer.from(text, 'utf8'));
  return { text, sha256: hash, data: json ? JSON.parse(text) : undefined };
}

async function ghLatestCommitSha(repo) {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/commits?per_page=1`,
    {
      headers: { 'user-agent': 'gev-city-intel-build' },
    },
  );
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status} for ${repo}`);
  const [commit] = await res.json();
  return commit.sha;
}

/** World Bank v2 indicator series: iso3 -> Map(year -> value). */
async function fetchIndicatorSeries(code, { source } = {}) {
  const qs = new URLSearchParams({
    format: 'json',
    per_page: '20000',
    date: '2010:2026',
  });
  if (source) qs.set('source', String(source));
  const url = `https://api.worldbank.org/v2/country/all/indicator/${code}?${qs}`;
  const cacheKey = `wb-${code.replace(/[^a-zA-Z0-9.]/g, '_')}.json`;
  const { data, sha256: hash } = await cachedFetch(url, cacheKey, {
    json: true,
  });
  const rows = data[1] ?? [];
  const byCountry = new Map();
  for (const r of rows) {
    if (!r.countryiso3code || r.value === null) continue;
    const year = Number(r.date);
    if (!Number.isFinite(year)) continue;
    if (!byCountry.has(r.countryiso3code))
      byCountry.set(r.countryiso3code, new Map());
    byCountry.get(r.countryiso3code).set(year, r.value);
  }
  return { byCountry, url, sha256: hash };
}

/** Latest value per country at or after minYear. */
function latestValue(byCountry, minYear) {
  const out = new Map();
  for (const [iso3, byYear] of byCountry) {
    let best = null;
    for (const [year, value] of byYear) {
      if (year < minYear) continue;
      if (!best || year > best.year) best = { year, value };
    }
    if (best) out.set(iso3, best);
  }
  return out;
}

/** priceLevel = PA.NUS.PRVT.PP / PA.NUS.FCRF, same year, both non-null, latest such year. */
function derivedPriceLevel(prvtByCountry, fcrfByCountry, minYear) {
  const out = new Map();
  for (const [iso3, prvtByYear] of prvtByCountry) {
    const fcrfByYear = fcrfByCountry.get(iso3);
    if (!fcrfByYear) continue;
    let best = null;
    for (const [year, prvt] of prvtByYear) {
      if (year < minYear) continue;
      const fcrf = fcrfByYear.get(year);
      if (!fcrf) continue;
      if (!best || year > best.year) best = { year, value: prvt / fcrf };
    }
    if (best) out.set(iso3, best);
  }
  return out;
}

const round1 = (v) => Math.round(v * 10) / 10;
const round3 = (v) => Math.round(v * 1000) / 1000;
const round4 = (v) => Math.round(v * 10000) / 10000;

async function main() {
  const anomalies = [];

  // --- Natural Earth (populated places + admin-0 + tiny-countries) ---
  const neSha = await ghLatestCommitSha(NE_REPO);
  const rawBase = `https://raw.githubusercontent.com/${NE_REPO}/${neSha}/geojson`;
  const [places, admin0, tiny] = await Promise.all([
    cachedFetch(
      `${rawBase}/ne_10m_populated_places_simple.geojson`,
      'ne-places.geojson',
      { json: true },
    ),
    cachedFetch(
      `${rawBase}/ne_110m_admin_0_countries.geojson`,
      'ne-admin0.geojson',
      { json: true },
    ),
    cachedFetch(
      `${rawBase}/ne_110m_admin_0_tiny_countries.geojson`,
      'ne-tiny.geojson',
      { json: true },
    ),
  ]);

  // --- OurAirports ---
  const airportsSha = await ghLatestCommitSha(OURAIRPORTS_REPO);
  const airportsRaw = await cachedFetch(
    `https://raw.githubusercontent.com/${OURAIRPORTS_REPO}/${airportsSha}/airports.csv`,
    'ourairports.csv',
  );
  const airportRows = parseCsv(airportsRaw.text);

  // --- World Bank country list ---
  const wbCountriesRaw = await cachedFetch(
    'https://api.worldbank.org/v2/country?format=json&per_page=400',
    'wb-countries.json',
    { json: true },
  );
  const wbCountries = new Map();
  for (const c of wbCountriesRaw.data[1] ?? []) {
    if (c.region?.id === 'NA') continue; // aggregate, not a real country
    wbCountries.set(c.id, {
      name: c.name,
      iso2: c.iso2Code,
      region: c.region.value,
    });
  }

  // --- World Bank indicators ---
  const series = {};
  const wbSourceMeta = {};
  for (const [key, meta] of Object.entries(INDICATORS)) {
    if (meta.derived) continue;
    const codes = meta.code.split(' / ');
    const codeKey = codes[0];
    // eslint-disable-next-line no-await-in-loop
    const {
      byCountry,
      url,
      sha256: hash,
    } = await fetchIndicatorSeries(
      codeKey,
      key === 'politicalStability' ? { source: 3 } : {},
    );
    series[key] = latestValue(byCountry, MIN_METRIC_YEAR);
    wbSourceMeta[codeKey] = { url, sha256: hash };
  }
  {
    const prvt = await fetchIndicatorSeries('PA.NUS.PRVT.PP');
    const fcrf = await fetchIndicatorSeries('PA.NUS.FCRF');
    series.priceLevel = derivedPriceLevel(
      prvt.byCountry,
      fcrf.byCountry,
      MIN_METRIC_YEAR,
    );
    wbSourceMeta['PA.NUS.PRVT.PP'] = { url: prvt.url, sha256: prvt.sha256 };
    wbSourceMeta['PA.NUS.FCRF'] = { url: fcrf.url, sha256: fcrf.sha256 };
  }

  // --- Country geo (continent/subregion) from NE admin-0 + tiny-countries ---
  const geoByIso3 = new Map();
  for (const f of [...admin0.data.features, ...tiny.data.features]) {
    const p = f.properties;
    const iso3 = ISO3_OVERRIDES[p.ADM0_A3] ?? p.ADM0_A3;
    if (!geoByIso3.has(iso3)) {
      geoByIso3.set(iso3, {
        name: p.NAME,
        continent: p.CONTINENT,
        subregion: p.SUBREGION,
      });
    }
  }
  for (const [iso3, geo] of Object.entries(MANUAL_GEO)) {
    const existing = geoByIso3.get(iso3) ?? {};
    geoByIso3.set(iso3, { ...existing, ...geo });
  }

  // --- iso2 -> iso3 (for airport same-country matching) ---
  const iso2To3 = new Map();
  for (const [iso3, c] of wbCountries) if (c.iso2) iso2To3.set(c.iso2, iso3);
  iso2To3.set('TW', 'TWN');
  iso2To3.set('EH', 'ESH');

  // --- Qualifying airports ---
  const airports = airportRows
    .filter(
      (a) =>
        (a.type === 'large_airport' || a.type === 'medium_airport') &&
        a.scheduled_service === 'yes' &&
        a.iata_code,
    )
    .map((a) => ({
      iata: a.iata_code,
      lat: Number(a.latitude_deg),
      lon: Number(a.longitude_deg),
      type: a.type === 'large_airport' ? 'large' : 'medium',
      iso3: iso2To3.get(a.iso_country) ?? null,
    }))
    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon));

  function nearestAirport(lat, lon, iso3) {
    let sameCountry = null;
    let anyCountry = null;
    for (const a of airports) {
      const d = haversineKm([lat, lon], [a.lat, a.lon]);
      if (a.iso3 === iso3 && d <= 100 && (!sameCountry || d < sameCountry.d))
        sameCountry = { a, d };
      if (d <= 40 && (!anyCountry || d < anyCountry.d)) anyCountry = { a, d };
    }
    const pick = sameCountry ?? anyCountry;
    return pick
      ? { iata: pick.a.iata, km: round1(pick.d), type: pick.a.type }
      : null;
  }

  // --- Cities: pop_max threshold, escalated until <= MAX_CITIES ---
  let threshold = POP_FLOOR_START;
  let eligible;
  for (;;) {
    eligible = places.data.features.filter(
      (f) => f.properties.pop_max >= threshold,
    );
    if (eligible.length <= MAX_CITIES) break;
    threshold += 50000;
  }

  const usedIso3 = new Set();
  const usedIds = new Map(); // base id -> count, for collision reporting
  const cities = [];
  for (const f of eligible) {
    const p = f.properties;
    const iso3 = ISO3_OVERRIDES[p.adm0_a3] ?? p.adm0_a3;
    usedIso3.add(iso3);
    const countryName =
      wbCountries.get(iso3)?.name ?? geoByIso3.get(iso3)?.name ?? p.adm0name;

    let id = `${slugify(p.nameascii)}-${iso3.toLowerCase()}`;
    if (usedIds.has(id)) {
      const admin1Slug = p.adm1name ? slugify(p.adm1name) : '';
      const withAdmin1 = admin1Slug
        ? `${slugify(p.nameascii)}-${admin1Slug}-${iso3.toLowerCase()}`
        : id;
      id = withAdmin1;
      let suffix = 2;
      const base = id;
      while (usedIds.has(id)) {
        id = `${base}-${suffix++}`;
        anomalies.push(
          `id collision beyond admin1 disambiguation: ${base} -> ${id}`,
        );
      }
    }
    usedIds.set(id, (usedIds.get(id) ?? 0) + 1);

    const airport = nearestAirport(p.latitude, p.longitude, iso3);
    cities.push({
      id,
      name: p.name,
      iso3,
      country: countryName,
      admin1: p.adm1name || null,
      lat: round4(p.latitude),
      lon: round4(p.longitude),
      pop: p.pop_max,
      capital: p.featurecla.startsWith('Admin-0 capital'),
      airport,
    });
  }
  cities.sort(
    (a, b) => b.pop - a.pop || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  // --- Countries: every iso3 used by any city, even with empty metrics ---
  const countries = {};
  for (const iso3 of [...usedIso3].sort()) {
    const wb = wbCountries.get(iso3);
    const geo = geoByIso3.get(iso3);
    if (!wb && !geo) anomalies.push(`no WB or NE record for iso3 ${iso3}`);
    const metrics = {};
    for (const key of Object.keys(INDICATORS)) {
      const hit = series[key]?.get(iso3);
      if (hit) metrics[key] = { v: round3(hit.value), y: hit.year };
    }
    const entry = {
      name: wb?.name ?? geo?.name ?? iso3,
      metrics,
    };
    if (wb?.iso2) entry.iso2 = wb.iso2;
    if (wb?.region) entry.region = wb.region;
    if (geo?.continent) entry.continent = geo.continent;
    if (geo?.subregion) entry.subregion = geo.subregion;
    countries[iso3] = entry;
  }

  // --- Seasonality: re-key Meridian seed to City Intel ids by nearest coords ---
  const meridianSeasonality = JSON.parse(
    readFileSync(path.join(MERIDIAN_DATA, 'seasonality.json'), 'utf8'),
  );
  const worldcitiesCsv = readFileSync(
    path.join(MERIDIAN_DATA, 'worldcities.csv'),
    'utf8',
  );
  const seedCoords = new Map(); // meridian slug id -> [lat, lon] (coords only, never redistributed)
  for (const row of parseCsv(worldcitiesCsv)) {
    const id = `${row.city}-${row.country}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    if (!seedCoords.has(id))
      seedCoords.set(id, [Number(row.lat), Number(row.lng)]);
  }

  const seasonalityCities = {};
  let seasonMatched = 0;
  const seasonUnmatched = [];
  for (const [seedId, entry] of Object.entries(meridianSeasonality.cities)) {
    const coords = seedCoords.get(seedId);
    if (!coords) {
      seasonUnmatched.push(`${seedId} (no coordinates in seed)`);
      continue;
    }
    let nearest = null;
    for (const city of cities) {
      const d = haversineKm(coords, [city.lat, city.lon]);
      if (d <= 25 && (!nearest || d < nearest.d)) nearest = { city, d };
    }
    if (!nearest) {
      seasonUnmatched.push(`${seedId} (no pack city within 25km)`);
      continue;
    }
    seasonalityCities[nearest.city.id] = {
      matchedKm: round1(nearest.d),
      months: entry.months,
    };
    seasonMatched++;
  }

  // --- Write output ---
  mkdirSync(OUT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString().slice(0, 10);

  const citiesOut = { version: 1, generatedAt, count: cities.length, cities };
  const countriesOut = {
    version: 1,
    generatedAt,
    buildYear: BUILD_YEAR,
    maxAgeYears: MAX_AGE_YEARS,
    indicators: INDICATORS,
    countries,
  };
  const seasonalityOut = {
    version: 1,
    window: '2015-2024',
    source: 'Open-Meteo Historical Weather API (via Meridian seed)',
    license: 'CC BY 4.0',
    cities: seasonalityCities,
  };

  const sourceOut = {
    generatedAt,
    inputs: {
      naturalEarthPopulatedPlaces: {
        url: `${rawBase}/ne_10m_populated_places_simple.geojson`,
        commit: neSha,
        sha256: places.sha256,
        license: 'Public domain (naturalearthdata.com/about/terms-of-use)',
        attribution: 'Made with Natural Earth',
      },
      naturalEarthAdmin0Countries: {
        url: `${rawBase}/ne_110m_admin_0_countries.geojson`,
        commit: neSha,
        sha256: admin0.sha256,
        license: 'Public domain (naturalearthdata.com/about/terms-of-use)',
        attribution: 'Made with Natural Earth',
      },
      naturalEarthAdmin0TinyCountries: {
        url: `${rawBase}/ne_110m_admin_0_tiny_countries.geojson`,
        commit: neSha,
        sha256: tiny.sha256,
        license: 'Public domain (naturalearthdata.com/about/terms-of-use)',
        attribution: 'Made with Natural Earth',
        note:
          'Supplies continent/subregion for micro-states invisible at 110m scale. ' +
          'Gibraltar, Hong Kong SAR and Macao SAR are still absent from both 110m ' +
          'files; their continent/subregion are filled in manually (uncontested ' +
          'geography, see MANUAL_GEO in build-city-intel.mjs).',
      },
      ourAirports: {
        url: `https://raw.githubusercontent.com/${OURAIRPORTS_REPO}/${airportsSha}/airports.csv`,
        commit: airportsSha,
        sha256: airportsRaw.sha256,
        license: 'Public domain',
        attribution: 'OurAirports (ourairports.com)',
      },
      worldBankIndicators: {
        ...Object.fromEntries(
          Object.entries(wbSourceMeta).map(([code, meta]) => [
            code,
            { url: meta.url, accessDate: generatedAt, sha256: meta.sha256 },
          ]),
        ),
        license: 'CC BY 4.0',
        attribution: 'World Bank',
        note: 'priceLevel is derived: PA.NUS.PRVT.PP ÷ PA.NUS.FCRF, same year, both non-null.',
      },
      worldBankCountryList: {
        url: 'https://api.worldbank.org/v2/country?format=json&per_page=400',
        accessDate: generatedAt,
        sha256: wbCountriesRaw.sha256,
        license: 'CC BY 4.0',
        attribution: 'World Bank',
      },
      meridianSeasonalitySeed: {
        path: '~/projects/_archive/meridian/data/seasonality.json (read-only, not part of this repo)',
        license: 'CC BY 4.0',
        attribution:
          'Derived from the Open-Meteo Historical Weather API, via the archived Meridian project',
        note:
          'Re-keyed to City Intel ids by nearest coordinates (<=25km). ' +
          "Meridian's worldcities.csv was read ONLY to recover seed-city coordinates " +
          'at build time; it is not committed, redistributed, or otherwise present in this repo.',
      },
    },
  };

  writeFileSync(path.join(OUT_DIR, 'cities.json'), JSON.stringify(citiesOut));
  writeFileSync(
    path.join(OUT_DIR, 'countries.json'),
    JSON.stringify(countriesOut),
  );
  writeFileSync(
    path.join(OUT_DIR, 'seasonality.json'),
    JSON.stringify(seasonalityOut),
  );
  writeFileSync(
    path.join(OUT_DIR, 'source.json'),
    `${JSON.stringify(sourceOut, null, 2)}\n`,
  );
  writeFileSync(
    path.join(OUT_DIR, 'README.md'),
    `# City Intel data pack

Bundled reference data for the City Intel cockpit (docs/cockpit/SPEC.md §3).
Built by \`node scripts/build-city-intel.mjs\`, which pins its upstream commit
SHAs / access dates and records sha256 hashes in \`source.json\`.

| File | Contents |
|---|---|
| \`cities.json\` | ${citiesOut.count} cities (pop ≥ ${threshold.toLocaleString()}): id, name, ISO3, country, admin1, lat/lon, population, capital flag, nearest scheduled-service airport |
| \`countries.json\` | Per-ISO3 name/region/continent/subregion + World Bank metrics (life expectancy, internet users, PM2.5, price level, homicide rate, political stability) |
| \`seasonality.json\` | Monthly climate comfort for ${seasonMatched} cities, re-keyed from the Meridian/Open-Meteo seed by nearest coordinates |

## Rebuild

\`\`\`
node scripts/build-city-intel.mjs
\`\`\`

Requires network access; caches raw downloads under \`.gev-cache/city-intel-build/\`
(gitignored) so re-runs are fast and offline-friendly.

## Licenses / attribution

- Natural Earth (populated places, admin-0 countries, tiny countries) — public domain, "Made with Natural Earth".
- OurAirports — public domain.
- World Bank WDI/WGI indicators and country list — CC BY 4.0, attribution "World Bank".
- Seasonality — CC BY 4.0, derived from the Open-Meteo Historical Weather API via the archived Meridian project's seed. Meridian's \`worldcities.csv\` was used only to look up seed-city coordinates at build time and is never redistributed.

See \`source.json\` for exact URLs, pinned commits/access dates and sha256 hashes.
`,
  );

  // --- Report ---
  const sizes = [
    'cities.json',
    'countries.json',
    'seasonality.json',
    'source.json',
    'README.md',
  ].map((name) => {
    const p = path.join(OUT_DIR, name);
    return { name, kb: (readFileSync(p).length / 1024).toFixed(1) };
  });
  const totalKb = sizes.reduce((sum, s) => sum + Number(s.kb), 0);

  console.log(`\npop_max threshold: ${threshold} -> ${cities.length} cities`);
  console.log(`countries: ${Object.keys(countries).length}`);
  for (const key of Object.keys(INDICATORS)) {
    const n = [...Object.values(countries)].filter(
      (c) => c.metrics[key],
    ).length;
    console.log(`  ${key}: ${n} countries`);
  }
  console.log(
    `seasonality: ${seasonMatched} matched, ${seasonUnmatched.length} unmatched`,
  );
  if (seasonUnmatched.length)
    console.log(`  unmatched: ${seasonUnmatched.join(', ')}`);
  console.log(`NE commit: ${neSha}`);
  console.log(`OurAirports commit: ${airportsSha}`);
  for (const s of sizes) console.log(`  ${s.name}: ${s.kb} KB`);
  console.log(`  total: ${totalKb.toFixed(1)} KB (budget 1536 KB)`);
  if (totalKb > 1536)
    throw new Error(`pack exceeds 1.5 MB budget: ${totalKb.toFixed(1)} KB`);
  if (anomalies.length) {
    console.log(`\nanomalies (${anomalies.length}):`);
    for (const a of anomalies) console.log(`  - ${a}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
