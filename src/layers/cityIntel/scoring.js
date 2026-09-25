// City Intel scoring model. Pure: no DOM, network or rendering imports.
// Method and rationale: docs/cockpit/METHODOLOGY.md.

/** Pillar keys in composite order. */
export const PILLARS = Object.freeze(['qol', 'cost', 'safety', 'travel']);

const COUNTRY_PILLARS = ['qol', 'cost', 'safety'];

// Nearest scheduled-service airport; the pack only records one within 100 km.
const AIRPORT_RADIUS_KM = 100;
const AIRPORT_TYPE_FACTOR = { large: 1, medium: 0.5 };
const AIRPORT_META = {
  label: 'Airport access',
  unit: 'index 0-100',
  source: 'OurAirports',
  derived: true,
};

// Ordinal visa access for the chosen passport (higher = easier).
const VISA_LEVELS = {
  'visa free': 4,
  eta: 3,
  'visa on arrival': 3,
  'e-visa': 2,
  'visa required': 1,
  'no admission': 0,
};
const OWN_COUNTRY_LEVEL = 5;

/**
 * City-level metrics scored alongside the country indicators (ranked across
 * cities, like airport access). `source` for housing depends on the city's
 * data origin, see `housingSource`.
 */
export const CITY_METRICS = Object.freeze({
  climate: Object.freeze({
    pillar: 'qol',
    direction: 'higher',
    label: 'Climate comfort',
    unit: 'comfort 0-100',
    source: 'NASA POWER',
    derived: true,
  }),
  housing: Object.freeze({
    pillar: 'cost',
    direction: 'lower',
    label: 'Housing',
    unit: 'USD / month',
    source: 'Inside Airbnb',
    derived: false,
  }),
});

/**
 * Where a city's housing number comes from, as the scorecard shows it.
 * @param {{src: string, rule?: string}|null|undefined} housing
 * @returns {string|null}
 */
export function housingSource(housing) {
  if (housing?.src === 'insideairbnb')
    return `Inside Airbnb median · entire homes · ${housing.rule === 'min7' ? '7' : '28'}+ nights`;
  if (housing?.src === 'model')
    return 'Estimate · country price level + city size';
  return null;
}

/**
 * Mean monthly comfort (0-100, one decimal) over the months with a score, or
 * null when the row is missing or has none.
 * @param {{months?: Array<{score: number}>}|undefined} row
 * @returns {number|null}
 */
export function meanComfortScore(row) {
  const months = row?.months;
  if (!Array.isArray(months) || months.length !== 12) return null;
  // Same rule as plan.js stayComfort: average the known months only.
  const known = months
    .map((m) => m?.score)
    .filter((score) => Number.isFinite(score));
  if (!known.length) return null;
  const sum = known.reduce((total, score) => total + score, 0);
  return Math.round((sum / known.length) * 10) / 10;
}
const VISA_META = {
  label: 'Visa access',
  unit: 'access level 0-5',
  source: 'Passport Index dataset (ilyankou)',
  derived: true,
};

/**
 * Map a passport-index requirement to an ordinal access level, or null when unknown.
 * @param {number|string|null|undefined} requirement
 * @returns {number|null}
 */
export function visaAccessLevel(requirement) {
  if (typeof requirement === 'string' && /^\s*-?\d+\s*$/.test(requirement))
    requirement = Number(requirement);
  if (typeof requirement === 'number') {
    if (requirement === -1) return OWN_COUNTRY_LEVEL;
    return Number.isFinite(requirement) && requirement >= 0
      ? VISA_LEVELS['visa free']
      : null;
  }
  if (typeof requirement !== 'string') return null;
  return VISA_LEVELS[requirement.trim().toLowerCase()] ?? null;
}

/**
 * Airport access index 0-100 from the nearest scheduled airport, or null when unknown.
 * `null` airport is a fact (none within 100 km) and scores 0; `undefined` is missing data.
 * @param {{ km: number, type: string } | null | undefined} airport
 * @returns {number|null}
 */
export function airportAccess(airport) {
  if (airport === null) return 0;
  const factor = AIRPORT_TYPE_FACTOR[airport?.type];
  if (!factor || !Number.isFinite(airport.km) || airport.km < 0) return null;
  const decay = Math.max(0, 1 - airport.km / AIRPORT_RADIUS_KM);
  return Math.round(factor * decay * 1000) / 10;
}

/**
 * Direction-aware percentile rank, 0 (worst) to 100 (best); ties share their average rank.
 * @param {Array<[string|number, number]>} entries id/value pairs
 * @param {'higher'|'lower'} direction which way is better
 * @returns {Map<string|number, number>} id -> percentile (a lone entry scores 50)
 */
