#!/usr/bin/env node
/**
 * Build src/data/local_data/city_intel/{cities,countries,seasonality,source}.json
 * for the City Intel pack (docs/cockpit/SPEC.md §3.1-3.2, §3.5 Seasonality).
 *
 * Sources (network at build time, hashed in source.json):
 *   - GeoNames cities1000 + admin1CodesASCII + countryInfo (CC BY 4.0;
 *     unversioned, so the download date + sha256 are recorded)
 *   - Natural Earth 110m admin-0 countries + tiny-countries (public domain, pinned commit)
 *   - OurAirports airports.csv (public domain, pinned commit)
 *   - World Bank WDI/WGI API v2 (CC BY 4.0, keyless; live, not pinned — access-dated)
 *   - NASA POWER monthly climatology, regional endpoint (public; acknowledgement
 *     requested; live, not pinned — access-dated), one call per 10°×10° tile
 *     and parameter, cached under .gev-cache/.
 *   - Inside Airbnb listings summaries (CC BY 4.0), latest snapshot per city.
 *
 * City ids are stable across rebuilds: the previous cities.json acts as the id
 * registry (see matchLegacyCities).
 *
 * Usage: node scripts/build-city-intel.mjs
 */

import {
  writeFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  existsSync,
} from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { comfortScore, MONTH_ABBR } from '../src/travel/seasonality.js';
import { haversineKm as haversineKmLonLat } from '../src/travel/geo.js';
import { parseCsv as parseCsvRows } from '../server/providers/cityIntel.js';
import { median } from '../src/data/flowMatch.js';
import {
  dot,
  fitHousingModel,
  housingFeatures,
} from '../src/data/cityIntelHousingModel.js';

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, '.gev-cache/city-intel-build');
const POWER_CACHE_DIR = path.join(CACHE_DIR, 'power');
const OUT_DIR = path.join(ROOT, 'src/data/local_data/city_intel');

const BUILD_YEAR = new Date().getUTCFullYear();
const MAX_AGE_YEARS = 10;
const MIN_METRIC_YEAR = BUILD_YEAR - MAX_AGE_YEARS;
// City selection: every GeoNames place with population >= MIN_POP, plus the
// curated EXTRA_TOWNS below and every city of the previous pack (id registry).
const MIN_POP = 50000;
// §3.2: ~12.5k cities (compact rows) + seasonality v3 (grid cells).
const PACK_BUDGET_KB = 4.5 * 1024;
// GeoNames feature codes that are not a place someone lives in on its own:
// sections of a city (PPLX), historical/abandoned/destroyed places.
const EXCLUDED_FEATURE_CODES = new Set([
  'PPLX',
  'PPLH',
  'PPLQ',
  'PPLW',
  'PPLCH',
]);
// A previous-pack city keeps its id when a GeoNames place in the same country
// with a matching name lies within this distance.
const LEGACY_MATCH_KM = 25;
// Metro dedupe: a candidate within this distance of a more populous kept city
// in the same country is a suburb/district of it (GeoNames lists many metro
// parts as their own PPL/PPLA*), and is dropped. Capitals, EXTRA_TOWNS and
// every previous-pack id are never dropped.
// ponytail: plain radius, no urban-footprint data; a genuinely separate city
// closer than this to a bigger one is lost unless it holds a previous id.
const METRO_DEDUPE_KM = Number(process.env.GEV_METRO_DEDUPE_KM) || 20;

const GEONAMES_BASE = 'https://download.geonames.org/export/dump';
// GeoNames codes France's overseas departments as their own countries; the
// World Bank (and Natural Earth admin-0) count them inside France.
const GN_ISO3_OVERRIDES = Object.freeze({
  GLP: 'FRA',
  GUF: 'FRA',
  MTQ: 'FRA',
  MYT: 'FRA',
  REU: 'FRA',
});

// Well-known remote-work / lifestyle towns below MIN_POP (or ones the metro
// dedupe would fold into a bigger neighbour, e.g. Ubud into Denpasar), by
// GeoNames id. Always kept.
// ponytail: hand-curated because no open "destination" signal exists (no
// open tourism-arrivals or nomad-density dataset at town level); extend by
// adding ids here.
const EXTRA_TOWNS = Object.freeze({
  3515040: 'Tulum',
  3197538: 'Kotor',
  3203106: 'Budva',
  2268563: 'Ericeira',
  2510599: 'Tarifa',
  2267226: 'Lagos (PT)',
  3983210: 'Sayulita',
  3520994: 'Puerto Escondido',
  1151601: 'Pai',
  358245: 'Dahab',
  733462: 'Bansko',
  2568012: 'Taghazout',
  2172880: 'Byron Bay',
  6619864: 'Tamarindo',
  1713046: 'General Luna (Siargao)',
  3589637: 'San Pedro La Laguna',
  3713860: 'Boquete',
  3199180: 'Hvar',
  3027301: 'Chamonix-Mont-Blanc',
  1580541: 'Hoi An',
  6698658: 'Ko Pha Ngan',
  3616726: 'San Juan del Sur',
  3695000: 'Máncora',
  3460940: 'Itacaré',
  3500243: 'Las Terrenas',
  3510969: 'Cabarete',
  3201047: 'Dubrovnik',
  308948: 'Kaş',
  726963: 'Sozopol',
  2269594: 'Cascais',
  2262912: 'Sintra',
  3203925: 'Bled',
  1831112: 'Kampot',
  1278464: 'Arambol',
  1272832: 'Dharamsala',
  1223738: 'Weligama',
  2512196: 'Puerto de la Cruz',
  6317383: 'Jijoca de Jericoacoara',
  1622846: 'Ubud', // 22 km from Denpasar, a separate destination
});

// Places absent from every GeoNames cities file. Population unknown (0).
const MANUAL_CITIES = Object.freeze([
  {
    id: 'canggu-idn',
    name: 'Canggu',
    iso3: 'IDN',
    admin1: 'Bali',
    lat: -8.648,
    lon: 115.138,
    pop: 0,
    capital: false,
  },
]);

// Quality gates: the build exits non-zero (and writes nothing) past these.
// Any failed NASA POWER tile drops every city in a 10° box, and a rerun only
// refetches the missing tiles, so none may fail. 95% seasonality coverage is
// the pack test's floor. Inside Airbnb: fewer than half of the attempted
// (matched, convertible) datasets usable means the source broke, not that a
// few cities lack monthly listings.
const MAX_POWER_TILE_FAILURES = 0;
const MIN_SEASONALITY_COVERAGE = 0.95;
const MIN_IAB_USABLE_SHARE = 0.5;

// NASA POWER climatology grid (MERRA-2): cell centres at multiples of these.
const POWER_LAT_STEP = 0.5;
const POWER_LON_STEP = 0.625;
const POWER_TILE_DEG = 10; // regional endpoint: one parameter per call, <= 10° box
const POWER_PARAMS = ['T2M', 'PRECTOTCORR'];

// Inside Airbnb (listings summary per city snapshot).
const IAB_INDEX_URL = 'https://insideairbnb.com/get-the-data/';
const IAB_MIN_N = 30; // below this, relax minimum_nights 28 -> 7
const IAB_MIN_N_RELAXED = 15; // below this even relaxed, skip the city
// Datasets named after a region, not one city: never mapped to a city.
const IAB_REGION_DATASETS = new Set([
  'belize',
  'greater-manchester',
  'trentino',
  'euskadi',
  'pays-basque',
  'south-aegean',
  'twin-cities-msa',
  'clark-county-nv',
  'broward-county',
  'san-mateo-county',
  'santa-clara-county',
  'santa-cruz-county',
]);
// Dataset country slug -> ISO3 where slug(GeoNames country name) differs.
const IAB_COUNTRY_ISO3 = Object.freeze({
  'the-netherlands': 'NLD',
  'czech-republic': 'CZE',
  china: 'HKG', // only dataset is Hong Kong
  turkey: 'TUR',
});
// Dataset city slug -> GeoNames name slug where they differ.
const IAB_CITY_ALIASES = Object.freeze({
  'new-york-city': 'new-york',
  sevilla: 'seville',
  'washington-dc': 'washington',
  'salem-or': 'salem',
  'quebec-city': 'quebec',
});

