/**
 * @file Lifestyle Plan: pure model for an ordered set of stays across a year.
 * No DOM, no Cesium, no network — see docs/cockpit/SPEC.md §3.5.
 * @module layers/cityIntel/plan
 */
import { haversineKm } from '../../travel/geo.js';
import { MONTH_ABBR } from '../../travel/seasonality.js';

let stayIdSeq = 0;
const makeStayId = () =>
  `stay-${Date.now().toString(36)}-${(stayIdSeq++).toString(36)}`;

const isMonth = (n) => Number.isInteger(n) && n >= 1 && n <= 12;
const orderByStart = (stays) => [...stays].sort((a, b) => a.start - b.start);

/**
 * Months a stay covers, wrapping past December.
 * @param {{start: number, len: number}} stay
 * @returns {number[]} 1..12, `len` entries long
 */
export function monthsOf({ start, len }) {
  const months = [];
  for (let i = 0; i < len; i++) months.push(((start - 1 + i) % 12) + 1);
  return months;
}

/**
 * "NOV–FEB · 4 mo" (single month: "NOV · 1 mo").
 * @param {{start: number, len: number}} stay
 * @returns {string}
 */
export function spanLabel(stay) {
  const months = monthsOf(stay);
  const startAbbr = MONTH_ABBR[stay.start - 1];
  const endAbbr = MONTH_ABBR[months[months.length - 1] - 1];
  const span = stay.len === 1 ? startAbbr : `${startAbbr}–${endAbbr}`;
  return `${span} · ${stay.len} mo`;
}

/**
 * Months a candidate stay would share with existing stays (wrap-aware).
 * @param {Array<{id?: string, start: number, len: number}>} stays
 * @param {{start: number, len: number}} candidate
 * @param {string} [ignoreId] a stay id to skip (updating that stay in place)
 * @returns {number[]} conflicting months, ascending; empty when clear
 */
export function overlaps(stays, candidate, ignoreId = null) {
  const candMonths = new Set(monthsOf(candidate));
  const conflict = new Set();
  for (const s of stays) {
    if (ignoreId != null && s.id === ignoreId) continue;
    for (const m of monthsOf(s)) if (candMonths.has(m)) conflict.add(m);
  }
  return [...conflict].sort((a, b) => a - b);
}

/**
 * First month (1-12) not covered by any stay.
 * @param {Array<{start: number, len: number}>} stays
 * @returns {number|null} null when the year is fully covered
 */
export function firstFreeMonth(stays) {
  const covered = new Set(stays.flatMap((s) => monthsOf(s)));
  for (let m = 1; m <= 12; m++) if (!covered.has(m)) return m;
  return null;
}

/**
 * Split `total` months (default: the whole year) into `n` stays of even
 * length, remainder to the earliest, starting at month `start` (default
 * January) and wrapping past December. e.g. evenSplit(5) -> [3, 3, 2, 2, 2].
 * @param {number} n 1..total
 * @param {number} [total=12] months to split, 1..12
 * @param {number} [start=1] starting month, 1..12
 * @returns {Array<{start: number, len: number}>} in order, no cityId
 */
export function evenSplit(n, total = 12, start = 1) {
  if (!Number.isInteger(n) || n < 1 || n > total)
    throw new RangeError(
      `evenSplit needs an integer stay count from 1 to ${total}`,
    );
  const base = Math.floor(total / n);
  const remainder = total % n;
  const stays = [];
  let s = start;
  for (let i = 0; i < n; i++) {
    const len = base + (i < remainder ? 1 : 0);
    stays.push({ start: ((s - 1) % 12) + 1, len });
    s += len;
  }
  return stays;
}

/**
 * Add a stay, rejecting invalid months or a month overlap with an existing stay.
 * The same city may appear more than once (each stay keeps its own id).
 * @param {Array<{id: string, cityId: string, start: number, len: number}>} stays
 * @param {{cityId: string, start: number, len: number}} input
 * @returns {{ok: true, stays: object[], months: number[]}|{ok: false, error: 'invalid'|'overlap', months: number[]}}
 */
export function addStay(stays, input) {
  const { cityId, start, len } = input || {};
  if (!cityId || !isMonth(start) || !isMonth(len))
    return { ok: false, error: 'invalid', months: [] };
  const conflict = overlaps(stays, { start, len });
  if (conflict.length) return { ok: false, error: 'overlap', months: conflict };
  const stay = { id: makeStayId(), cityId, start, len };
  return {
    ok: true,
    stays: orderByStart([...stays, stay]),
    months: monthsOf(stay),
  };
}

/**
 * Remove a stay by id.
 * @param {Array<{id: string}>} stays
 * @param {string} id
 * @returns {{ok: boolean, stays: object[]}} ok is false when the id was not found
 */
export function removeStay(stays, id) {
  const next = stays.filter((s) => s.id !== id);
  return { ok: next.length !== stays.length, stays: next };
}