export function percentileRanks(entries, direction) {
  const sign = direction === 'lower' ? -1 : 1;
  const sorted = entries
    .map(([id, value]) => [id, sign * value])
    .sort((a, b) => a[1] - b[1]);
  const n = sorted.length;
  const out = new Map();
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && sorted[j + 1][1] === sorted[i][1]) j++;
    const pct = n === 1 ? 50 : ((i + j) / 2 / (n - 1)) * 100;
    for (let k = i; k <= j; k++) out.set(sorted[k][0], pct);
    i = j + 1;
  }
  return out;
}

const metric = (
  key,
  meta,
  { level, raw = null, year = null, pct = null, status, detail = null },
) =>
  Object.freeze({
    key,
    label: meta.label,
    raw,
    unit: meta.unit,
    year,
    level,
    pct,
    source: meta.source,
    derived: Boolean(meta.derived),
    status,
    detail,
  });

function pillar(metrics) {
  let sum = 0;
  let count = 0;
  for (const m of metrics) {
    if (m.pct === null) continue;
    sum += m.pct;
    count++;
  }
  return Object.freeze({
    score: count ? sum / count : null,
    coverage: !count
      ? 'unavailable'
      : count === metrics.length
        ? 'full'
        : 'partial',
    metrics: Object.freeze(metrics),
  });
}

function weightVector(weights) {
  const w = PILLARS.map((p) => weights?.[p]);
  if (w.some((v) => !Number.isFinite(v) || v < 0))
    throw new RangeError(
      'weights must be non-negative numbers for qol, cost, safety and travel',
    );
  return w.every((v) => v === 0) ? [1, 1, 1, 1] : w;
}

const compareId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Ranking order: eligible first, composite desc (null last), population desc, id asc.
 * @param {ScoredCity} a
 * @param {ScoredCity} b
 */
function compareScored(a, b) {
  return (
    b.eligible - a.eligible ||
    (b.composite ?? -1) - (a.composite ?? -1) ||
    (b.city.pop || 0) - (a.city.pop || 0) ||
    compareId(String(a.id), String(b.id))
  );
}

/**
 * @typedef {object} ScoredMetric
 * @property {string} key
 * @property {string} label
 * @property {number|null} raw value that was ranked (null when unavailable)
 * @property {string} unit
 * @property {number|null} year
 * @property {'city'|'country'} level
 * @property {number|null} pct percentile 0-100, direction-aware
 * @property {string} source
 * @property {boolean} derived
 * @property {'ok'|'missing'|'stale'|'no-passport'} status
 * @property {*} detail airport record, visa requirement or housing record; null for indicators and climate
 */

/**
 * @typedef {object} ScoredCity
 * @property {string} id
 * @property {object} city the input city record
 * @property {number|null} composite 0-100 weighted mean of available pillars
 * @property {Record<'qol'|'cost'|'safety'|'travel', {score: number|null, coverage: 'full'|'partial'|'unavailable', metrics: ScoredMetric[]}>} pillars
 * @property {{pillarsAvailable: number, cityLevelMetrics: number, text: string}} coverage
 * @property {boolean} eligible
 * @property {null|'safety-unavailable'|'insufficient-pillars'} reason
 */

/**
 * Build a scoring index for one City Intel pack. Country and city percentiles are
 * computed here once; `score` only re-weights, so slider drags stay cheap.
 * Returned objects share frozen pillar data; do not mutate them.
 * @param {{ cities: object[], countries: { buildYear: number, maxAgeYears: number, indicators: object, countries: object }, seasonality?: { cities?: Record<string, {months: Array<{score: number}>}> } }} pack
 *   `seasonality` feeds the city-level climate metric; absent = climate missing.
 * @returns {{
 *   score: (weights: {qol: number, cost: number, safety: number, travel: number}, context?: { visa?: object|null }) => ScoredCity[],
 *   rank: (scored: ScoredCity[], options?: RankOptions) => { groups: Array<{ iso3: string, country: string, cities: ScoredCity[] }> } | { rows: ScoredCity[] },
 * }}
 */