// NASA POWER climatology fetch: politeness knobs.
const POWER_CONCURRENCY = 3;
const POWER_BATCH_DELAY_MS = 150;
const POWER_MAX_RETRIES = 3;
const POWER_USER_AGENT =
  'gods-eye-view build (+https://github.com/bilawalsidhu/gods-eye-view)';
const DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const NE_REPO = 'nvkelso/natural-earth-vector';
const OURAIRPORTS_REPO = 'davidmegginson/ourairports-data';
// Pinned commits (raw URLs by commit are immutable): NE 10m populated
// places / 110m admin-0 + tiny-countries, and OurAirports airports.csv.
// Run with --update-pins to fetch each repo's latest HEAD sha instead, then
// paste the printed values in here.
const NE_SHA = 'ca96624a56bd078437bca8184e78163e5039ad19';
const OURAIRPORTS_SHA = '44d4715eca5a7b01b88f0be00ed62dcca309b633';
const UPDATE_PINS = process.argv.includes('--update-pins');

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
  // geo.js takes [lon, lat] pairs — flip both points here at the one call site.
  return haversineKmLonLat([lon1, lat1], [lon2, lat2]);
}

/** Header-mapped CSV rows, on top of the shared RFC-4180 tokenizer. */
function parseCsv(text) {
  const rows = parseCsvRows(text);
  const header = rows.shift();
  return rows.map((r) =>
    Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])),
  );
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FETCH_TIMEOUT_MS = 20000;
const FETCH_MAX_RETRIES = 3;

/**
 * fetch() with a timeout and retry/backoff, shared by cachedFetch and
 * fetchPowerClimatology so both back off the same way against transient
 * upstream/CDN hiccups (429, 5xx, timeouts, network errors). `validate`
 * receives the ok response and may parse + throw to retry a
 * malformed/incomplete body too; it defaults to returning the response.
 */
async function fetchWithRetry(
  url,
  {
    headers,
    maxRetries = FETCH_MAX_RETRIES,
    timeoutMs = FETCH_TIMEOUT_MS,
    validate = (res) => res,
  } = {},
) {
  let lastError = 'unknown error';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // eslint-disable-next-line no-await-in-loop
      return await validate(res);
    } catch (err) {
      lastError = err.message;
      if (attempt === maxRetries) throw new Error(lastError);
      // eslint-disable-next-line no-await-in-loop
      await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error(lastError);
}

/**
 * Run a body check; rethrow its failure naming the URL. Bodies are checked
 * before they are cached (a bad body is never written) and again when read
 * back from the cache.
 */
function assertValidBody(url, check) {
  try {
    check();
  } catch (err) {
    throw new Error(`invalid response from ${url}: ${err.message}`);
  }
}

/** Throw unless the first CSV line names every column in `columns`. */
function requireCsvColumns(text, columns) {
  const header =
    parseCsvRows(text.slice(0, text.indexOf('\n') + 1 || undefined))[0] ?? [];
  const missing = columns.filter((c) => !header.includes(c));
  if (missing.length)
    throw new Error(`missing CSV column(s) ${missing.join(', ')}`);
}

/**
 * Fetch (or reuse a cached copy of) a URL, recording its provenance. `json`
 * bodies must parse; `validate(text, data)` may throw to reject a body.
 */
async function cachedFetch(url, cacheKey, { json = false, validate } = {}) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, cacheKey);
  const check = (text) => {
    let data;
    assertValidBody(url, () => {
      data = json ? JSON.parse(text) : undefined;
      validate?.(text, data);
    });
    return data;
  };
  let text;
  let data;
  try {
    text = readFileSync(cachePath, 'utf8');
    console.log(`cache hit: ${cacheKey}`);
    data = check(text);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    console.log(`fetching ${url}`);
    const res = await fetchWithRetry(url);
    text = await res.text();
    data = check(text);
    writeFileSync(cachePath, text);
  }
  const hash = sha256(Buffer.from(text, 'utf8'));
  return { text, sha256: hash, data };
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

/** GeoJSON FeatureCollection with a features array. */
function requireFeatureCollection(text, data) {
  if (!Array.isArray(data?.features))
    throw new Error('no GeoJSON features array');
}

/** GeoNames cities zip: PK local-file magic, and a 19-column TSV inside. */
function requireGeonamesZip(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50)
    throw new Error('not a zip (no PK\\x03\\x04 magic)');
  const text = unzipFirstEntry(buf).toString('utf8', 0, 4096);
  const columns = text.slice(0, text.indexOf('\n')).split('\t').length;
  if (columns !== 19)
    throw new Error(`expected 19 TSV columns, got ${columns}`);
}

/** World Bank v2 bodies are `[pageMeta, rows]`; an error body is `[{message}]`. */
function requireWorldBankPage(text, data) {
  if (!Array.isArray(data) || data.length !== 2 || !data[0]?.page)
    throw new Error('not a World Bank [meta, rows] page');
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
    validate: requireWorldBankPage,
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

// Plausible consumer price level vs the US. Outside this, PRVT.PP and FCRF
// disagree on the currency or rate regime (Zimbabwe, Liberia, Iran's official
// rate) and the ratio is meaningless, so it is dropped as missing.
const PRICE_LEVEL_RANGE = [0.05, 2];
// Euro adopters whose PA.NUS.PRVT.PP the World Bank already rebased to EUR
// while PA.NUS.FCRF is still in the old currency: iso3 -> old units per EUR.
// Applied only while FCRF still looks like the old currency (> 1.5 per USD).
const EURO_REBASE = { BGR: 1.95583 }; // Bulgaria adopted the euro 2026-01-01

/** priceLevel = PA.NUS.PRVT.PP / PA.NUS.FCRF, same year, both non-null, latest such year. */
function derivedPriceLevel(prvtByCountry, fcrfByCountry, minYear, anomalies) {
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
    if (!best) continue;
    if (
      best.value < PRICE_LEVEL_RANGE[0] ||
      best.value > PRICE_LEVEL_RANGE[1]
    ) {
      anomalies.push(
        `priceLevel ${iso3} ${best.value.toFixed(3)} (${best.year}) outside ${PRICE_LEVEL_RANGE.join('-')}: dropped`,
      );
      continue;
    }
    out.set(iso3, best);
  }
  return out;
}

/** Convert FCRF to EUR for EURO_REBASE countries (see there), in place. */
function rebaseEuroFcrf(fcrfByCountry, anomalies) {
  for (const [iso3, perEur] of Object.entries(EURO_REBASE)) {
    const byYear = fcrfByCountry.get(iso3);
    if (!byYear) continue;
    for (const [year, v] of byYear) if (v > 1.5) byYear.set(year, v / perEur);
    anomalies.push(
      `FCRF ${iso3} rebased to EUR (÷${perEur}) to match PA.NUS.PRVT.PP`,
    );
  }
}

const round1 = (v) => Math.round(v * 10) / 10;
const round3 = (v) => Math.round(v * 1000) / 1000;
const round4 = (v) => Math.round(v * 10000) / 10000;

