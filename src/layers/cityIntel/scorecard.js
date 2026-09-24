/**
 * @file ATLAS scorecard (single city) and compare overlay: pure view models
 * plus their DOM builders. Sibling of `panel.js` (docs/cockpit/DESIGN.md §3,
 * §4, §10: "a sibling, not more panel.js" once the ranking view alone nears
 * 1k lines). `panel.js` owns state/wiring/prefs; this module only turns a
 * `ScoredCity` (scoring.js) into DOM, given a `ctx` of callbacks and data the
 * caller already has loaded.
 *
 * @module layers/cityIntel/scorecard
 */
import { PILLARS } from './scoring.js';
import { binForScore } from './index.js';
import {
  bestWindow,
  formatBestSpan,
  MONTH_ABBR,
} from '../../travel/seasonality.js';
import { fetchAir, fetchRent, matchRentToCities } from './source.js';

export const PILLAR_LABELS = Object.freeze({
  qol: 'Quality of life',
  cost: 'Cost',
  safety: 'Safety',
  travel: 'Travel ease',
});

/** DESIGN §3: derived metrics carry a `title` with their formula. Only the
 * three pack indicators marked `derived: true` (scoring.js) need one; the
 * scored metric itself carries no formula field, so this is a small fixed
 * lookup rather than a per-metric field. */
const DERIVED_FORMULAS = Object.freeze({
  priceLevel: 'PA.NUS.PRVT.PP ÷ PA.NUS.FCRF (consumer price level vs. US)',
  airportAccess: 'distance-decayed index from the nearest scheduled airport',
  visaAccess: 'passport-index requirement, mapped to an ordinal access level',
});

