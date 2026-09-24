import path from 'node:path';
import { promises as fsp } from 'node:fs';
import {
  readResponseTextCapped,
  readResponseJsonCapped,
} from './common/http.js';

const USER_AGENT =
  'gods-eye-view (+https://github.com/bilawalsidhu/gods-eye-view)';
const TIMEOUT_MS = 15_000;
const MAX_CSV_BYTES = 5 * 1024 * 1024;

const ADVISORIES_URL = 'https://cadataapi.state.gov/api/TravelAdvisories';
const VISA_CSV_URL =
  'https://raw.githubusercontent.com/ilyankou/passport-index-dataset/master/passport-index-tidy-iso3.csv';
const VISA_COMMITS_URL =
  'https://api.github.com/repos/ilyankou/passport-index-dataset/commits?path=passport-index-tidy-iso3.csv&per_page=1';
const ZORI_CSV_URL =
  'https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const SOURCES = Object.freeze({
  advisories: Object.freeze({
    name: 'US State Dept Travel Advisories',
    url: ADVISORIES_URL,
    license: 'US public domain',
    attribution: 'US Department of State',
  }),
  visa: Object.freeze({
    name: 'Passport Index dataset (ilyankou)',
    url: 'https://github.com/ilyankou/passport-index-dataset',
    license: 'MIT (repo); underlying data sourced from passportindex.org',
    attribution:
      'ilyankou/passport-index-dataset (MIT), data via passportindex.org',
  }),
  rent: Object.freeze({
    name: 'Zillow Observed Rent Index (ZORI)',
    url: ZORI_CSV_URL,
    license: 'Free with attribution; redistribution terms unclear',
    attribution: 'Zillow Observed Rent Index (ZORI), Zillow Group',
  }),
  air: Object.freeze({
    name: 'Open-Meteo Air Quality API',
    url: AIR_URL,
    license: 'CC BY 4.0 (free tier, non-commercial)',
    attribution: 'Open-Meteo.com',
  }),
});

function invalid(reason) {
  return new Error(reason || 'invalid_city_intel_data');
}

// ---------------------------------------------------------------------------
// Minimal RFC4180 CSV parser (no embedded-CSV-parser dependency was found in
// the repo). Handles quoted fields with embedded commas/escaped quotes; both
// upstream files here are single-line-per-row, so multi-line quoted fields
// are not a concern in practice, but the loop below still keeps a quoted
// newline as data rather than mis-splitting a row.
// ---------------------------------------------------------------------------

/**
 * @param {string} text
 * @returns {string[][]} rows of raw string fields (not trimmed)
 */