/** Binary twin of cachedFetch; also reports when the cached copy was downloaded. */
async function cachedFetchBuffer(
  url,
  cacheKey,
  { timeoutMs = 120000, validate } = {},
) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, cacheKey);
  let buf;
  if (existsSync(cachePath)) {
    console.log(`cache hit: ${cacheKey}`);
    buf = readFileSync(cachePath);
    assertValidBody(url, () => validate?.(buf));
  } else {
    console.log(`fetching ${url}`);
    const res = await fetchWithRetry(url, { timeoutMs });
    buf = Buffer.from(await res.arrayBuffer());
    assertValidBody(url, () => validate?.(buf));
    writeFileSync(cachePath, buf);
  }
  return {
    buf,
    sha256: sha256(buf),
    downloadedAt: statSync(cachePath).mtime.toISOString().slice(0, 10),
  };
}

/** First entry of a zip archive (GeoNames dumps hold exactly one file). */
function unzipFirstEntry(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  const cd = buf.readUInt32LE(eocd + 16);
  const method = buf.readUInt16LE(cd + 10);
  const compressedSize = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  const start =
    local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + compressedSize);
  return method === 0 ? data : inflateRawSync(data);
}

/** Case/diacritic/punctuation-folded compare key. */
const foldName = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** GeoNames cities dump (tab-separated, no header) -> place records. */
function parseGeonamesCities(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    out.push({
      gid: Number(f[0]),
      name: f[1],
      ascii: f[2],
      alt: f[3],
      lat: Number(f[4]),
      lon: Number(f[5]),
      fcode: f[7],
      cc: f[8],
      admin1Code: f[10],
      pop: Number(f[14]) || 0,
    });
  }
  return out;
}

const GEONAMES_CONTINENTS = {
  AF: 'Africa',
  AN: 'Antarctica',
  AS: 'Asia',
  EU: 'Europe',
  NA: 'North America',
  OC: 'Oceania',
  SA: 'South America',
};

/** countryInfo.txt -> Map(iso2 -> {iso3, name, continent}). */
function parseCountryInfo(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    out.set(f[0], {
      iso3: f[1],
      name: f[4],
      continent: GEONAMES_CONTINENTS[f[8]] ?? null,
    });
  }
  return out;
}

/** admin1CodesASCII.txt -> Map("CC.code" -> name). */
function parseAdmin1(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const [code, name] = line.split('\t');
    out.set(code, name);
  }
  return out;
}

/**
 * Previous pack's cities.json (v1 objects or v2 rows) -> plain objects, or []
 * when there is no previous pack.
 */
function readPreviousCities(file) {
  if (!existsSync(file)) return [];
  const json = JSON.parse(readFileSync(file, 'utf8'));
  if (json.version === 1) return json.cities;
  return json.cities.map((row) =>
    Object.fromEntries(json.fields.map((f, i) => [f, row[i]])),
  );
}

/** Levenshtein edit distance (short names only). */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[b.length];
}

/**
 * How well a GeoNames place carries `name`: 0 = primary/ascii name, 1 =
 * alternate name, 2 = prefix of either (e.g. "Washington" / "Washington,
 * D.C."), 3 = within 2 edits (Natural Earth spellings like "Shenyeng"),
 * Infinity = no match. `maxTier` stops early.
 */
function nameMatchTier(name, gn, maxTier = 3) {
  const key = foldName(name);
  if (!key) return Infinity;
  const primary = [gn.name, gn.ascii].map(foldName);
  if (primary.includes(key)) return 0;
  if (maxTier < 1) return Infinity;
  const alts = gn.alt ? gn.alt.split(',').map(foldName) : [];
  if (alts.includes(key)) return 1;
  if (maxTier < 2) return Infinity;
  const all = [...primary, ...alts];
  const prefix = (n) =>
    n.length >= 4 &&
    key.length >= 4 &&
    (n.startsWith(key) || key.startsWith(n));
  if (all.some(prefix)) return 2;
  if (maxTier < 3 || key.length < 5) return Infinity;
  return all.some(
    (n) => Math.abs(n.length - key.length) <= 2 && editDistance(n, key) <= 2,
  )
    ? 3
    : Infinity;
}

/** 1°-bucket spatial index for "places near (lat, lon)" lookups; `.add` grows it. */
function bucketIndex(records) {
  const buckets = new Map();
  const keyOf = (lat, lon) => `${Math.floor(lat)}_${Math.floor(lon)}`;
  const add = (r) => {
    const k = keyOf(r.lat, r.lon);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  };
  records.forEach(add);
  const near = (lat, lon) => {
    const out = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        out.push(...(buckets.get(keyOf(lat + dy, lon + dx)) ?? []));
    return out;
  };
  near.add = add;
  return near;
}

/**
 * Inside Airbnb listings summary -> median nightly price (local currency) of
 * entire homes for monthly stays (min nights >= 28), relaxed to >= 7 when
 * fewer than IAB_MIN_N listings qualify. Null when still too few.
 */
function summarizeListings(csvText) {
  const rows = parseCsv(csvText);
  const pick = (minNights) =>
    rows
      .filter(
        (r) =>
          r.room_type === 'Entire home/apt' &&
          Number(r.minimum_nights) >= minNights,
      )
      .map((r) => Number(String(r.price).replace(/[^0-9.]/g, '')))
      .filter((p) => Number.isFinite(p) && p > 0);
  let prices = pick(28);
  let rule = 'min28';
  if (prices.length < IAB_MIN_N) {
    prices = pick(7);
    rule = 'min7';
    if (prices.length < IAB_MIN_N_RELAXED)
      return { n: prices.length, rule: null };
  }
  return { n: prices.length, rule, medianNightly: median(prices) };
}

/**
 * City selection: match the previous pack (id registry) to GeoNames, select
 * pop >= MIN_POP ∪ EXTRA_TOWNS ∪ legacy matches, metro-dedupe, and assemble
 * city records with stable ids (airports/housing are added later).
 */