/**
 * Update a stay in place, re-validating months (own months excluded from the overlap check).
 * @param {Array<{id: string, cityId: string, start: number, len: number}>} stays
 * @param {string} id
 * @param {Partial<{cityId: string, start: number, len: number}>} patch
 * @returns {{ok: true, stays: object[], months: number[]}|{ok: false, error: 'not-found'|'invalid'|'overlap', months: number[]}}
 */
export function updateStay(stays, id, patch) {
  const current = stays.find((s) => s.id === id);
  if (!current) return { ok: false, error: 'not-found', months: [] };
  const next = { ...current, ...patch };
  if (!next.cityId || !isMonth(next.start) || !isMonth(next.len))
    return { ok: false, error: 'invalid', months: [] };
  const conflict = overlaps(stays, next, id);
  if (conflict.length) return { ok: false, error: 'overlap', months: conflict };
  const updated = stays.map((s) => (s.id === id ? next : s));
  return { ok: true, stays: orderByStart(updated), months: monthsOf(next) };
}

const COST_LABELS = Object.freeze({
  'no-home': 'set home to compare costs',
  unavailable: 'cost data unavailable for this country',
  'ratio-only': 'set monthly spend for a dollar estimate',
  estimate:
    'estimate from country price levels, consumption basket; expat costs often differ',
  override: 'your figure',
});

/**
 * Relative and estimated cost for one stay against the home country's price level.
 * ponytail: no exact SPEC copy for 'ratio-only'/'unavailable' basis (only
 * no-home/estimate/override are quoted verbatim in SPEC §3.5) — worded to match their tone.
 */
function stayCost(stay, iso3, ctx) {
  const {
    countries,
    profile = {},
    overrides = {},
    citiesById,
    rentByCity,
  } = ctx;
  const override = Number.isFinite(overrides[stay.id])
    ? overrides[stay.id]
    : null;
  const rentInfo = rentByCity?.get(stay.cityId) ?? null;

  const homeCity = profile.homeCityId
    ? citiesById.get(profile.homeCityId)
    : null;
  const homeIso3 = homeCity?.iso3 ?? null;
  const stayMetric = iso3 ? countries?.[iso3]?.metrics?.priceLevel : null;
  const homeMetric = homeIso3
    ? countries?.[homeIso3]?.metrics?.priceLevel
    : null;
  const ratio =
    Number.isFinite(stayMetric?.v) &&
    Number.isFinite(homeMetric?.v) &&
    homeMetric.v !== 0
      ? stayMetric.v / homeMetric.v
      : null;
  // Without a home city, the stay's own price-level year is not reported
  // either — a lone ratioYears.stay with no home to compare against would
  // be a half-answer no basis actually gives.
  const ratioYears = profile.homeCityId
    ? { stay: stayMetric?.y ?? null, home: homeMetric?.y ?? null }
    : { stay: null, home: null };

  const basis =
    override !== null
      ? 'override'
      : !profile.homeCityId
        ? 'no-home'
        : ratio === null
          ? 'unavailable'
          : !Number.isFinite(profile.monthlySpendUsd)
            ? 'ratio-only'
            : 'estimate';
  const estimateUsd =
    basis === 'estimate'
      ? Math.round((profile.monthlySpendUsd * ratio) / 10) * 10
      : null;

  return {
    ratio,
    ratioYears,
    estimateUsd,
    override,
    basis,
    label: COST_LABELS[basis],
    rentInfo,
  };
}

/** Mean seasonality comfort over a stay's months; unavailable when the city has no seasonality row. */
function stayComfort(stay, seasonality) {
  const cityRow = seasonality?.cities?.[stay.cityId];
  const months = monthsOf(stay).map((m) => ({
    m,
    score: Number.isFinite(cityRow?.months?.[m - 1]?.score)
      ? cityRow.months[m - 1].score
      : null,
  }));
  const known = months.filter((x) => x.score !== null);
  const mean = known.length
    ? known.reduce((s, x) => s + x.score, 0) / known.length
    : null;
  return { mean, months, status: mean === null ? 'unavailable' : 'ok' };
}

/**
 * Visa read for a stay: numeric requirements are checked against the stay length
 * (30 days/month); category strings ('visa required', 'e-visa', ...) can't be
 * measured against a day count, so they report 'unknown' with the raw requirement.
 */
function stayVisa(stay, iso3, visa) {
  const stayDays = stay.len * 30;
  const base = { allowanceDays: null, stayDays, requirement: null };

  if (!visa) return { ...base, status: 'no-passport' };
  if (visa.offline) return { ...base, status: 'offline' };

  const raw = iso3 ? visa.byDest?.[iso3] : undefined;
  if (raw === undefined) return { ...base, status: 'unknown' };

  const num =
    typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw) ? Number(raw) : raw;
  if (typeof num === 'number' && Number.isFinite(num)) {
    if (num === -1) return { ...base, status: 'ok' };
    if (num >= 0)
      return {
        ...base,
        allowanceDays: num,
        status: num < stayDays ? 'exceeds' : 'ok',
      };
  }
  return { ...base, requirement: String(raw), status: 'unknown' };
}