export function createCityIntelIndex({ cities, countries, seasonality } = {}) {
  if (!Array.isArray(cities)) throw new TypeError('cities must be an array');
  const {
    buildYear,
    maxAgeYears,
    indicators,
    countries: records,
  } = countries ?? {};
  if (!Number.isFinite(buildYear) || !Number.isFinite(maxAgeYears))
    throw new TypeError('countries.buildYear and maxAgeYears must be numbers');
  if (!indicators || typeof indicators !== 'object' || !records)
    throw new TypeError('countries.indicators and countries.countries needed');
  const oldestYear = buildYear - maxAgeYears;

  // Country metrics: validate, drop stale, rank once across countries.
  const scored = Object.entries(indicators).filter(([key, meta]) => {
    if (!COUNTRY_PILLARS.includes(meta?.pillar)) return false;
    if (meta.direction !== 'higher' && meta.direction !== 'lower')
      throw new TypeError(`indicator ${key} needs direction higher|lower`);
    return true;
  });
  const readMetric = (iso3, key) => {
    const m = records[iso3]?.metrics?.[key];
    if (!Number.isFinite(m?.v) || !Number.isFinite(m?.y))
      return { status: 'missing', year: null };
    if (m.y < oldestYear) return { status: 'stale', year: m.y };
    return { status: 'ok', v: m.v, year: m.y };
  };
  const ranks = new Map(
    scored.map(([key, meta]) => {
      const entries = [];
      for (const iso3 of Object.keys(records)) {
        const value = readMetric(iso3, key);
        if (value.status === 'ok') entries.push([iso3, value.v]);
      }
      return [key, percentileRanks(entries, meta.direction)];
    }),
  );
  const countryMetricCache = new Map();
  const countryMetrics = (iso3) => {
    if (!countryMetricCache.has(iso3)) {
      const byPillar = { qol: [], cost: [], safety: [] };
      for (const [key, meta] of scored) {
        const value = readMetric(iso3, key);
        const pct = value.status === 'ok' ? ranks.get(key).get(iso3) : null;
        byPillar[meta.pillar].push(
          metric(key, meta, {
            level: 'country',
            raw: value.v,
            year: value.year,
            pct,
            status: value.status,
          }),
        );
      }
      countryMetricCache.set(iso3, byPillar);
    }
    return countryMetricCache.get(iso3);
  };

  // City metrics: climate comfort (qol) and housing (cost), ranked across cities.
  const cityMetricRows = (key, rawOf, metaOf, detailOf) => {
    const raws = cities.map(rawOf);
    const pcts = percentileRanks(
      raws.flatMap((v, i) => (v === null ? [] : [[i, v]])),
      CITY_METRICS[key].direction,
    );
    return cities.map((city, i) =>
      metric(key, metaOf(city), {
        level: 'city',
        raw: raws[i],
        pct: raws[i] === null ? null : pcts.get(i),
        status: raws[i] === null ? 'missing' : 'ok',
        detail: raws[i] === null ? null : detailOf(city),
      }),
    );
  };
  const climateMetrics = cityMetricRows(
    'climate',
    (city) => meanComfortScore(seasonality?.cities?.[city.id]),
    () => CITY_METRICS.climate,
    () => null,
  );
  const housingMetrics = cityMetricRows(
    'housing',
    (city) => (Number.isFinite(city.housing?.usd) ? city.housing.usd : null),
    (city) => ({
      ...CITY_METRICS.housing,
      source: housingSource(city.housing) ?? CITY_METRICS.housing.source,
      derived: city.housing?.src === 'model',
    }),
    (city) => city.housing,
  );

  // City metric: airport access ranked across cities.
  const access = cities.map((city) => airportAccess(city.airport));
  const accessPct = percentileRanks(
    access.flatMap((v, i) => (v === null ? [] : [[i, v]])),
    'higher',
  );
  const airportMetrics = cities.map((city, i) =>
    metric('airportAccess', AIRPORT_META, {
      level: 'city',
      raw: access[i],
      pct: access[i] === null ? null : accessPct.get(i),
      status: access[i] === null ? 'missing' : 'ok',
      detail: access[i] === null ? null : city.airport,
    }),
  );

  // Visa: country level, depends on the passport, so cached per visa object.
  const visaMetricsFor = (visa) => {
    if (visa == null) {
      const unset = metric('visaAccess', VISA_META, {
        level: 'country',
        status: 'no-passport',
      });
      return () => unset;
    }
    if (!visa.byDest || typeof visa.byDest !== 'object')
      throw new TypeError('visa.byDest must be an object');
    const year = Number.isFinite(visa.year) ? visa.year : null;
    const stale = year !== null && year < oldestYear;
    const levels = new Map();
    for (const iso3 of Object.keys(records)) {
      const level = visaAccessLevel(visa.byDest[iso3]);
      if (level !== null) levels.set(iso3, level);
    }
    const pcts = percentileRanks([...levels], 'higher');
    const cache = new Map();
    return (iso3) => {
      if (!cache.has(iso3)) {
        const level = levels.get(iso3) ?? null;
        const status = level === null ? 'missing' : stale ? 'stale' : 'ok';
        cache.set(
          iso3,
          metric('visaAccess', VISA_META, {
            level: 'country',
            raw: status === 'ok' ? level : null,
            year,
            pct: status === 'ok' ? pcts.get(iso3) : null,
            status,
            detail: level === null ? null : visa.byDest[iso3],
          }),
        );
      }
      return cache.get(iso3);
    };
  };

  // Weight-independent rows, rebuilt only when the visa context changes.
  let rowsVisa;
  let rows = null;
  const rowsFor = (visa) => {
    if (rows && visa === rowsVisa) return rows;
    const visaMetric = visaMetricsFor(visa);
    rows = cities.map((city, i) => {
      const country = countryMetrics(city.iso3);
      const pillars = Object.freeze({
        qol: pillar([...country.qol, climateMetrics[i]]),
        cost: pillar([...country.cost, housingMetrics[i]]),
        safety: pillar(country.safety),
        travel: pillar([airportMetrics[i], visaMetric(city.iso3)]),
      });
      const scores = PILLARS.map((p) => pillars[p].score);
      const pillarsAvailable = scores.filter((s) => s !== null).length;
      const cityLevelMetrics = [
        airportMetrics[i],
        climateMetrics[i],
        housingMetrics[i],
      ].filter((m) => m.pct !== null).length;
      const reason =
        pillars.safety.score === null
          ? 'safety-unavailable'
          : pillarsAvailable < 3
            ? 'insufficient-pillars'
            : null;
      return {
        city,
        pillars,
        scores,
        reason,
        coverage: Object.freeze({
          pillarsAvailable,
          cityLevelMetrics,
          text: `${pillarsAvailable} of 4 pillars · ${cityLevelMetrics} city-level metric${cityLevelMetrics === 1 ? '' : 's'}`,
        }),
      };
    });
    rowsVisa = visa;
    return rows;
  };

  /**
   * Score every city for the given pillar weights (renormalised over available pillars).
   * @param {{qol: number, cost: number, safety: number, travel: number}} weights all-zero means equal
   * @param {{ visa?: object|null }} [context] visa access for the chosen passport; absent = unset
   * @returns {ScoredCity[]} in input order
   */
  function score(weights, { visa } = {}) {
    const w = weightVector(weights);
    return rowsFor(visa).map((row) => {
      let sum = 0;
      let weight = 0;
      for (let p = 0; p < 4; p++) {
        if (row.scores[p] === null) continue;
        sum += w[p] * row.scores[p];
        weight += w[p];
      }
      return {
        id: row.city.id,
        city: row.city,
        // Null when no pillar is available or every available pillar has weight 0.
        composite: weight > 0 ? sum / weight : null,
        pillars: row.pillars,
        coverage: row.coverage,
        eligible: row.reason === null,
        reason: row.reason,
      };
    });
  }

  /**
   * @typedef {object} RankOptions
   * @property {boolean} [groupByCountry=true] groups ordered by their best city
   * @property {string} [continent] exact match on the country record's continent
   * @property {number} [minPop]
   * @property {number} [hideAdvisoryLevelAtLeast] hide countries at or above this level
   * @property {Record<string, {level: number}>} [advisories] ISO3-keyed; absent = hide nothing
   * @property {boolean} [includeIneligible=false] ineligible cities sort after eligible ones
   */

  /**
   * Filter and order scored cities.
   * @param {ScoredCity[]} list output of `score`
   * @param {RankOptions} [options]
   */
  function rank(list, options = {}) {
    const {
      groupByCountry = true,
      continent,
      minPop,
      hideAdvisoryLevelAtLeast,
      advisories,
      includeIneligible = false,
    } = options;
    const hideLevel =
      advisories && Number.isFinite(hideAdvisoryLevelAtLeast)
        ? hideAdvisoryLevelAtLeast
        : Infinity;
    const ordered = list
      .filter(
        (s) =>
          (includeIneligible || s.eligible) &&
          (!continent || records[s.city.iso3]?.continent === continent) &&
          (!(minPop > 0) || s.city.pop >= minPop) &&
          !(advisories?.[s.city.iso3]?.level >= hideLevel),
      )
      .sort(compareScored);
    if (!groupByCountry) return { rows: ordered };
    const groups = new Map();
    for (const s of ordered) {
      let group = groups.get(s.city.iso3);
      if (!group) {
        group = { iso3: s.city.iso3, country: s.city.country, cities: [] };
        groups.set(s.city.iso3, group);
      }
      group.cities.push(s);
    }
    return { groups: [...groups.values()] };
  }

  return { score, rank };
}