function selectCities({ places, iso2To3, admin1Names, anomalies }) {
  const previous = readPreviousCities(path.join(OUT_DIR, 'cities.json'));
  // --- Legacy ids: previous pack cities matched to GeoNames places ---
  // Users hold ids in localStorage (pins, home city, plan stays), so every
  // previous id survives: matched to a GeoNames place (same country, name
  // match, <= LEGACY_MATCH_KM) it keeps its id and display fields and takes
  // the GeoNames population; unmatched it is carried over as-is.
  const placeIso3 = (p) => {
    const iso3 = iso2To3.get(p.cc) ?? null;
    return GN_ISO3_OVERRIDES[iso3] ?? iso3;
  };
  const nearPlaces = bucketIndex(places);
  const claimed = new Map(); // gid -> legacy city + match tier
  const legacyUnmatched = [];
  // Best candidate: strongest name tier, then largest population (so a city
  // wins over its own districts), then nearest. Same country first; a second
  // pass allows any country (disputed/overseas areas coded differently).
  const bestPlace = (old, sameCountry) => {
    let best = null;
    for (const gn of nearPlaces(old.lat, old.lon)) {
      if (claimed.has(gn.gid)) continue;
      if (sameCountry && placeIso3(gn) !== old.iso3) continue;
      const d = haversineKm([old.lat, old.lon], [gn.lat, gn.lon]);
      if (d > LEGACY_MATCH_KM) continue;
      const tier = nameMatchTier(old.name, gn);
      if (tier === Infinity) continue;
      if (
        !best ||
        tier < best.tier ||
        (tier === best.tier &&
          (gn.pop > best.gn.pop || (gn.pop === best.gn.pop && d < best.d)))
      )
        best = { gn, d, tier };
    }
    return best;
  };
  // Records that already carry their GeoNames id keep it (exact, stable);
  // only the rest (Natural Earth legacy) go through the name/distance match.
  const placesByGid = new Map(places.map((p) => [p.gid, p]));
  const byGid = previous.filter((old) => placesByGid.has(old.gid));
  for (const old of byGid) claimed.set(old.gid, { ...old, tier: 0 });
  const toMatch = previous.filter(
    (old) => !placesByGid.has(old.gid) && old.origin !== 'manual', // manual: re-added below
  );
  for (const old of toMatch.sort((a, b) => b.pop - a.pop)) {
    const best = bestPlace(old, true) ?? bestPlace(old, false);
    if (best) claimed.set(best.gn.gid, { ...old, tier: best.tier });
    else legacyUnmatched.push(old);
  }
  console.log(
    `legacy ids: ${previous.length} previous, ${claimed.size} matched to GeoNames, ` +
      `${legacyUnmatched.length} carried over unmatched`,
  );

  // --- Cities: GeoNames pop >= MIN_POP ∪ EXTRA_TOWNS ∪ legacy matches ---
  const extraIds = new Set(Object.keys(EXTRA_TOWNS).map(Number));
  const selected = places.filter(
    (p) =>
      claimed.has(p.gid) ||
      extraIds.has(p.gid) ||
      (p.pop >= MIN_POP && !EXCLUDED_FEATURE_CODES.has(p.fcode)),
  );
  for (const gid of extraIds)
    if (!selected.some((p) => p.gid === gid))
      anomalies.push(
        `EXTRA_TOWNS id ${gid} (${EXTRA_TOWNS[gid]}) not in cities1000`,
      );

  const usedIds = new Set(previous.map((c) => c.id));
  for (const m of MANUAL_CITIES) usedIds.add(m.id);
  const newId = (name, admin1, iso3) => {
    const lower = iso3.toLowerCase();
    let id = `${slugify(name)}-${lower}`;
    if (usedIds.has(id) && admin1)
      id = `${slugify(name)}-${slugify(admin1)}-${lower}`;
    const base = id;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);
    return id;
  };

  // --- Metro dedupe (before id assignment, so dropped places take no ids) ---
  // Descending population; a candidate survives when protected or when no
  // strictly more populous kept city of the same country is within
  // METRO_DEDUPE_KM. Legacy-unmatched and manual records take part as
  // protected anchors.
  const candidates = [
    ...selected.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      pop: p.pop,
      iso3: placeIso3(p),
      key: `gn${p.gid}`,
      name: p.name,
      place: p,
      protect: claimed.has(p.gid) || extraIds.has(p.gid) || p.fcode === 'PPLC',
    })),
    ...[...legacyUnmatched, ...MANUAL_CITIES].map((c) => ({
      lat: c.lat,
      lon: c.lon,
      pop: c.pop,
      iso3: c.iso3,
      key: c.id,
      name: c.name,
      protect: true,
    })),
  ].sort(
    (a, b) => b.pop - a.pop || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const keptNear = bucketIndex([]);
  const kept = [];
  const metroMerged = []; // [dropped name, kept name] for the report
  for (const c of candidates) {
    const near = keptNear(c.lat, c.lon).find(
      (k) =>
        k.iso3 === c.iso3 &&
        k.pop > c.pop &&
        haversineKm([c.lat, c.lon], [k.lat, k.lon]) <= METRO_DEDUPE_KM,
    );
    if (near && !c.protect) {
      metroMerged.push([`${c.name} (${c.iso3})`, near.name]);
      continue;
    }
    kept.push(c);
    keptNear.add(c);
  }
  const keptPlaces = new Set(kept.filter((c) => c.place).map((c) => c.place));
  console.log(
    `metro dedupe (${METRO_DEDUPE_KM} km): ${candidates.length} candidates, ` +
      `${metroMerged.length} merged into a larger neighbour`,
  );
  if (process.env.GEV_LOG_METRO_MERGES)
    for (const [dropped, into] of metroMerged)
      console.log(`  merged ${dropped} -> ${into}`);

  const cityRecords = [];
  // New GeoNames ids are assigned in population order, so rebuilds are stable.
  selected.sort((a, b) => b.pop - a.pop || a.gid - b.gid);
  for (const p of selected) {
    if (!keptPlaces.has(p)) continue;
    const iso3 = placeIso3(p);
    if (!iso3) {
      anomalies.push(`no ISO3 for GeoNames country ${p.cc} (${p.name})`);
      continue;
    }
    const legacy = claimed.get(p.gid);
    const admin1 = admin1Names.get(`${p.cc}.${p.admin1Code}`) ?? null;
    cityRecords.push(
      legacy
        ? {
            id: legacy.id,
            // Keep the name users already see, unless it only matched as a
            // misspelling (tier 3, e.g. Natural Earth "Shenyeng").
            name: legacy.tier === 3 ? p.name : legacy.name.replace(/\s+/g, ' '),
            iso3,
            admin1: legacy.admin1,
            lat: legacy.lat,
            lon: legacy.lon,
            pop: p.pop,
            capital: Boolean(legacy.capital) || p.fcode === 'PPLC',
            origin: 'geonames',
            gn: p,
          }
        : {
            id: newId(p.ascii || p.name, admin1, iso3),
            name: p.name,
            iso3,
            admin1,
            lat: round4(p.lat),
            lon: round4(p.lon),
            pop: p.pop,
            capital: p.fcode === 'PPLC',
            origin: 'geonames',
            gn: p,
          },
    );
  }
  for (const old of legacyUnmatched)
    cityRecords.push({
      id: old.id,
      name: old.name,
      iso3: old.iso3,
      admin1: old.admin1,
      lat: old.lat,
      lon: old.lon,
      pop: old.pop,
      capital: Boolean(old.capital),
      origin: old.origin ?? 'naturalearth',
    });
  for (const m of MANUAL_CITIES) cityRecords.push({ ...m, origin: 'manual' });

  return {
    cityRecords,
    previous,
    claimed,
    legacyUnmatched,
    metroMerged,
    extraIds,
  };
}

/**
 * Seasonality v3: NASA POWER climatology per MERRA-2 grid cell for every
 * city, fetched through the regional endpoint in 10° tiles.
 */