/**
 * @typedef {object} StayMetrics
 * @property {{score: number, coverageText: string}|null} fit
 * @property {object} cost
 * @property {{mean: number|null, months: Array<{m: number, score: number|null}>, status: 'ok'|'unavailable'}} comfort
 * @property {{score: number|null, coverage: 'full'|'partial'|'unavailable'}} safety
 * @property {{level: number|null}} advisory
 * @property {{status: 'ok'|'exceeds'|'unknown'|'no-passport'|'offline', allowanceDays: number|null, stayDays: number}} visa
 */

/**
 * Per-stay fit, cost, comfort, safety and visa read.
 * @param {{id: string, cityId: string, start: number, len: number}} stay
 * @param {{scoredById: Map, countries: object, seasonality: object, advisories?: object, visa?: object, rentByCity?: Map, profile?: {homeCityId?: string, monthlySpendUsd?: number}, overrides?: Record<string, number>, citiesById: Map}} ctx
 * @returns {StayMetrics}
 */
export function stayMetrics(stay, ctx) {
  const { scoredById, seasonality, advisories, visa, citiesById } = ctx;
  const scored = scoredById.get(stay.cityId);
  const iso3 = citiesById.get(stay.cityId)?.iso3 ?? scored?.city?.iso3 ?? null;

  return {
    fit: scored
      ? { score: scored.composite, coverageText: scored.coverage.text }
      : null,
    cost: stayCost(stay, iso3, ctx),
    comfort: stayComfort(stay, seasonality),
    safety: scored
      ? {
          score: scored.pillars.safety.score,
          coverage: scored.pillars.safety.coverage,
        }
      : { score: null, coverage: 'unavailable' },
    advisory: { level: (iso3 && advisories?.byIso3?.[iso3]?.level) ?? null },
    visa: stayVisa(stay, iso3, visa),
  };
}

/**
 * Year rollup: coverage, month-weighted fit/comfort, annual cost and travel legs.
 * The loop only closes back to the first stay once all 12 months are covered.
 * @param {Array<{id: string, cityId: string, start: number, len: number}>} stays
 * @param {Map<string, StayMetrics>} metrics stayId -> stayMetrics() result
 * @param {Map<string, {lat: number, lon: number}>} citiesById
 */
export function rollup(stays, metrics, citiesById) {
  const ordered = orderByStart(stays);
  const covered = new Set(ordered.flatMap((s) => monthsOf(s)));
  const gaps = [];
  for (let m = 1; m <= 12; m++) if (!covered.has(m)) gaps.push(m);
  const monthsCovered = covered.size;
  const complete = gaps.length === 0;

  let fitWeight = 0;
  let fitSum = 0;
  let comfortWeight = 0;
  let comfortSum = 0;
  let costUsd = 0;
  let costMonths = 0;
  let maxAdvisory = null;

  for (const stay of ordered) {
    const m = metrics.get(stay.id);
    if (!m) continue;
    const monthCount = stay.len;
    if (m.fit && Number.isFinite(m.fit.score)) {
      fitSum += m.fit.score * monthCount;
      fitWeight += monthCount;
    }
    if (Number.isFinite(m.comfort?.mean)) {
      comfortSum += m.comfort.mean * monthCount;
      comfortWeight += monthCount;
    }
    const amount = m.cost?.override ?? m.cost?.estimateUsd ?? null;
    if (Number.isFinite(amount)) {
      costUsd += amount * monthCount;
      costMonths += monthCount;
    }
    if (Number.isFinite(m.advisory?.level))
      maxAdvisory =
        maxAdvisory === null
          ? m.advisory.level
          : Math.max(maxAdvisory, m.advisory.level);
  }

  const costComplete = costMonths === 12;
  const annualCost = costComplete
    ? { usd: costUsd, coveredMonths: 12, complete: true }
    : {
        usd: null,
        coveredMonths: costMonths,
        complete: false,
        label: `partial, ${costMonths}/12 months`,
      };

  const coordsOf = (stay) => {
    const city = citiesById.get(stay.cityId);
    return city && Number.isFinite(city.lat) && Number.isFinite(city.lon)
      ? [city.lon, city.lat]
      : null;
  };
  // Once the year is fully covered, one extra leg closes the loop back to
  // the first stay; append it here so a single pass over consecutive pairs
  // covers both the open and the closed itinerary.
  const legs =
    complete && ordered.length > 1 ? [...ordered, ordered[0]] : ordered;
  let moves = 0;
  let km = 0;
  for (let i = 1; i < legs.length; i++) {
    moves++;
    const a = coordsOf(legs[i - 1]);
    const b = coordsOf(legs[i]);
    if (a && b) km += haversineKm(a, b);
  }

  return {
    monthsCovered,
    gaps,
    fitMean: fitWeight ? fitSum / fitWeight : null,
    annualCost,
    comfortMean: comfortWeight ? comfortSum / comfortWeight : null,
    maxAdvisory,
    moves,
    km: Math.round(km),
  };
}