export function parseCsv(text) {
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
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

// ---------------------------------------------------------------------------
// Advisories: US State Dept TravelAdvisories
// ---------------------------------------------------------------------------

/**
 * FIPS 10-4 -> ISO3 fallback, for advisory Link values with no `.<iso3>.`
 * slug. Built empirically from the live feed's own Category values (some of
 * which are not standard FIPS, e.g. 'A2', or diverge from it, e.g. 'SR' for
 * Switzerland) cross-checked by country name against geonames' countryInfo
 * dump. Deliberately covers only the codes this feed is observed to use.
 */
const FIPS_TO_ISO3 = Object.freeze({
  AA: 'ABW',
  AE: 'ARE',
  AL: 'ALB',
  AM: 'ARM',
  AN: 'AND',
  AO: 'AGO',
  AS: 'AUS',
  AU: 'AUT',
  AV: 'AIA',
  BA: 'BHR',
  BC: 'BWA',
  BD: 'BMU',
  BG: 'BGD',
  BH: 'BLZ',
  BK: 'BIH',
  BL: 'BOL',
  BM: 'MMR',
  BN: 'BEN',
  BP: 'SLB',
  BR: 'BRA',
  BT: 'BTN',
  BX: 'BRN',
  BY: 'BDI',
  CB: 'KHM',
  CD: 'TCD',
  CF: 'COG',
  CH: 'CHN',
  CI: 'CHL',
  CJ: 'CYM',
  CM: 'CMR',
  CU: 'CUB',
  DA: 'DNK',
  DO: 'DMA',
  EC: 'ECU',
  ER: 'ERI',
  ES: 'SLV',
  FI: 'FIN',
  FJ: 'FJI',
  FP: 'PYF',
  GH: 'GHA',
  GL: 'GRL',
  GR: 'GRC',
  GT: 'GTM',
  GV: 'GIN',
  GY: 'GUY',
  HA: 'HTI',
  HO: 'HND',
  HU: 'HUN',
  IC: 'ISL',
  ID: 'IDN',
  IS: 'ISR',
  IV: 'CIV',
  JM: 'JAM',
  JO: 'JOR',
  KG: 'KGZ',
  KN: 'PRK',
  KR: 'KIR',
  KU: 'KWT',
  KV: 'XKX',
  KZ: 'KAZ',
  LA: 'LAO',
  LE: 'LBN',
  LI: 'LBR',
  LT: 'LSO',
  LU: 'LUX',
  LY: 'LBY',
  MC: 'MAC',
  MD: 'MDA',
  MG: 'MNG',
  MH: 'MSR',
  MI: 'MWI',
  MJ: 'MNE',
  MK: 'MKD',
  ML: 'MLI',
  MO: 'MAR',
  MU: 'OMN',
  MZ: 'MOZ',
  NC: 'NCL',
  NH: 'VUT',
  NI: 'NGA',
  NL: 'NLD',
  NN: 'SXM',
  NO: 'NOR',
  NP: 'NPL',
  NR: 'NRU',
  NS: 'SUR',
  NU: 'NIC',
  NZ: 'NZL',
  PE: 'PER',
  PK: 'PAK',
  PL: 'POL',
  PP: 'PNG',
  QA: 'QAT',
  RM: 'MHL',
  RP: 'PHL',
  RW: 'RWA',
  SA: 'SAU',
  SC: 'KNA',
  SI: 'SVN',
  SN: 'SGP',
  SO: 'SOM',
  SR: 'CHE',
  SU: 'SDN',
  SW: 'SWE',
  SY: 'SYR',
  TD: 'TTO',
  TH: 'THA',
  TI: 'TJK',
  TN: 'TON',
  TO: 'TGO',
  TS: 'TUN',
  TT: 'TLS',
  TU: 'TUR',
  TV: 'TUV',
  UG: 'UGA',
  UK: 'GBR',
  UP: 'UKR',
  UV: 'BFA',
  UZ: 'UZB',
  VE: 'VEN',
  VM: 'VNM',
  WA: 'NAM',
  WS: 'WSM',
  WZ: 'SWZ',
  YM: 'YEM',
  A2: 'GUF',
});

const SLUG_ISO3_RE = /destination\.([a-zA-Z]{3})\.html$/;
const LEVEL_RE = /Level\s+(\d+)\s*:\s*([^-]+)/i;

/** Resolve one advisory record's ISO3, or null when it can't be determined. */
function advisoryIso3(record) {
  const link = typeof record?.Link === 'string' ? record.Link : '';
  const slug = link.match(SLUG_ISO3_RE);
  if (slug) return slug[1].toUpperCase();
  const fips = Array.isArray(record?.Category) ? record.Category[0] : null;
  return (fips && FIPS_TO_ISO3[fips]) || null;
}

/**
 * Normalise the State Dept TravelAdvisories array. Drops records whose ISO3
 * can't be determined (rare feed inconsistencies, e.g. an empty Category
 * with a non-standard URL) and records with no parseable `Level N` in the
 * Title. Keeps highest level per ISO3, then most recently updated; HTML
 * Summary is dropped rather than shipped to the client.
 * @param {Array<object>} payload
 * @returns {{ byIso3: Record<string, {level:number, title:string, updated:string, url:string}> }}
 */
export function parseAdvisories(payload) {
  if (!Array.isArray(payload)) throw invalid('advisories not an array');
  const byIso3 = {};
  for (const record of payload) {
    const iso3 = advisoryIso3(record);
    if (!iso3) continue;
    const title = typeof record.Title === 'string' ? record.Title : '';
    const levelMatch = title.match(LEVEL_RE);
    if (!levelMatch) continue;
    const level = Number(levelMatch[1]);
    if (!Number.isFinite(level) || level < 1 || level > 4) continue;
    const updatedMs = Date.parse(record.Updated || record.Published || '');
    if (!Number.isFinite(updatedMs)) continue;
    const updated = new Date(updatedMs).toISOString();
    const prev = byIso3[iso3];
    if (
      prev &&
      (level < prev.level || (level === prev.level && updated <= prev.updated))
    )
      continue;
    byIso3[iso3] = {
      level,
      title: `Level ${level}: ${levelMatch[2].trim()}`,
      updated,
      url: typeof record.Link === 'string' ? record.Link : '',
    };
  }
  return { byIso3 };
}

// ---------------------------------------------------------------------------
// Visa: ilyankou passport-index tidy ISO3 CSV
// ---------------------------------------------------------------------------

const ISO3_RE = /^[A-Z]{3}$/;

/** @param {unknown} value */
export function isValidPassport(value) {
  return typeof value === 'string' && ISO3_RE.test(value);
}

/**
 * Parse the tidy `Passport,Destination,Requirement` CSV into a plain
 * passport -> destination -> requirement object (JSON-serialisable, so it
 * can go straight to disk cache). Numeric requirements (max-stay days, or
 * -1 for "own passport") become numbers; everything else is lowercased.
 * @param {string} text
 * @returns {Record<string, Record<string, number|string>>}
 */
export function parseVisaCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw invalid('empty visa csv');
  const [header, ...body] = rows;
  const cols = header.map((h) => h.trim().toLowerCase());
  const pi = cols.indexOf('passport');
  const di = cols.indexOf('destination');
  const ri = cols.indexOf('requirement');
  if (pi < 0 || di < 0 || ri < 0) throw invalid('unexpected visa csv header');
  const byPassport = {};
  for (const row of body) {
    const passport = row[pi]?.trim().toUpperCase();
    const dest = row[di]?.trim().toUpperCase();
    if (!isValidPassport(passport) || !isValidPassport(dest)) continue;
    const raw = row[ri]?.trim() ?? '';
    const requirement = /^-?\d+$/.test(raw) ? Number(raw) : raw.toLowerCase();
    (byPassport[passport] ??= {})[dest] = requirement;
  }
  return byPassport;
}