async function fetchSeasonalityGrid(cities, anomalies) {
  // --- Seasonality v3: NASA POWER climatology per grid cell ---
  // Cities are keyed to their MERRA-2 cell (0.5° × 0.625°); cells are fetched
  // through the regional endpoint in 10° tiles, one call per tile and
  // parameter, cached under .gev-cache/. A cell is dropped (its cities lose
  // coverage) if any month is NASA's -999 fill value or its tile failed.
  const cellOf = (lat, lon) => {
    const i = Math.round(lat / POWER_LAT_STEP);
    let j = Math.round(lon / POWER_LON_STEP);
    if (j * POWER_LON_STEP >= 180) j -= Math.round(360 / POWER_LON_STEP);
    return `${i}_${j}`;
  };
  const cellKeys = new Set(cities.map((c) => cellOf(c.lat, c.lon)));
  const tiles = new Map(); // "a_b" -> {latMin, lonMin}
  for (const key of cellKeys) {
    const [i, j] = key.split('_').map(Number);
    const latMin = Math.min(
      90 - POWER_TILE_DEG,
      Math.floor((i * POWER_LAT_STEP) / POWER_TILE_DEG) * POWER_TILE_DEG,
    );
    const lonMin = Math.min(
      180 - POWER_TILE_DEG,
      Math.floor((j * POWER_LON_STEP) / POWER_TILE_DEG) * POWER_TILE_DEG,
    );
    tiles.set(`${latMin}_${lonMin}`, { latMin, lonMin });
  }
  console.log(
    `seasonality: ${cellKeys.size} grid cells in ${tiles.size} tiles ` +
      `(${tiles.size * POWER_PARAMS.length} regional calls, cached after first run)`,
  );
  mkdirSync(POWER_CACHE_DIR, { recursive: true });
  const cellValues = new Map(); // cell -> {T2M: {...}, PRECTOTCORR: {...}}
  let powerApiVersion = null;
  let powerRange = null;
  let powerCallsMade = 0;
  let tileFailures = 0;
  const tileJobs = [...tiles.values()].flatMap((t) =>
    POWER_PARAMS.map((param) => ({ ...t, param })),
  );
  for (let i = 0; i < tileJobs.length; i += POWER_CONCURRENCY) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      tileJobs
        .slice(i, i + POWER_CONCURRENCY)
        .map(async ({ latMin, lonMin, param }) => {
          const cachePath = path.join(
            POWER_CACHE_DIR,
            `regional_${param}_${latMin}_${lonMin}.json`,
          );
          const hasParam = (json) =>
            json?.features?.length > 0 &&
            json.features.every((f) => f?.properties?.parameter?.[param]);
          let body;
          try {
            body = JSON.parse(readFileSync(cachePath, 'utf8'));
            if (!hasParam(body)) throw new Error('cached tile lacks parameter');
          } catch {
            const url =
              `https://power.larc.nasa.gov/api/temporal/climatology/regional` +
              `?latitude-min=${latMin}&latitude-max=${latMin + POWER_TILE_DEG}` +
              `&longitude-min=${lonMin}&longitude-max=${lonMin + POWER_TILE_DEG}` +
              `&parameters=${param}&community=RE&format=JSON`;
            try {
              powerCallsMade++;
              body = await fetchWithRetry(url, {
                headers: { 'user-agent': POWER_USER_AGENT },
                maxRetries: POWER_MAX_RETRIES,
                timeoutMs: 120000,
                validate: async (res) => {
                  const json = await res.json();
                  if (!hasParam(json))
                    throw new Error(
                      `invalid response from ${url}: no ${param} values in features`,
                    );
                  return json;
                },
              });
              writeFileSync(cachePath, JSON.stringify(body));
            } catch (err) {
              tileFailures++;
              anomalies.push(
                `NASA POWER ${param} tile ${latMin},${lonMin} failed: ${err.message}`,
              );
              return;
            }
          }
          if (!powerApiVersion) {
            powerApiVersion = body.header?.api?.version ?? null;
            powerRange = body.header?.range ?? null;
          }
          for (const f of body.features) {
            const [lon, lat] = f.geometry.coordinates;
            const key = cellOf(lat, lon);
            if (!cellKeys.has(key)) continue;
            if (!cellValues.has(key)) cellValues.set(key, {});
            cellValues.get(key)[param] = f.properties.parameter[param];
          }
        }),
    );
    if ((i / POWER_CONCURRENCY) % 20 === 0)
      console.log(
        `seasonality: ${Math.min(i + POWER_CONCURRENCY, tileJobs.length)}/${tileJobs.length} tile calls`,
      );
    // eslint-disable-next-line no-await-in-loop
    if (powerCallsMade) await sleep(POWER_BATCH_DELAY_MS);
  }

  const cellIndex = new Map(); // cell key -> index into cellsOut
  const cellsOut = [];
  for (const key of [...cellKeys].sort()) {
    const t2m = cellValues.get(key)?.T2M;
    const precip = cellValues.get(key)?.PRECTOTCORR;
    if (!t2m || !precip) continue;
    const flat = [];
    for (let m = 0; m < 12; m++) {
      const tempC = t2m[MONTH_ABBR[m]];
      const precipPerDay = precip[MONTH_ABBR[m]];
      if (
        tempC === -999 ||
        precipPerDay === -999 ||
        !Number.isFinite(tempC) ||
        !Number.isFinite(precipPerDay)
      )
        break;
      const precipMm = precipPerDay * DAYS_IN_MONTH[m];
      flat.push(
        comfortScore(tempC, precipMm),
        round1(tempC),
        Math.round(precipMm),
      );
    }
    if (flat.length !== 36) continue;
    cellIndex.set(key, cellsOut.length);
    cellsOut.push(flat);
  }
  const seasonalityCities = {};
  const seasonSkipped = [];
  for (const c of cities) {
    const idx = cellIndex.get(cellOf(c.lat, c.lon));
    if (idx === undefined) seasonSkipped.push(c.id);
    else seasonalityCities[c.id] = idx;
  }
  const seasonCovered = Object.keys(seasonalityCities).length;

  return {
    cellsOut,
    seasonalityCities,
    seasonCovered,
    seasonSkipped,
    tiles,
    powerApiVersion,
    powerRange,
    powerCallsMade,
    tileFailures,
  };
}

/**
 * Housing: Inside Airbnb medians where a city dataset exists, a log-linear
 * model (src/data/cityIntelHousingModel.js) elsewhere. Sets `city.housing`.
 */
async function buildHousing({
  cities,
  fcrf,
  priceLevel,
  gnCountries,
  anomalies,
}) {
  // --- Housing: Inside Airbnb observed + log-linear model elsewhere ---
  // Latest World Bank exchange rate (not the price-level year: Argentina's
  // price level is from 2021, when ARS/USD was ~13× lower than in 2025).
  const fxFor = (iso3) => {
    const byYear = fcrf.byCountry.get(iso3);
    const year = byYear && Math.max(...byYear.keys());
    return year >= MIN_METRIC_YEAR
      ? { year, lcuPerUsd: byYear.get(year) }
      : null;
  };
  const iabIndex = await cachedFetch(
    IAB_INDEX_URL,
    'insideairbnb-get-the-data.html',
    {
      validate: (text) => {
        if (!text.includes('/visualisations/listings.csv'))
          throw new Error('no listings.csv links (page layout changed?)');
      },
    },
  );
  const latestDataset = new Map(); // "country/region/city" -> {url, date}
  for (const url of new Set(
    iabIndex.text.match(
      /https:\/\/data\.insideairbnb\.com\/[^"'\s]+\/visualisations\/listings\.csv/g,
    ) ?? [],
  )) {
    const parts = decodeURIComponent(
      url.replace('https://data.insideairbnb.com/', ''),
    ).split('/');
    if (parts.length !== 6) continue; // country-wide datasets (no city)
    const [country, region, city, date] = parts;
    const key = `${country}/${region}/${city}`;
    if (!latestDataset.has(key) || latestDataset.get(key).date < date)
      latestDataset.set(key, { url, country, region, city, date });
  }
  const citiesByIso3 = new Map();
  for (const c of cities) {
    if (!citiesByIso3.has(c.iso3)) citiesByIso3.set(c.iso3, []);
    citiesByIso3.get(c.iso3).push(c);
  }
  const iso3BySlug = new Map(
    [...gnCountries.values()].map((c) => [slugify(c.name), c.iso3]),
  );
  const iabUsed = [];
  const iabSkipped = [];
  let iabAttempted = 0; // matched a pack city and has an exchange rate
  const observedHousing = new Map(); // city id -> {usd, n, rule}
  for (const ds of [...latestDataset.values()].sort((a, b) =>
    a.url < b.url ? -1 : 1,
  )) {
    const label = `${ds.country}/${ds.region}/${ds.city}`;
    if (IAB_REGION_DATASETS.has(ds.city)) {
      iabSkipped.push(`${label} (region dataset)`);
      continue;
    }
    const iso3 =
      IAB_COUNTRY_ISO3[ds.country] ?? iso3BySlug.get(slugify(ds.country));
    const wanted = foldName(IAB_CITY_ALIASES[ds.city] ?? ds.city);
    const candidates = (citiesByIso3.get(iso3) ?? []).filter(
      (c) =>
        (foldName(c.name) === wanted ||
          (c.gn && nameMatchTier(wanted, c.gn, 1) <= 1)) &&
        // US datasets carry the state code: require it to match.
        (iso3 !== 'USA' || c.gn?.admin1Code === ds.region.toUpperCase()),
    );
    const city = candidates.sort((a, b) => b.pop - a.pop)[0];
    if (!city) {
      iabSkipped.push(`${label} (no matching pack city)`);
      continue;
    }
    const fx = fxFor(iso3);
    if (!fx) {
      iabSkipped.push(`${label} (no World Bank exchange rate for ${iso3})`);
      continue;
    }
    iabAttempted++;
    const summaryPath = path.join(
      CACHE_DIR,
      'insideairbnb',
      `${slugify(label)}-${ds.date}.json`,
    );
    let summary;
    try {
      summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    } catch {
      console.log(`fetching ${ds.url}`);
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetchWithRetry(ds.url, { timeoutMs: 180000 });
        // eslint-disable-next-line no-await-in-loop
        const text = await res.text();
        assertValidBody(ds.url, () =>
          requireCsvColumns(text, ['room_type', 'price', 'minimum_nights']),
        );
        summary = {
          ...summarizeListings(text),
          sha256: sha256(Buffer.from(text)),
        };
        mkdirSync(path.dirname(summaryPath), { recursive: true });
        writeFileSync(summaryPath, JSON.stringify(summary));
      } catch (err) {
        iabSkipped.push(`${label} (fetch failed: ${err.message})`);
        continue;
      }
    }
    if (!summary.rule) {
      iabSkipped.push(`${label} (only ${summary.n} qualifying listings)`);
      continue;
    }
    const usd = Math.round((summary.medianNightly * 30) / fx.lcuPerUsd);
    observedHousing.set(city.id, { usd, n: summary.n, rule: summary.rule });
    iabUsed.push({
      cityId: city.id,
      url: ds.url,
      snapshot: ds.date,
      n: summary.n,
      rule: summary.rule,
      medianNightlyLocal: summary.medianNightly,
      fx: { year: fx.year, lcuPerUsd: round4(fx.lcuPerUsd) },
      monthlyUsd: usd,
      sha256: summary.sha256,
    });
  }
  const observedRows = cities
    .filter((c) => observedHousing.has(c.id) && priceLevel.get(c.iso3))
    .map((c) => ({
      usd: observedHousing.get(c.id).usd,
      x: housingFeatures(priceLevel.get(c.iso3).value, c.pop, c.capital),
    }));
  const model = fitHousingModel(observedRows);
  if (model.error)
    anomalies.push(
      `housing model skipped (${model.error}): only Inside Airbnb cities get housing`,
    );
  for (const c of cities) {
    const obs = observedHousing.get(c.id);
    const pl = priceLevel.get(c.iso3);
    c.housing = obs
      ? [obs.usd, 'insideairbnb', obs.n, obs.rule]
      : pl && !model.error
        ? [
            Math.round(
              Math.exp(
                dot(model.beta, housingFeatures(pl.value, c.pop, c.capital)),
              ),
            ),
            'model',
          ]
        : null;
  }
  return { iabIndex, iabUsed, iabSkipped, iabAttempted, observedRows, model };
}