/** "2.9 M" / "640 k" / "820" population formatting (DESIGN §3). */
export function formatPopulation(pop) {
  if (!Number.isFinite(pop)) return '—';
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(1)} M`;
  if (pop >= 1_000) return `${Math.round(pop / 1000)} k`;
  return String(Math.round(pop));
}

/** "L1".."L4", or "—" when the level is unknown/unavailable. */
export function advisoryBadgeText(level) {
  return Number.isInteger(level) && level >= 1 && level <= 4
    ? `L${level}`
    : '—';
}

/** "w5" (weight > 0) or "off" (DESIGN §3 pillar header weight chip). */
export function weightChipText(weight) {
  return Number(weight) > 0 ? `w${weight}` : 'off';
}

/** 'FULL' | 'PARTIAL' | 'UNAVAILABLE' from a pillar's coverage word. */
export function pillarCoverageWord(coverage) {
  if (coverage === 'full') return 'FULL';
  if (coverage === 'partial') return 'PARTIAL';
  return 'UNAVAILABLE';
}

// ponytail: a fixed unit->formatter table instead of a general unit-parsing
// library; the pack has exactly six indicator units (SPEC §3.2), add a row
// if a new one ships.
const UNIT_FORMATTERS = [
  [/^years$/, (v) => `${v.toFixed(1)} yr`],
  [/% of population/, (v) => `${Math.round(v)} %`],
  [/× US/, (v) => `${v.toFixed(2)} × US`],
  [/µg\/m³/, (v) => `${v.toFixed(1)} µg/m³`],
  [/per 100k/, (v) => `${v.toFixed(1)} per 100k`],
];

/** Raw indicator value formatted with its unit (DESIGN §3 metric row). */
export function formatIndicatorRaw(raw, unit) {
  if (!Number.isFinite(raw)) return '—';
  for (const [re, fmt] of UNIT_FORMATTERS)
    if (re.test(unit || '')) return fmt(raw);
  return unit ? `${raw.toFixed(2)} ${unit}` : raw.toFixed(2);
}

/**
 * "LIS · large · 7 km", or the DESIGN-uncovered but data-real case of no
 * scheduled airport within the pack's 100 km radius (raw 0, a fact, not
 * missing data — scoring.js `airportAccess`).
 */
export function formatAirportDetail(detail) {
  if (!detail) return 'None within 100 km';
  return `${detail.iata || '—'} · ${detail.type} · ${Math.round(detail.km)} km`;
}

/** Passport-index requirement -> human text, or null when there is none. */
export function formatVisaDetail(detail) {
  if (detail === null || detail === undefined) return null;
  const num =
    typeof detail === 'string' && /^\s*-?\d+\s*$/.test(detail)
      ? Number(detail)
      : detail;
  if (typeof num === 'number' && Number.isFinite(num))
    return num === -1 ? 'home country' : `${num} days visa-free`;
  const text = String(detail);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * One metric row's presentation (DESIGN §3 special-values table + metric row
 * spec). Pure: everything it needs is already on the `ScoredMetric`.
 * @param {import('./scoring.js').ScoredMetric|undefined|null} metric
 * @returns {{valueText: string, isPassportLink: boolean, pctText: string, barPct: number, yearSourceText: string, levelBadge: 'CITY'|'COUNTRY'|null, derivedTitle: string|null}|null}
 */
export function metricRowModel(metric) {
  if (!metric) return null;
  if (metric.status === 'no-passport') {
    return {
      valueText: 'Set your passport',
      isPassportLink: true,
      pctText: '—',
      barPct: 0,
      yearSourceText: 'counts once a passport is set',
      levelBadge: null,
      derivedTitle: null,
    };
  }
  if (metric.status !== 'ok') {
    return {
      valueText: 'unavailable',
      isPassportLink: false,
      pctText: '—',
      barPct: 0,
      yearSourceText: `no data within 10 years · ${metric.source}`,
      levelBadge: null,
      derivedTitle: null,
    };
  }
  let valueText;
  if (metric.key === 'airportAccess')
    valueText = formatAirportDetail(metric.detail);
  else if (metric.key === 'visaAccess')
    valueText = formatVisaDetail(metric.detail) ?? 'unavailable';
  else valueText = formatIndicatorRaw(metric.raw, metric.unit);
  const derivedTitle = metric.derived
    ? (DERIVED_FORMULAS[metric.key] ?? null)
    : null;
  return {
    valueText,
    isPassportLink: false,
    pctText: Number.isFinite(metric.pct) ? `P${Math.round(metric.pct)}` : '—',
    barPct: Number.isFinite(metric.pct)
      ? Math.max(0, Math.min(100, metric.pct))
      : 0,
    yearSourceText: `${metric.year ?? '—'} · ${metric.source}${metric.derived ? ' · derived' : ''}`,
    levelBadge: metric.level === 'city' ? 'CITY' : 'COUNTRY',
    derivedTitle,
  };
}

/**
 * One pillar block's presentation (DESIGN §3): header numbers plus every
 * metric row model, in the pillar's own metric order.
 * @param {'qol'|'cost'|'safety'|'travel'} key
 * @param {import('./scoring.js').ScoredCity['pillars']['qol']} pillar
 * @param {number} weight current slider weight for this pillar
 */
export function pillarBlockModel(key, pillar, weight) {
  return {
    key,
    label: PILLAR_LABELS[key],
    scoreText: Number.isFinite(pillar.score)
      ? String(Math.round(pillar.score))
      : '—',
    bin: binForScore(pillar.score),
    coverageWord: pillarCoverageWord(pillar.coverage),
    weightChip: weightChipText(weight),
    metrics: pillar.metrics.map((m) => ({ metric: m, row: metricRowModel(m) })),
  };
}

/**
 * Scorecard header (DESIGN §3): name/meta/coverage line plus the ineligible
 * banner text when the city didn't clear ranking eligibility.
 * @param {import('./scoring.js').ScoredCity} scored
 * @param {number|null} rank 1-based rank in the full (unfiltered) ranking, or null when ineligible
 * @param {number} totalCount total ranked (eligible) cities
 * @param {number|null} [advisoryLevel] the city's country advisory level, if known
 */
export function scorecardHeaderModel(
  scored,
  rank,
  totalCount,
  advisoryLevel = null,
) {
  const { city, composite, coverage, eligible, reason } = scored;
  const bannerText = !eligible
    ? reason === 'safety-unavailable'
      ? 'Not ranked: Safety unavailable.'
      : `Not ranked: only ${coverage.pillarsAvailable} of 4 pillars available.`
    : null;
  return {
    name: city.name,
    metaText: `${city.country} · ${city.admin1 || '—'} · ${formatPopulation(city.pop)} · ${
      eligible ? `rank ${rank} of ${totalCount}` : 'not ranked'
    }`,
    coverageText: `${coverage.text} · ${advisoryBadgeText(advisoryLevel)}`,
    compositeText: Number.isFinite(composite)
      ? String(Math.round(composite))
      : '—',
    bin: binForScore(composite),
    bannerText,
  };
}

/** DESIGN §3: metrics whose lower raw value is the better one. Fixed lookup —
 * `ScoredMetric` (scoring.js) doesn't carry the indicator's direction. */
const LOWER_IS_BETTER = new Set(['pm25', 'priceLevel', 'homicideRate']);

/** `title="Lower raw value is better"` for the metric label, or null. */
export function directionTitle(metricKey) {
  return LOWER_IS_BETTER.has(metricKey) ? 'Lower raw value is better' : null;
}

/** Whether a city's stays cover all 12 months (plan.js has no `isFull`). */
export function isPlanFull(stays, monthsOf) {
  const covered = new Set((stays || []).flatMap((s) => monthsOf(s)));
  return covered.size >= 12;
}

/**
 * Climate strip model (DESIGN §3 NOT SCORED): 12 cells tinted by the score
 * ramp (same bins as the composite, not the separate `comfortBin` ramp used
 * elsewhere) plus the best window from `seasonality.js`. Null when the city
 * has no seasonality row (no placeholder, per DESIGN).
 * @param {{months: Array<{score: number}>}|undefined} cityRow
 */
export function climateStripModel(cityRow) {
  if (!cityRow?.months || cityRow.months.length !== 12) return null;
  const cells = cityRow.months.map((m, i) => ({
    initial: MONTH_ABBR[i][0],
    bin: binForScore(m.score),
  }));
  const win = bestWindow(cityRow.months);
  return { cells, bestSpanText: win ? `Best ${formatBestSpan(win)}` : null };
}

/**
 * Indices tied for the best (highest) value in a compare row; empty when
 * fewer than two cells have a value (DESIGN §4). Percentiles and pillar/
 * composite scores are already direction-normalised (higher = better), so a
 * single "highest wins" reducer also marks the lowest raw value for a
 * higher-is-worse metric.
 * @param {Array<number|null|undefined>} values
 * @returns {Set<number>}
 */
export function bestInRow(values) {
  const present = values
    .map((v, i) => (Number.isFinite(v) ? i : null))
    .filter((i) => i !== null);
  if (present.length < 2) return new Set();
  const max = Math.max(...present.map((i) => values[i]));
  return new Set(present.filter((i) => values[i] === max));
}

function metricCompareCell(metric) {
  if (!metric) return { text: '—', missing: true };
  if (metric.status === 'no-passport')
    return { text: 'set passport', missing: true };
  if (metric.status !== 'ok')
    return { text: '—', missing: true, title: 'unavailable' };
  const raw =
    metric.key === 'airportAccess'
      ? formatAirportDetail(metric.detail)
      : metric.key === 'visaAccess'
        ? (formatVisaDetail(metric.detail) ?? 'unavailable')
        : formatIndicatorRaw(metric.raw, metric.unit);
  // DESIGN §4: percentile bold, raw value after " · " in --text-secondary,
  // and — at <=720px — percentile only, raw moved to the cell's `title`
  // (split so the responsive CSS can hide just the raw span).
  return {
    pctText: `P${Math.round(metric.pct)}`,
    rawText: raw,
    pct: metric.pct,
  };
}

function rentCompareCell(scored, rentByCity) {
  const info = scored.city.iso3 === 'USA' ? rentByCity?.get(scored.id) : null;
  if (!info) return { text: '—' };
  return {
    text: `$${Math.round(info.zori).toLocaleString()} · ZORI ${info.month}`,
  };
}

function advisoryCompareCell(scored, advisoriesByIso3) {
  const level = advisoriesByIso3?.[scored.city.iso3]?.level ?? null;
  return { text: advisoryBadgeText(level) };
}

/**
 * Compare table row models (DESIGN §4): composite, each pillar and its
 * metrics (zipped by index — every city shares the same pillar/metric shape,
 * scoring.js builds them identically), then Advisory and Rent last. Pure.
 * @param {import('./scoring.js').ScoredCity[]} pinnedScored 2-4 cities
 * @param {{advisoriesByIso3?: Record<string, {level:number}>, rentByCity?: Map}} [data]
 */
export function compareRowsModel(
  pinnedScored,
  { advisoriesByIso3, rentByCity } = {},
) {
  const rows = [];
  const compositeValues = pinnedScored.map((s) => s.composite);
  rows.push({
    type: 'composite',
    label: 'COMPOSITE',
    cells: pinnedScored.map((s) => ({
      text: Number.isFinite(s.composite)
        ? String(Math.round(s.composite))
        : '—',
      bin: binForScore(s.composite),
    })),
    best: bestInRow(compositeValues),
  });
  for (const p of PILLARS) {
    const scores = pinnedScored.map((s) => s.pillars[p].score);
    rows.push({
      type: 'pillar',
      label: PILLAR_LABELS[p],
      cells: pinnedScored.map((s) => ({
        text: Number.isFinite(s.pillars[p].score)
          ? String(Math.round(s.pillars[p].score))
          : '—',
      })),
      best: bestInRow(scores),
    });
    const metricCount = pinnedScored[0]?.pillars?.[p]?.metrics.length ?? 0;
    for (let i = 0; i < metricCount; i++) {
      const metrics = pinnedScored.map((s) => s.pillars[p].metrics[i]);
      const pcts = metrics.map((m) => (m?.status === 'ok' ? m.pct : null));
      rows.push({
        type: 'metric',
        label: metrics.find(Boolean)?.label ?? '',
        cells: metrics.map(metricCompareCell),
        best: bestInRow(pcts),
      });
    }
  }
  rows.push({
    type: 'advisory',
    label: 'Advisory',
    cells: pinnedScored.map((s) =>
      advisoryCompareCell(s, advisoriesByIso3 || {}),
    ),
    best: new Set(),
  });
  rows.push({
    type: 'rent',
    label: 'Rent (US only)',
    cells: pinnedScored.map((s) => rentCompareCell(s, rentByCity || new Map())),
    best: new Set(),
  });
  return rows;
}

// ---------------------------------------------------------------------------
// DOM builders (scorecard view + compare overlay)
// ---------------------------------------------------------------------------

function el(doc, tag, className) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

function text(doc, tag, className, content) {
  const node = el(doc, tag, className);
  node.textContent = content;
  return node;
}

/** Lazily fetch + match Zillow rent once per session (DESIGN §3/§4, US only). */
let rentMapPromise = null;
export function loadRentMap(cities) {
  if (!rentMapPromise) {
    rentMapPromise = fetchRent()
      .then((r) => (r.ok ? matchRentToCities(r.data, cities) : new Map()))
      .catch(() => new Map());
  }
  return rentMapPromise;
}
/** Test-only: drop the module-level rent cache between node:test cases. */
export function resetRentCacheForTest() {
  rentMapPromise = null;
}

function buildMetricRow(doc, row, ctx) {
  const wrap = el(doc, 'div', 'ci-metric');
  const line1 = el(doc, 'div', 'ci-metric-line1');
  const label = text(doc, 'span', 'ci-metric-label', row.metric.label);
  const dirTitle = directionTitle(row.metric.key);
  if (dirTitle) label.title = dirTitle;
  line1.append(label);
  if (row.row.isPassportLink) {
    const link = el(doc, 'button', 'ci-link-btn ci-metric-value');
    link.type = 'button';
    link.textContent = row.row.valueText;
    link.addEventListener('click', () => ctx.onFocusPassport?.());
    line1.append(link);
  } else {
    line1.append(text(doc, 'span', 'ci-metric-value', row.row.valueText));
  }
  line1.append(text(doc, 'span', 'ci-metric-pct', row.row.pctText));
  const bar = el(doc, 'span', 'ci-metric-bar');
  const fill = el(doc, 'span', 'ci-metric-bar-fill');
  fill.style.width = `${row.row.barPct}%`;
  if (Number.isFinite(row.metric.pct)) {
    const bin = binForScore(row.metric.pct);
    fill.style.background =
      bin == null ? 'var(--ci-neutral)' : `var(--ci-score-${bin})`;
  }
  bar.append(fill);
  line1.append(bar);
  wrap.append(line1);
  const line2 = el(doc, 'div', 'ci-metric-line2');
  line2.append(text(doc, 'span', null, row.row.yearSourceText));
  if (row.row.derivedTitle) line2.title = row.row.derivedTitle;
  if (row.row.levelBadge) {
    line2.append(
      text(
        doc,
        'span',
        `ci-badge ci-badge-${row.row.levelBadge.toLowerCase()}`,
        row.row.levelBadge,
      ),
    );
  }
  wrap.append(line2);
  return wrap;
}

function buildPillarBlock(doc, key, pillar, weight, ctx) {
  const model = pillarBlockModel(key, pillar, weight);
  const block = el(doc, 'section', 'ci-pillar');
  block.setAttribute('aria-label', model.label);
  const header = el(doc, 'div', 'ci-pillar-header');
  header.append(text(doc, 'span', 'ci-pillar-name', model.label));
  header.append(el(doc, 'span', 'ci-pillar-leader'));
  const score = text(doc, 'span', 'ci-pillar-score', model.scoreText);
  score.style.color =
    model.bin == null ? 'var(--ci-neutral)' : `var(--ci-score-${model.bin})`;
  header.append(score);
  header.append(text(doc, 'span', 'ci-pillar-coverage', model.coverageWord));
  header.append(text(doc, 'span', 'ci-pillar-weight', model.weightChip));
  block.append(header);
  for (const row of model.metrics)
    if (row.row) block.append(buildMetricRow(doc, row, ctx));
  return block;
}

function buildClimateRow(doc, cityRow) {
  const model = climateStripModel(cityRow);
  if (!model) return null;
  const wrap = el(doc, 'div', 'ci-notscored-row');
  wrap.append(text(doc, 'span', 'ci-notscored-label', 'Climate comfort'));
  const strip = el(doc, 'div', 'ci-climate-strip');
  for (const cell of model.cells) {
    const c = el(doc, 'span', 'ci-climate-cell');
    c.style.background =
      cell.bin == null ? 'var(--ci-neutral)' : `var(--ci-score-${cell.bin})`;
    const initial = el(doc, 'span', 'ci-climate-initial');
    initial.textContent = cell.initial;
    c.append(initial);
    strip.append(c);
  }
  wrap.append(strip);
  if (model.bestSpanText)
    wrap.append(text(doc, 'div', 'ci-notscored-meta', model.bestSpanText));
  return wrap;
}

/** Open-Meteo's European AQI index -> its standard category label. */
export function europeanAqiCategory(value) {
  if (!Number.isFinite(value)) return null;
  if (value <= 20) return 'Good';
  if (value <= 40) return 'Fair';
  if (value <= 60) return 'Moderate';
  if (value <= 80) return 'Poor';
  if (value <= 100) return 'Very Poor';
  return 'Extremely Poor';
}

function buildAirRow(doc, city, signal) {
  const wrap = el(doc, 'div', 'ci-notscored-row');
  wrap.append(text(doc, 'span', 'ci-notscored-label', 'Air quality now'));
  const value = text(doc, 'div', 'ci-notscored-value', 'checking…');
  wrap.append(value);
  fetchAir(city.lat, city.lon, { signal }).then((result) => {
    if (signal.aborted) return;
    if (!result.ok) {
      value.textContent = 'unavailable (source offline)';
      return;
    }
    // server/providers/cityIntel.js: { pm25, europeanAqi, units }.
    const { pm25, europeanAqi } = result.data || {};
    value.textContent = Number.isFinite(pm25)
      ? `PM2.5 ${pm25} µg/m³ · EU AQI ${europeanAqiCategory(europeanAqi) ?? '—'}`
      : 'unavailable (source offline)';
    const time = new Date(result.fetchedAt || Date.now());
    const hhmm = `${String(time.getHours()).padStart(2, '0')}:${String(
      time.getMinutes(),
    ).padStart(2, '0')}`;
    wrap.append(text(doc, 'div', 'ci-notscored-meta', `Open-Meteo · ${hhmm}`));
  });
  return wrap;
}

function buildRentRow(doc, scored, allCities, signal) {
  if (scored.city.iso3 !== 'USA') return null;
  const wrap = el(doc, 'div', 'ci-notscored-row');
  wrap.append(text(doc, 'span', 'ci-notscored-label', 'Rent'));
  const value = text(doc, 'div', 'ci-notscored-value', 'checking…');
  wrap.append(value);
  loadRentMap(allCities).then((map) => {
    if (signal.aborted) return;
    const info = map.get(scored.id);
    value.textContent = info
      ? `$${Math.round(info.zori).toLocaleString()} / mo · ZORI ${info.month} · Zillow · ${info.metro}`
      : 'unavailable (source offline)';
  });
  return wrap;
}

function buildAdvisoryRow(doc, scored, advisoriesByIso3, advisoriesOffline) {
  const wrap = el(doc, 'div', 'ci-notscored-row');
  wrap.append(text(doc, 'span', 'ci-notscored-label', 'Advisory'));
  if (scored.city.iso3 === 'USA') {
    wrap.append(
      text(
        doc,
        'div',
        'ci-notscored-value',
        'No US advisory for domestic destinations.',
      ),
    );
    return wrap;
  }
  if (advisoriesOffline) {
    wrap.append(
      text(doc, 'div', 'ci-notscored-value', 'unavailable (source offline)'),
    );
    return wrap;
  }
  const record = advisoriesByIso3?.[scored.city.iso3];
  if (!record) return null;
  const link = el(doc, 'a', 'ci-notscored-value');
  link.href = record.url || '#';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = `${record.title.replace(': ', ' · ')} · updated ${record.updated.slice(0, 10)} · state.gov`;
  wrap.append(link);
  return wrap;
}

/**
 * Full scorecard content (DESIGN §3), given the current `ScoredCity` and a
 * `ctx` of read-only data and callbacks the panel already holds. Kicks off
 * the abortable live fetches (air, rent) directly; `signal` cancels them.
 */
export function buildScorecard(doc, scored, ctx, signal) {
  const header = scorecardHeaderModel(
    scored,
    ctx.rank,
    ctx.totalCount,
    ctx.advisoryLevel,
  );
  const root = el(doc, 'div', 'ci-scorecard');

  const back = el(doc, 'button', 'ci-link-btn ci-back');
  back.type = 'button';
  back.textContent = '‹ RANKING';
  back.addEventListener('click', () => ctx.onBack());
  root.append(back);

  const headEl = el(doc, 'div', 'ci-scorecard-header');
  headEl.append(text(doc, 'span', 'ci-scorecard-name', header.name));
  const composite = text(
    doc,
    'span',
    'ci-scorecard-composite',
    header.compositeText,
  );
  composite.style.color =
    header.bin == null ? 'var(--ci-neutral)' : `var(--ci-score-${header.bin})`;
  headEl.append(composite);
  root.append(headEl);
  root.append(text(doc, 'div', 'ci-helper', header.metaText));
  root.append(text(doc, 'div', 'ci-helper', header.coverageText));
  if (header.bannerText)
    root.append(text(doc, 'p', 'ci-banner', header.bannerText));

  const actions = el(doc, 'div', 'ci-actions');
  const pinBtn = el(doc, 'button', 'scene-btn');
  pinBtn.type = 'button';
  pinBtn.textContent = ctx.pinned ? 'PINNED' : 'PIN';
  pinBtn.setAttribute('aria-pressed', String(ctx.pinned));
  pinBtn.addEventListener('click', () => ctx.onPin());
  const addBtn = el(doc, 'button', 'scene-btn');
  addBtn.type = 'button';
  addBtn.textContent = 'ADD TO PLAN';
  addBtn.disabled = ctx.planDisabled;
  if (ctx.planTitle) addBtn.title = ctx.planTitle;
  addBtn.addEventListener('click', () => ctx.onAddToPlan());
  const briefBtn = el(doc, 'button', 'scene-btn');
  briefBtn.type = 'button';
  briefBtn.textContent = 'BRIEF ME';
  briefBtn.addEventListener('click', () => ctx.onBriefMe());
  const flyBtn = el(doc, 'button', 'scene-btn');
  flyBtn.type = 'button';
  flyBtn.textContent = 'FLY TO';
  flyBtn.addEventListener('click', () => ctx.onFlyTo());
  actions.append(pinBtn, addBtn, briefBtn, flyBtn);
  root.append(actions);
  if (ctx.inPlanText) root.append(text(doc, 'p', 'ci-helper', ctx.inPlanText));

  for (const p of PILLARS)
    root.append(
      buildPillarBlock(doc, p, scored.pillars[p], ctx.weights[p], ctx),
    );

  const notScored = el(doc, 'section', 'ci-notscored');
  notScored.setAttribute(
    'title',
    'Shown for context; never part of the composite',
  );
  notScored.append(text(doc, 'span', 'ci-section-label', 'NOT SCORED'));
  const climate = buildClimateRow(doc, ctx.seasonalityCities?.[scored.id]);
  if (climate) notScored.append(climate);
  notScored.append(buildAirRow(doc, scored.city, signal));
  const rent = buildRentRow(doc, scored, ctx.allCities, signal);
  if (rent) notScored.append(rent);
  const advisory = buildAdvisoryRow(
    doc,
    scored,
    ctx.advisoriesByIso3,
    ctx.advisoriesOffline,
  );
  if (advisory) notScored.append(advisory);
  root.append(notScored);

  return root;
}

/** Scorecard view factory: owns the abort controller for its live fetches. */
export function createScorecardView({ doc, mount }) {
  let controller = null;
  function render(scored, ctx) {
    controller?.abort();
    controller = new AbortController();
    mount.replaceChildren(buildScorecard(doc, scored, ctx, controller.signal));
  }
  function destroy() {
    controller?.abort();
    mount.replaceChildren();
  }
  return { render, destroy };
}

function buildCompareCell(doc, cell, isBest) {
  const td = el(doc, 'td', isBest ? 'ci-compare-best' : null);
  if (isBest) {
    td.append(text(doc, 'span', 'ci-compare-marker', '▲'));
    td.setAttribute('aria-label', 'best in row');
  }
  if (cell.pctText) {
    td.append(text(doc, 'span', 'ci-compare-pct', cell.pctText));
    td.append(text(doc, 'span', 'ci-compare-raw', ` · ${cell.rawText}`));
    td.title = `${cell.pctText} · ${cell.rawText}`;
    return td;
  }
  const span = text(doc, 'span', null, cell.text);
  if (cell.title) span.title = cell.title;
  if (cell.missing && cell.text === '—')
    span.title = span.title || 'unavailable';
  td.append(span);
  return td;
}

/**
 * Full compare table content (DESIGN §4). `pinnedScored` is 2-4 `ScoredCity`
 * objects in pin order; `ctx.onUnpin(id)` / `ctx.onClearPins()` / `ctx.onClose()`
 * drive the header controls.
 */
export function buildCompareTable(doc, pinnedScored, ctx) {
  const root = el(doc, 'div', 'ci-compare-inner');
  const header = el(doc, 'div', 'ci-compare-header');
  const title = text(
    doc,
    'h2',
    'ci-compare-title',
    `COMPARE · ${pinnedScored.length} CITIES`,
  );
  title.id = 'city-intel-compare-title';
  header.append(title);
  if (ctx.voiceChip)
    header.append(text(doc, 'span', 'ci-voice-chip', 'VIA VOICE'));
  const clearBtn = el(doc, 'button', 'scene-btn');
  clearBtn.type = 'button';
  clearBtn.textContent = 'CLEAR PINS';
  clearBtn.addEventListener('click', () => ctx.onClearPins());
  const closeBtn = el(doc, 'button', 'scene-btn');
  closeBtn.type = 'button';
  closeBtn.textContent = 'CLOSE ✕';
  closeBtn.setAttribute('aria-label', 'Close compare');
  closeBtn.addEventListener('click', () => ctx.onClose());
  header.append(clearBtn, closeBtn);
  root.append(header);

  const table = el(doc, 'table', 'ci-compare-table');
  const caption = el(doc, 'caption', 'ci-visually-hidden');
  caption.textContent = 'Comparison of pinned cities';
  table.append(caption);
  const thead = el(doc, 'thead');
  const headRow = el(doc, 'tr');
  headRow.append(el(doc, 'th'));
  pinnedScored.forEach((s) => {
    const th = el(doc, 'th');
    th.scope = 'col';
    th.append(text(doc, 'span', 'ci-compare-city-name', s.city.name));
    th.append(text(doc, 'span', 'ci-compare-city-country', s.city.country));
    const unpin = el(doc, 'button', 'ci-compare-unpin');
    unpin.type = 'button';
    unpin.textContent = '✕';
    unpin.setAttribute('aria-label', `Unpin ${s.city.name}`);
    unpin.addEventListener('click', () => ctx.onUnpin(s.id));
    th.append(unpin);
    headRow.append(th);
  });
  thead.append(headRow);
  table.append(thead);

  const tbody = el(doc, 'tbody');
  const rows = compareRowsModel(pinnedScored, {
    advisoriesByIso3: ctx.advisoriesByIso3,
    rentByCity: ctx.rentByCity,
  });
  for (const row of rows) {
    const tr = el(doc, 'tr', `ci-compare-row-${row.type}`);
    const th = el(doc, 'th');
    th.scope = 'row';
    th.textContent = row.label;
    tr.append(th);
    row.cells.forEach((cell, i) =>
      tr.append(buildCompareCell(doc, cell, row.best.has(i))),
    );
    tbody.append(tr);
  }
  table.append(tbody);
  root.append(table);
  return root;
}

/** Compare overlay factory: renders into `mount` (`#city-intel-compare`). */
export function createCompareOverlay({ doc, mount }) {
  function render(pinnedScored, ctx) {
    mount.replaceChildren(buildCompareTable(doc, pinnedScored, ctx));
    mount.hidden = false;
  }
  function clear() {
    mount.hidden = true;
    mount.replaceChildren();
  }
  return { render, clear };
}