/**
 * @param {Record<string, Record<string, number|string>>} byPassport
 * @param {string} passport ISO3, already validated
 * @returns {{byDest: Record<string, number|string>}|null} null when unknown
 */
export function sliceVisa(byPassport, passport) {
  const byDest = byPassport?.[passport];
  return byDest ? { byDest } : null;
}

// ---------------------------------------------------------------------------
// Rent: Zillow ZORI metro CSV
// ---------------------------------------------------------------------------

const MONTH_COL_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse the ZORI metro CSV. Skips the national `country` row; for each metro
 * takes its latest non-empty month (metros differ in how current their data
 * is). `latestMonth` is the file's newest month column overall.
 * @param {string} text
 * @returns {{ latestMonth: string, metros: Array<{regionId:string, name:string, principal:string, state:string|null, sizeRank:number|null, zori:number, month:string}> }}
 */
export function parseZoriCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw invalid('empty zori csv');
  const [header, ...body] = rows;
  const monthCols = [];
  for (let i = 5; i < header.length; i++) {
    if (MONTH_COL_RE.test(header[i])) monthCols.push(i);
  }
  if (!monthCols.length) throw invalid('no zori month columns');
  const latestMonth = header[monthCols.at(-1)].slice(0, 7);
  const metros = [];
  for (const row of body) {
    if (row[3] === 'country' || !row[2]) continue;
    let zori = null;
    let month = null;
    for (let i = monthCols.length - 1; i >= 0; i--) {
      const raw = row[monthCols[i]]?.trim();
      if (!raw) continue;
      const v = Number(raw);
      if (Number.isFinite(v)) {
        zori = Math.round(v);
        month = header[monthCols[i]].slice(0, 7);
        break;
      }
    }
    if (zori === null) continue;
    const name = row[2];
    const beforeComma = name.split(',')[0].trim();
    const principal = beforeComma.split('-')[0].trim();
    const sizeRank = Number(row[1]);
    metros.push({
      regionId: row[0],
      name,
      principal,
      state: row[4] || null,
      sizeRank: Number.isFinite(sizeRank) ? sizeRank : null,
      zori,
      month,
    });
  }
  return { latestMonth, metros };
}