async function main() {
  const mainStart = Date.now();
  const anomalies = [];

  // --- Natural Earth (admin-0 + tiny-countries, continent/subregion) ---
  const neSha = UPDATE_PINS ? await ghLatestCommitSha(NE_REPO) : NE_SHA;
  const rawBase = `https://raw.githubusercontent.com/${NE_REPO}/${neSha}/geojson`;
  const [admin0, tiny] = await Promise.all([
    cachedFetch(
      `${rawBase}/ne_110m_admin_0_countries.geojson`,
      'ne-admin0.geojson',
      { json: true, validate: requireFeatureCollection },
    ),
    cachedFetch(
      `${rawBase}/ne_110m_admin_0_tiny_countries.geojson`,
      'ne-tiny.geojson',
      { json: true, validate: requireFeatureCollection },
    ),
  ]);

  // --- OurAirports ---
  const airportsSha = UPDATE_PINS
    ? await ghLatestCommitSha(OURAIRPORTS_REPO)
    : OURAIRPORTS_SHA;
  if (UPDATE_PINS)
    console.log(
      `--update-pins: latest HEAD shas (paste into NE_SHA / OURAIRPORTS_SHA)\n` +
        `  NE_SHA = '${neSha}'\n` +
        `  OURAIRPORTS_SHA = '${airportsSha}'`,
    );
  const airportsRaw = await cachedFetch(
    `https://raw.githubusercontent.com/${OURAIRPORTS_REPO}/${airportsSha}/airports.csv`,
    'ourairports.csv',
    {
      validate: (text) =>
        requireCsvColumns(text, [
          'type',
          'latitude_deg',
          'longitude_deg',
          'iso_country',
          'scheduled_service',
          'iata_code',
        ]),
    },
  );
  const airportRows = parseCsv(airportsRaw.text);

  // --- GeoNames (unversioned: download date + sha256 recorded) ---
  const [gnZip, gnAdmin1, gnCountryInfo] = await Promise.all([
    cachedFetchBuffer(
      `${GEONAMES_BASE}/cities1000.zip`,
      'geonames-cities1000.zip',
      { validate: requireGeonamesZip },
    ),
    cachedFetchBuffer(
      `${GEONAMES_BASE}/admin1CodesASCII.txt`,
      'geonames-admin1CodesASCII.txt',
      {
        validate: (buf) => {
          if (
            !/^[A-Z]{2}\.[^\t\n]+\t[^\t\n]+\t/.test(
              buf.toString('utf8', 0, 200),
            )
          )
            throw new Error(
              'not an admin1CodesASCII TSV ("CC.code<TAB>name<TAB>…")',
            );
        },
      },
    ),
    cachedFetchBuffer(
      `${GEONAMES_BASE}/countryInfo.txt`,
      'geonames-countryInfo.txt',
      {
        validate: (buf) => {
          if (!buf.toString('utf8').includes('#ISO\tISO3\t'))
            throw new Error('countryInfo header "#ISO<TAB>ISO3" not found');
        },
      },
    ),
  ]);
  const places = parseGeonamesCities(
    unzipFirstEntry(gnZip.buf).toString('utf8'),
  );
  const admin1Names = parseAdmin1(gnAdmin1.buf.toString('utf8'));
  const gnCountries = parseCountryInfo(gnCountryInfo.buf.toString('utf8'));
  console.log(`geonames: ${places.length} places (cities1000)`);

  // --- World Bank country list ---
  const wbCountriesRaw = await cachedFetch(
    'https://api.worldbank.org/v2/country?format=json&per_page=400',
    'wb-countries.json',
    { json: true, validate: requireWorldBankPage },
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
  const prvt = await fetchIndicatorSeries('PA.NUS.PRVT.PP');
  const fcrf = await fetchIndicatorSeries('PA.NUS.FCRF');
  rebaseEuroFcrf(fcrf.byCountry, anomalies);
  series.priceLevel = derivedPriceLevel(
    prvt.byCountry,
    fcrf.byCountry,
    MIN_METRIC_YEAR,
    anomalies,
  );
  wbSourceMeta['PA.NUS.PRVT.PP'] = { url: prvt.url, sha256: prvt.sha256 };
  wbSourceMeta['PA.NUS.FCRF'] = { url: fcrf.url, sha256: fcrf.sha256 };

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

  // --- iso2 -> iso3 (GeoNames countryInfo, WB list as fallback) ---
  const iso2To3 = new Map();
  for (const [iso3, c] of wbCountries) if (c.iso2) iso2To3.set(c.iso2, iso3);
  for (const [iso2, c] of gnCountries) iso2To3.set(iso2, c.iso3);
  iso2To3.set('XK', 'XKX'); // Kosovo: GeoNames XKX already, WB pseudo-code
  const continentByIso3 = new Map(
    [...gnCountries.values()].map((c) => [c.iso3, c.continent]),
  );
  const gnCountryNameByIso3 = new Map(
    [...gnCountries.values()].map((c) => [c.iso3, c.name]),
  );

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
      // Cheap box test before haversine (~12k cities × ~4k airports): 1° lat
      // ≈ 111 km, and a generous lon window that wraps the antimeridian.
      const dLon = Math.abs(((a.lon - lon + 540) % 360) - 180);
      if (
        Math.abs(a.lat - lat) > 1 ||
        dLon > 2.5 / Math.max(0.05, Math.cos((lat * Math.PI) / 180))
      )
        continue;
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

  const {
    cityRecords,
    previous,
    claimed,
    legacyUnmatched,
    metroMerged,
    extraIds,
  } = selectCities({ places, iso2To3, admin1Names, anomalies });

  const usedIso3 = new Set(cityRecords.map((c) => c.iso3));
  console.log(`airports: nearest for ${cityRecords.length} cities`);
  const cities = cityRecords.map((c) => ({
    ...c,
    airport: nearestAirport(c.lat, c.lon, c.iso3),
  }));
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
      name: wb?.name ?? geo?.name ?? gnCountryNameByIso3.get(iso3) ?? iso3,
      metrics,
    };
    if (wb?.iso2) entry.iso2 = wb.iso2;
    if (wb?.region) entry.region = wb.region;
    const continent = geo?.continent ?? continentByIso3.get(iso3);
    if (continent) entry.continent = continent;
    if (geo?.subregion) entry.subregion = geo.subregion;
    countries[iso3] = entry;
  }

  const {
    cellsOut,
    seasonalityCities,
    seasonCovered,
    seasonSkipped,
    tiles,
    powerApiVersion,
    powerRange,
    powerCallsMade,
    tileFailures,
  } = await fetchSeasonalityGrid(cities, anomalies);

  const { iabIndex, iabUsed, iabSkipped, iabAttempted, observedRows, model } =
    await buildHousing({
      cities,
      fcrf,
      priceLevel: series.priceLevel,
      gnCountries,
      anomalies,
    });

  // --- Quality gates: fail before writing a degraded pack ---
  const failures = [];
  if (tileFailures > MAX_POWER_TILE_FAILURES)
    failures.push(`${tileFailures} NASA POWER tile(s) failed`);
  if (seasonCovered / cities.length < MIN_SEASONALITY_COVERAGE)
    failures.push(
      `seasonality covers ${seasonCovered}/${cities.length} cities (< ${MIN_SEASONALITY_COVERAGE * 100}%)`,
    );
  if (iabUsed.length < MIN_IAB_USABLE_SHARE * iabAttempted)
    failures.push(
      `only ${iabUsed.length}/${iabAttempted} attempted Inside Airbnb datasets usable (< ${MIN_IAB_USABLE_SHARE * 100}%)`,
    );
  if (failures.length) {
    for (const a of anomalies) console.error(`  - ${a}`);
    throw new Error(`pack not written: ${failures.join('; ')}`);
  }

  // --- Write output ---
  mkdirSync(OUT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString().slice(0, 10);

  const CITY_FIELDS = [
    'id',
    'name',
    'iso3',
    'admin1',
    'lat',
    'lon',
    'pop',
    'capital',
    'airport',
    'housing',
    'origin',
    'gid',
  ];
  const citiesOut = {
    version: 2,
    generatedAt,
    count: cities.length,
    fields: CITY_FIELDS,
    notes: {
      capital: '1 = national capital',
      airport: '[iata, km, "large"|"medium"] | null',
      housing:
        '[monthlyUsd, "insideairbnb", listings, "min28"|"min7"] | [monthlyUsd, "model"] | null',
      origin:
        '"geonames" | "naturalearth" (legacy record, unmatched) | "manual"',
      gid: 'GeoNames id (the stable key rebuilds match on) | null',
      country: 'not stored; name comes from countries.json',
    },
    cities: cities.map((c) => [
      c.id,
      c.name,
      c.iso3,
      c.admin1,
      c.lat,
      c.lon,
      c.pop,
      c.capital ? 1 : 0,
      c.airport ? [c.airport.iata, c.airport.km, c.airport.type] : null,
      c.housing,
      c.origin,
      c.gn?.gid ?? null,
    ]),
  };
  const countriesOut = {
    version: 1,
    generatedAt,
    buildYear: BUILD_YEAR,
    maxAgeYears: MAX_AGE_YEARS,
    indicators: INDICATORS,
    countries,
  };
  const seasonalityOut = {
    version: 3,
    window: '2001-2020',
    source: 'NASA POWER monthly climatology (MERRA-2)',
    license: 'Public (NASA POWER; acknowledgement requested)',
    grid: { latStep: POWER_LAT_STEP, lonStep: POWER_LON_STEP },
    cellFields: ['score', 'tempC', 'precipMm'],
    note: 'cells[i] = 12 months × [score, tempC, precipMm], flattened; cities maps city id -> cell index',
    cells: cellsOut,
    cities: seasonalityCities,
  };

  const [b0, b1, b2, b3] = model.beta ?? [];
  const sourceOut = {
    generatedAt,
    inputs: {
      geonamesCities: {
        url: `${GEONAMES_BASE}/cities1000.zip`,
        downloadedAt: gnZip.downloadedAt,
        sha256: gnZip.sha256,
        license: 'CC BY 4.0',
        attribution: 'GeoNames (geonames.org)',
        note:
          `Unversioned dump: pinned by download date + sha256. Selection: population >= ${MIN_POP} ` +
          `(feature codes ${[...EXCLUDED_FEATURE_CODES].join('/')} excluded), plus ${extraIds.size} ` +
          'curated lifestyle towns (EXTRA_TOWNS, hand-picked: no open destination signal exists), ' +
          'plus every previous-pack city (id registry). Metro dedupe: a place within ' +
          `${METRO_DEDUPE_KM} km of a more populous kept city in the same country is dropped ` +
          '(capitals, curated towns and previous ids exempt).',
        metroDedupeKm: METRO_DEDUPE_KM,
        metroMerged: metroMerged.length,
      },
      geonamesAdmin1: {
        url: `${GEONAMES_BASE}/admin1CodesASCII.txt`,
        downloadedAt: gnAdmin1.downloadedAt,
        sha256: gnAdmin1.sha256,
        license: 'CC BY 4.0',
        attribution: 'GeoNames (geonames.org)',
      },
      geonamesCountryInfo: {
        url: `${GEONAMES_BASE}/countryInfo.txt`,
        downloadedAt: gnCountryInfo.downloadedAt,
        sha256: gnCountryInfo.sha256,
        license: 'CC BY 4.0',
        attribution: 'GeoNames (geonames.org)',
      },
      legacyCities: {
        previousCities: previous.length,
        matchedToGeonames: claimed.size,
        carriedOverUnmatched: legacyUnmatched.length,
        note:
          'Previous-pack city ids are preserved (users store them). Legacy records were built from ' +
          `Natural Earth 10m populated places (public domain) @ ${NE_SHA}; unmatched ones keep ` +
          'their Natural Earth fields (origin "naturalearth").',
      },
      manualCities: {
        cities: MANUAL_CITIES.map((m) => m.id),
        note: 'Not in any GeoNames cities file; coordinates set by hand, population unknown (0).',
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
          'geography, see MANUAL_GEO in build-city-intel.mjs). Other territories ' +
          'missing from both fall back to the GeoNames continent (no subregion).',
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
        note:
          'priceLevel is derived: PA.NUS.PRVT.PP ÷ PA.NUS.FCRF, same year, both non-null; ' +
          `values outside ${PRICE_LEVEL_RANGE.join('-')} × US are dropped (currency/rate-regime mismatch). ` +
          `FCRF rebased to EUR for ${Object.keys(EURO_REBASE).join(', ')} (PRVT.PP already in EUR).`,
      },
      worldBankCountryList: {
        url: 'https://api.worldbank.org/v2/country?format=json&per_page=400',
        accessDate: generatedAt,
        sha256: wbCountriesRaw.sha256,
        license: 'CC BY 4.0',
        attribution: 'World Bank',
      },
      nasaPowerClimatology: {
        url:
          'https://power.larc.nasa.gov/api/temporal/climatology/regional?parameters={T2M|PRECTOTCORR}' +
          '&community=RE&format=JSON&latitude-min={lat}&latitude-max={lat+10}&longitude-min={lon}&longitude-max={lon+10}',
        apiVersion: powerApiVersion,
        range: powerRange,
        fillValue: -999,
        license: 'Public (NASA POWER data are freely available)',
        attribution:
          'These data were obtained from the NASA Langley Research Center (LaRC) ' +
          'POWER Project funded through the NASA Earth Science/Applied Science Program.',
        acknowledgementUrl: 'https://power.larc.nasa.gov/docs/methodology/',
        citiesCovered: seasonCovered,
        citiesSkipped: seasonSkipped.length,
        gridCells: cellsOut.length,
        regionalTiles: tiles.size,
        note:
          'Each city uses its MERRA-2 grid cell (0.5° lat × 0.625° lon). Cells come from the ' +
          'regional endpoint in 10° tiles, one call per tile and parameter, cached under .gev-cache/. ' +
          'A city is skipped when any month of its cell is the -999 fill value or the tile fetch failed.',
      },
      insideAirbnb: {
        url: IAB_INDEX_URL,
        accessDate: generatedAt,
        sha256: iabIndex.sha256,
        license: 'CC BY 4.0',
        attribution: 'Inside Airbnb (insideairbnb.com)',
        method:
          'Latest listings summary per city dataset; room_type "Entire home/apt", ' +
          `minimum_nights >= 28 (relaxed to >= 7 when fewer than ${IAB_MIN_N} listings; skipped ` +
          `below ${IAB_MIN_N_RELAXED}), valid price. Monthly = median nightly × 30, local currency ` +
          'converted with the latest World Bank PA.NUS.FCRF year.',
        datasets: iabUsed,
        skipped: iabSkipped,
      },
      housingModel: model.error
        ? {
            formula:
              'ln(monthlyUsd) = a + b·ln(countryPriceLevel) + c·ln(max(pop, 1000)) + d·capital',
            skipped: model.error,
            fittedOn: 0,
            note: 'Model skipped: only Inside Airbnb cities carry housing in this build.',
          }
        : {
            formula:
              'ln(monthlyUsd) = a + b·ln(countryPriceLevel) + c·ln(max(pop, 1000)) + d·capital',
            coefficients: {
              a: round4(b0),
              b: round4(b1),
              c: round4(b2),
              d: round4(b3),
            },
            fittedOn: observedRows.length,
            r2: round3(model.r2),
            looMedianAbsPctError: round1(model.looMedianAbsPctError),
            note:
              'Predicts monthly housing for every city without an Inside Airbnb median. ' +
              'Fitted on Inside Airbnb cities, which skew large and high-income.',
          },
    },
    // Build warnings (data fixes, dropped values, failed tiles, skipped
    // model); Inside Airbnb skip reasons are under inputs.insideAirbnb.skipped.
    anomalies,
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
Built by \`node scripts/build-city-intel.mjs\`, which pins Natural Earth and
OurAirports to a commit SHA (immutable raw URLs), and records sha256 hashes
+ download/access dates for GeoNames, the live World Bank and NASA POWER APIs
and Inside Airbnb, in \`source.json\`.

| File | Contents |
|---|---|
| \`cities.json\` | ${citiesOut.count} cities as compact rows (\`fields\` header): id, name, ISO3, admin1, lat/lon, population, capital flag, nearest scheduled-service airport, monthly housing USD (Inside Airbnb or model), origin, GeoNames id. GeoNames population ≥ ${MIN_POP.toLocaleString('en-US')}, ${extraIds.size} curated lifestyle towns, ${MANUAL_CITIES.length} manual record(s), and every earlier pack id |
| \`countries.json\` | Per-ISO3 name/region/continent/subregion + World Bank metrics (life expectancy, internet users, PM2.5, price level, homicide rate, political stability) |
| \`seasonality.json\` | v3: ${cellsOut.length} NASA POWER grid cells × 12 months (comfort score, °C, mm) and a city → cell map covering ${seasonCovered}/${cities.length} cities (2001-2020 climatology) |

The client (\`src/layers/cityIntel/source.js\`) decodes the rows and cells back into
plain objects on load.

## Rebuild

\`\`\`
node scripts/build-city-intel.mjs
\`\`\`

Requires network access; caches raw downloads under \`.gev-cache/city-intel-build/\`
(gitignored) so re-runs are fast and offline-friendly. The previous
\`cities.json\` is the id registry: every id it holds survives the rebuild.

## Licenses / attribution

- GeoNames (cities1000, admin1 codes, country info) — CC BY 4.0, "GeoNames (geonames.org)".
- Natural Earth (admin-0 countries, tiny countries; legacy city records) — public domain, "Made with Natural Earth".
- OurAirports — public domain.
- World Bank WDI/WGI indicators and country list — CC BY 4.0, attribution "World Bank".
- Inside Airbnb listings summaries — CC BY 4.0, "Inside Airbnb (insideairbnb.com)".
- Seasonality — NASA POWER monthly climatology (2001-2020, MERRA-2), public data. "These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program."

See \`source.json\` for exact URLs, pinned commits (Natural Earth, OurAirports),
download/access dates, sha256 hashes, and the housing model's coefficients and fit.
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

  console.log(
    `\ncities: ${cities.length} (GeoNames pop >= ${MIN_POP} + extras + legacy + manual)`,
  );
  console.log(`countries: ${Object.keys(countries).length}`);
  for (const key of Object.keys(INDICATORS)) {
    const n = [...Object.values(countries)].filter(
      (c) => c.metrics[key],
    ).length;
    console.log(`  ${key}: ${n} countries`);
  }
  console.log(
    `seasonality: ${seasonCovered}/${cities.length} covered, ` +
      `${seasonSkipped.length} skipped (${cellsOut.length} cells, ${powerCallsMade} POWER calls this run)`,
  );
  console.log(
    model.error
      ? `housing: ${iabUsed.length}/${iabAttempted} attempted Inside Airbnb datasets usable, model skipped (${model.error})`
      : `housing: ${iabUsed.length}/${iabAttempted} attempted Inside Airbnb datasets usable, model R² ${model.r2.toFixed(3)}, ` +
          `LOO median |err| ${model.looMedianAbsPctError.toFixed(1)}%, ` +
          `coef a=${b0.toFixed(3)} b=${b1.toFixed(3)} c=${b2.toFixed(3)} d=${b3.toFixed(3)}`,
  );
  for (const u of iabUsed)
    console.log(`  ${u.cityId}: $${u.monthlyUsd}/mo (n=${u.n}, ${u.rule})`);
  for (const s of iabSkipped) console.log(`  skipped ${s}`);
  for (const s of sizes) console.log(`  ${s.name}: ${s.kb} KB`);
  console.log(
    `  total: ${totalKb.toFixed(1)} KB (budget ${PACK_BUDGET_KB.toFixed(1)} KB)`,
  );
  if (totalKb > PACK_BUDGET_KB)
    throw new Error(
      `pack exceeds ${(PACK_BUDGET_KB / 1024).toFixed(1)} MB budget: ${totalKb.toFixed(1)} KB`,
    );
  if (anomalies.length) {
    console.log(`\nanomalies (${anomalies.length}):`);
    for (const a of anomalies) console.log(`  - ${a}`);
  }
  console.log(`\ndone in ${((Date.now() - mainStart) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