// ---------------------------------------------------------------------------
// Air quality: Open-Meteo
// ---------------------------------------------------------------------------

export function isValidLat(v) {
  return Number.isFinite(v) && v >= -90 && v <= 90;
}
export function isValidLon(v) {
  return Number.isFinite(v) && v >= -180 && v <= 180;
}

/**
 * @param {object} payload Open-Meteo air-quality response
 * @param {number} lat rounded request latitude (echoed back, not upstream's snapped grid point)
 * @param {number} lon rounded request longitude
 */
export function parseAirResponse(payload, lat, lon) {
  const current = payload?.current;
  if (!current || typeof current.time !== 'string')
    throw invalid('bad air response');
  const pm25 = Number(current.pm2_5);
  const europeanAqi = Number(current.european_aqi);
  const units = payload?.current_units || {};
  return {
    lat,
    lon,
    time: current.time,
    pm25: Number.isFinite(pm25) ? pm25 : null,
    europeanAqi: Number.isFinite(europeanAqi) ? europeanAqi : null,
    units: {
      pm25: units.pm2_5 ?? null,
      europeanAqi: units.european_aqi ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Cache plumbing: mem + single-flight + disk, serve-stale on upstream failure
// ---------------------------------------------------------------------------

/**
 * One cached resource (advisories / visa / rent): memory + optional disk
 * cache, single-flight refresh, serve-stale when refresh fails.
 */
function makeResourceCache({ file, ttlMs, cacheDir, now }) {
  const diskPath = cacheDir ? path.join(cacheDir, file) : null;
  let mem = null; // {at, data}
  let diskChecked = false;
  let inflight = null;

  async function readDiskOnce() {
    if (diskChecked || !diskPath) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(diskPath, 'utf8'));
      if (Number.isFinite(parsed?.at) && parsed?.data !== undefined)
        mem = parsed;
    } catch {
      /* no disk cache yet */
    }
  }

  async function writeDisk(entry) {
    if (!diskPath) return;
    try {
      await fsp.mkdir(path.dirname(diskPath), { recursive: true });
      await fsp.writeFile(diskPath, JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn(
        `[city-intel] cache write failed (${file}):`,
        err?.message || err,
      );
    }
  }

  /** @returns {Promise<{data: *, fetchedAt: number, stale: boolean}|null>} null = nothing usable at all */
  async function get(refresh) {
    await readDiskOnce();
    if (mem && now() - mem.at < ttlMs)
      return { data: mem.data, fetchedAt: mem.at, stale: false };
    if (!inflight) {
      inflight = refresh()
        .then(async (data) => {
          const entry = { at: now(), data };
          mem = entry;
          await writeDisk(entry);
          return entry;
        })
        .catch((err) => {
          console.warn(
            `[city-intel] ${file} refresh failed:`,
            err?.message || err,
          );
          return null;
        })
        .finally(() => {
          inflight = null;
        });
    }
    const fresh = await inflight;
    if (fresh) return { data: fresh.data, fetchedAt: fresh.at, stale: false };
    if (mem) return { data: mem.data, fetchedAt: mem.at, stale: true };
    return null;
  }

  return { get };
}

/** Bounded per-key cache for the air-quality route (no disk cache — 1 h TTL). */
function makeKeyedCache({ ttlMs, maxEntries, now }) {
  const mem = new Map(); // key -> {at, data}
  const inflight = new Map(); // key -> Promise

  async function get(key, refresh) {
    const cached = mem.get(key);
    if (cached && now() - cached.at < ttlMs)
      return { data: cached.data, stale: false };
    if (!inflight.has(key)) {
      inflight.set(
        key,
        refresh()
          .then((data) => {
            const entry = { at: now(), data };
            if (!mem.has(key) && mem.size >= maxEntries) {
              mem.delete(mem.keys().next().value); // evict oldest
            }
            mem.set(key, entry);
            return entry;
          })
          .catch((err) => {
            console.warn(
              '[city-intel] air refresh failed:',
              err?.message || err,
            );
            return null;
          })
          .finally(() => {
            inflight.delete(key);
          }),
      );
    }
    const fresh = await inflight.get(key);
    if (fresh) return { data: fresh.data, stale: false };
    if (cached) return { data: cached.data, stale: true };
    return null;
  }

  return { get };
}

// ---------------------------------------------------------------------------
// Vite plugin
// ---------------------------------------------------------------------------

/**
 * City Intel live-data proxy: advisories, visa access, US metro rent (ZORI)
 * and current air quality. Fixed upstream URLs only (no client-supplied
 * destinations); every route caches, serves stale on upstream failure, and
 * degrades to 502 only when nothing cached is available at all.
 * @param {{fetchImpl?: typeof fetch, cacheDir?: string, now?: () => number}} [options]
 * @returns {import('vite').Plugin}
 */
export function cityIntelProxy({
  fetchImpl = fetch,
  cacheDir = path.join(process.cwd(), '.gev-cache'),
  now = () => Date.now(),
} = {}) {
  const advisoriesCache = makeResourceCache({
    file: 'city-intel-advisories.json',
    ttlMs: 6 * 3600_000,
    cacheDir,
    now,
  });
  const visaCache = makeResourceCache({
    file: 'city-intel-visa.json',
    ttlMs: 7 * 86_400_000,
    cacheDir,
    now,
  });
  const rentCache = makeResourceCache({
    file: 'city-intel-rent.json',
    ttlMs: 7 * 86_400_000,
    cacheDir,
    now,
  });
  const airCache = makeKeyedCache({ ttlMs: 3600_000, maxEntries: 500, now });

  const baseHeaders = Object.freeze({
    'User-Agent': USER_AGENT,
    Accept: 'application/json,text/csv,*/*',
  });

  async function fetchText(url, cap, signal) {
    const res = await fetchImpl(url, {
      signal,
      redirect: 'error',
      headers: baseHeaders,
    });
    if (!res.ok) {
      await res.body?.cancel?.().catch(() => {});
      throw new Error(`upstream ${url} -> HTTP ${res.status}`);
    }
    return readResponseTextCapped(res, cap, signal);
  }

  async function refreshAdvisories(signal) {
    const text = await fetchText(ADVISORIES_URL, 8 * 1024 * 1024, signal);
    return parseAdvisories(JSON.parse(text));
  }

  async function refreshVisa(signal) {
    const csvText = await fetchText(VISA_CSV_URL, MAX_CSV_BYTES, signal);
    const byPassport = parseVisaCsv(csvText);
    let year = null;
    try {
      const res = await fetchImpl(VISA_COMMITS_URL, {
        signal,
        redirect: 'error',
        headers: baseHeaders,
      });
      if (res.ok) {
        const commits = await readResponseJsonCapped(res, 64 * 1024, signal);
        const dateStr =
          commits?.[0]?.commit?.committer?.date ||
          commits?.[0]?.commit?.author?.date;
        const parsedYear = dateStr ? new Date(dateStr).getUTCFullYear() : NaN;
        if (Number.isFinite(parsedYear)) year = parsedYear;
      } else {
        await res.body?.cancel?.().catch(() => {});
      }
    } catch (err) {
      console.warn(
        '[city-intel] visa commit-year lookup failed:',
        err?.message || err,
      );
    }
    return { byPassport, year };
  }

  async function refreshRent(signal) {
    const csvText = await fetchText(ZORI_CSV_URL, MAX_CSV_BYTES, signal);
    return parseZoriCsv(csvText);
  }

  async function refreshAir(lat, lon, signal) {
    const url = new URL(AIR_URL);
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('current', 'pm2_5,european_aqi');
    const res = await fetchImpl(url.href, {
      signal,
      redirect: 'error',
      headers: baseHeaders,
    });
    if (!res.ok) {
      await res.body?.cancel?.().catch(() => {});
      throw new Error(`air upstream HTTP ${res.status}`);
    }
    const payload = await readResponseJsonCapped(res, 64 * 1024, signal);
    return parseAirResponse(payload, lat, lon);
  }

  function envelope(data, fetchedAt, stale, source) {
    return { ok: true, data, fetchedAt, stale, source };
  }

  function upstreamUnavailable(source) {
    return { ok: false, error: 'upstream-unavailable', source };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/city-intel', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(obj));
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const close = () => controller.abort();
      res.once?.('close', close);
      try {
        if (req.method !== 'GET')
          return sendJson(405, { ok: false, error: 'method-not-allowed' });

        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const subPath = parsedUrl.pathname;

        if (subPath === '/advisories') {
          const result = await advisoriesCache.get(() =>
            refreshAdvisories(controller.signal),
          );
          if (!result)
            return sendJson(502, upstreamUnavailable(SOURCES.advisories));
          return sendJson(
            200,
            envelope(
              result.data,
              result.fetchedAt,
              result.stale,
              SOURCES.advisories,
            ),
          );
        }

        if (subPath === '/visa') {
          const passport = (parsedUrl.searchParams.get('passport') || '')
            .trim()
            .toUpperCase();
          if (!isValidPassport(passport))
            return sendJson(400, { ok: false, error: 'invalid-passport' });
          const result = await visaCache.get(() =>
            refreshVisa(controller.signal),
          );
          if (!result) return sendJson(502, upstreamUnavailable(SOURCES.visa));
          const sliced = sliceVisa(result.data.byPassport, passport);
          if (!sliced)
            return sendJson(404, { ok: false, error: 'unknown-passport' });
          const data = {
            passport,
            year: result.data.year,
            byDest: sliced.byDest,
          };
          return sendJson(
            200,
            envelope(data, result.fetchedAt, result.stale, SOURCES.visa),
          );
        }

        if (subPath === '/rent') {
          const result = await rentCache.get(() =>
            refreshRent(controller.signal),
          );
          if (!result) return sendJson(502, upstreamUnavailable(SOURCES.rent));
          return sendJson(
            200,
            envelope(result.data, result.fetchedAt, result.stale, SOURCES.rent),
          );
        }

        if (subPath === '/air') {
          const lat =
            Math.round(Number(parsedUrl.searchParams.get('lat')) * 100) / 100;
          const lon =
            Math.round(Number(parsedUrl.searchParams.get('lon')) * 100) / 100;
          if (!isValidLat(lat) || !isValidLon(lon))
            return sendJson(400, { ok: false, error: 'invalid-coordinates' });
          const key = `${lat},${lon}`;
          const result = await airCache.get(key, () =>
            refreshAir(lat, lon, controller.signal),
          );
          if (!result) return sendJson(502, upstreamUnavailable(SOURCES.air));
          return sendJson(
            200,
            envelope(result.data, now(), result.stale, SOURCES.air),
          );
        }

        sendJson(404, { ok: false, error: 'unknown-route' });
      } catch (err) {
        console.warn('[city-intel] proxy error:', err?.message || err);
        sendJson(500, { ok: false, error: 'city-intel proxy error' });
      } finally {
        clearTimeout(timer);
        res.removeListener?.('close', close);
      }
    });
  };

  return {
    name: 'city-intel-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
