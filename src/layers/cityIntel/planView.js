/**
 * @file Lifestyle Plan view: DOM for `#ci-plan-view` (docs/cockpit/DESIGN.md
 * §11, SPEC §3.5). Every number comes from `plan.js`; this file only reads,
 * formats and wires DOM. No Cesium here — `flyTo`/`switchMode` are injected.
 * @module layers/cityIntel/planView
 */
import { searchCities } from '../../travel/citySearch.js';
import { binForScore } from './index.js';
import {
  monthsOf,
  spanLabel,
  overlaps,
  firstFreeMonth,
  addStay as planAddStay,
  updateStay as planUpdateStay,
  removeStay as planRemoveStay,
  stayMetrics,
  rollup as planRollup,
} from './plan.js';
import {
  MONTH_ABBR,
  COMFORT_LABELS,
  comfortBin,
} from '../../travel/seasonality.js';

const MAX_HEATMAP_ROWS = 6;

/** "NOV–FEB" (drop spanLabel's " · N mo" suffix; no month-wrap math re-done). */
const spanCore = (stay) => spanLabel(stay).split(' · ')[0];
const fmtUsd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const fmtRatio = (r) => `×${r.toFixed(2)} home`;
const monthsCoveredOf = (stays) => new Set(stays.flatMap(monthsOf)).size;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests; no DOM).
// ---------------------------------------------------------------------------

/**
 * Wrap-aware consecutive runs of months, formatted "MAR–APR" / "DEC–JAN".
 * @param {number[]} months 1..12, any order
 * @returns {string[]} formatted runs, in calendar order starting from a
 *   run that is not preceded by another member (so DEC–JAN is one run)
 */
export function gapRuns(months) {
  const set = new Set(months);
  if (!set.size) return [];
  if (set.size === 12) return [`${MONTH_ABBR[0]}–${MONTH_ABBR[11]}`];
  const runs = [];
  for (let m = 1; m <= 12; m++) {
    const prev = m === 1 ? 12 : m - 1;
    if (!set.has(m) || set.has(prev)) continue;
    let len = 0;
    let cur = m;
    while (set.has(cur)) {
      len++;
      cur = cur === 12 ? 1 : cur + 1;
    }
    runs.push({ start: m, len });
  }
  return runs.map(({ start, len }) => {
    const end = ((start - 1 + len - 1) % 12) + 1;
    return len === 1
      ? MONTH_ABBR[start - 1]
      : `${MONTH_ABBR[start - 1]}–${MONTH_ABBR[end - 1]}`;
  });
}

/**
 * "Year: gap JAN–FEB, Lisbon MAR–MAY, gap JUN–OCT, Valencia NOV–DEC.
 * 7 of 12 months covered." (DESIGN §11.4 wording pattern), for stays that
 * already carry a `name`.
 * @param {Array<{name?: string, cityId: string, start: number, len: number}>} stays
 */
export function planAriaLabel(stays) {
  if (!stays.length) return 'Year: no stays. 0 of 12 months covered.';
  const owner = new Array(13).fill(null);
  for (const s of stays) for (const m of monthsOf(s)) owner[m] = s;
  const segments = [];
  let i = 1;
  while (i <= 12) {
    const cur = owner[i];
    let j = i;
    while (j <= 12 && owner[j] === cur) j++;
    const startAbbr = MONTH_ABBR[i - 1];
    const endAbbr = MONTH_ABBR[j - 2];
    const span = j - 1 === i ? startAbbr : `${startAbbr}–${endAbbr}`;
    segments.push(cur ? `${cur.name || cur.cityId} ${span}` : `gap ${span}`);
    i = j;
  }
  return `Year: ${segments.join(', ')}. ${monthsCoveredOf(stays)} of 12 months covered.`;
}

/**
 * Seasonality heatmap: rows = the plan's unique cities (max 6), cols = the
 * 12 months. Cell tint is that city's comfort in that month via the same
 * 5-bin score ramp `binForScore` uses; `chosen` marks the months that city
 * is actually booked for; `gap` marks a month the whole plan leaves open.
 * @param {Array<{id: string, cityId: string, name?: string, start: number, len: number}>} stays
 * @param {{cities?: Record<string, {months: Array<{score: number}>}>}} seasonality
 * @param {Map<string, object>} citiesById
 */
export function heatmapModel(stays, seasonality, citiesById) {
  const cityIds = [];
  for (const stay of stays)
    if (!cityIds.includes(stay.cityId)) cityIds.push(stay.cityId);
  const truncated = cityIds.length > MAX_HEATMAP_ROWS;
  const rowCityIds = cityIds.slice(0, MAX_HEATMAP_ROWS);

  const covered = new Set(stays.flatMap(monthsOf));
  const gapMonths = [];
  for (let m = 1; m <= 12; m++) if (!covered.has(m)) gapMonths.push(m);
  const gapSet = new Set(gapMonths);

  const rows = rowCityIds.map((cityId) => {
    const city = citiesById?.get(cityId) ?? null;
    const name = city?.name ?? cityId;
    const iata = city?.airport?.iata ?? null;
    const chosen = new Set(
      stays.filter((s) => s.cityId === cityId).flatMap(monthsOf),
    );
    const cityRow = seasonality?.cities?.[cityId] ?? null;
    const cells = [];
    for (let m = 1; m <= 12; m++) {
      const score = Number.isFinite(cityRow?.months?.[m - 1]?.score)
        ? cityRow.months[m - 1].score
        : null;
      const missing = score === null;
      const title = missing
        ? `${MONTH_ABBR[m - 1]} · ${name} · no climate data`
        : `${MONTH_ABBR[m - 1]} · ${name} · comfort ${score} ${COMFORT_LABELS[comfortBin(score)]}`;
      cells.push({
        month: m,
        score,
        bin: missing ? null : binForScore(score),
        chosen: chosen.has(m),
        gap: gapSet.has(m),
        missing,
        title,
      });
    }
    return { cityId, name, iata, cells };
  });

  return { rows, gapMonths, ariaLabel: planAriaLabel(stays), truncated };
}

/**
 * Exact DESIGN §11.3 COST row copy from one stay's `stayMetrics(...).cost`.
 * @param {object} cost
 * @returns {{text: string, title: string|null}}
 */
export function costCopy(cost) {
  if (!cost) return { text: '—', title: null };
  switch (cost.basis) {
    case 'no-home':
    case 'unavailable':
      return { text: cost.label, title: null };
    case 'ratio-only':
      return { text: `${fmtRatio(cost.ratio)} · ${cost.label}`, title: null };
    case 'estimate': {
      let title = `Estimate from country price levels (consumption basket, World Bank ${cost.ratioYears.stay}); expat costs often differ`;
      if (
        cost.ratioYears.home != null &&
        cost.ratioYears.home !== cost.ratioYears.stay
      )
        title += ` · home country year ${cost.ratioYears.home}`;
      return {
        text: `${fmtRatio(cost.ratio)} · ≈ ${fmtUsd(cost.estimateUsd)}/mo est.`,
        title,
      };
    }
    case 'override': {
      const prefix = cost.ratio != null ? `${fmtRatio(cost.ratio)} · ` : '';
      return {
        text: `${prefix}${fmtUsd(cost.override)}/mo · your figure`,
        title: null,
      };
    }
    default:
      return { text: '—', title: null };
  }
}

/**
 * Exact DESIGN §11.3 VISA row copy from one stay's `stayMetrics(...).visa`.
 * A plain string — unlike `costCopy`, no branch here ever carries a title.
 * @param {object} visa
 * @returns {string}
 */
export function visaCopy(visa) {
  if (!visa) return '—';
  switch (visa.status) {
    case 'ok':
      return visa.allowanceDays == null
        ? 'ok · no visa needed'
        : `ok · ${visa.allowanceDays} days visa-free`;
    case 'exceeds':
      return `stay exceeds visa-free days (${visa.allowanceDays})`;
    case 'no-passport':
      return 'set your passport';
    case 'unknown':
      return visa.requirement
        ? `${visa.requirement.toLowerCase()} · days not known`
        : 'no visa data for this destination';
    case 'offline':
      return 'unavailable (source offline)';
    default:
      return '—';
  }
}

/**
 * DESIGN §11.5 ROLLUP row copy from `plan.js`'s `rollup(...)` result. `extra`
 * carries the bits `rollup()` does not compute (needs per-stay metrics or
 * profile state the caller already has): whether any stay's cost is a
 * manual override, how many priced months lack seasonality, and why zero
 * months are priced.
 * @param {object} rollup
 * @param {{hasOverride?: boolean, missingComfortMonths?: number, zeroPricedReason?: string}} [extra]
 */
export function rollupCopy(rollup, extra = {}) {
  const {
    hasOverride = false,
    missingComfortMonths = 0,
    zeroPricedReason,
  } = extra;

  const gaps = rollup.gaps.length
    ? `gaps ${gapRuns(rollup.gaps).join(', ')}`
    : 'no gaps';
  const monthsCovered = `${rollup.monthsCovered}/12 · ${gaps}`;

  const fitWeighted =
    rollup.fitMean == null ? '—' : `${Math.round(rollup.fitMean)}`;

  let annualCost;
  if (rollup.annualCost.complete) {
    annualCost = `≈ ${fmtUsd(rollup.annualCost.usd)} / yr est.`;
    if (hasOverride) annualCost += ' · includes your figures';
  } else if (rollup.annualCost.coveredMonths === 0) {
    annualCost = zeroPricedReason || 'no priced months';
  } else {
    annualCost = rollup.annualCost.label;
  }

  let comfortWeighted;
  if (rollup.comfortMean == null) comfortWeighted = '—';
  else {
    comfortWeighted = `${Math.round(rollup.comfortMean)} · ${COMFORT_LABELS[comfortBin(rollup.comfortMean)]}`;
    if (missingComfortMonths > 0)
      comfortWeighted += ` · ${missingComfortMonths} months without data`;
  }

  const highestAdvisory =
    rollup.maxAdvisory == null ? '—' : `L${rollup.maxAdvisory}`;

  const moves =
    rollup.moves === 0
      ? '0 · 0 km'
      : `${rollup.moves} · ${rollup.km.toLocaleString('en-US')} km · ${
          rollup.gaps.length === 0
            ? 'loop closed'
            : 'open (loop closes at 12/12)'
        }`;

  return {
    monthsCovered,
    fitWeighted,
    annualCost,
    comfortWeighted,
    highestAdvisory,
    moves,
  };
}

// ---------------------------------------------------------------------------
// DOM helper
// ---------------------------------------------------------------------------

// `list`'s IDL property is read-only (reflects the resolved <datalist>
// element); it must always go through setAttribute to associate by id.
const ATTR_ONLY_PROPS = new Set(['list']);

/** Terse element builder: never sets innerHTML, always textContent. */
function h(doc, tag, props = {}, kids = []) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function')
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (!ATTR_ONLY_PROPS.has(k) && k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) if (kid) node.appendChild(kid);
  return node;
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

/**
 * @param {{doc?: Document, container: Element, store: object, pack: {cities: object[], citiesById: Map, countries: object, seasonality: object}, getCtx: Function, getPrefs: Function, setPrefs: Function, showToast?: Function, announce?: Function, flyTo?: Function, switchMode?: Function}} deps
 */
export function createPlanView({
  doc = document,
  container,
  store,
  pack,
  getCtx,
  getPrefs,
  setPrefs,
  showToast,
  announce,
  flyTo,
  switchMode,
} = {}) {
  const { citiesById, countries, seasonality } = pack;
  let planTripId = null;
  let voiceTimer = null;
  let voiceChipEl = null;
  // Loop-2 fix: the chip's own DOM node is rebuilt on every render() (the
  // container is cleared each time), so "still within the 4s voice window"
  // must live here, not on a `hidden` flag of a node that's about to be
  // discarded — a stay edit mid-window used to snap the chip away early.
  let voiceMarkedAt = null;
  let dupNamesCache = null;
  /** DESIGN §11.3: the one stay-card error shown, cleared on that stay's next successful edit. */
  let stayError = null;

  const cityRecord = (cityId) => citiesById.get(cityId) ?? null;

  function dupNames() {
    if (dupNamesCache) return dupNamesCache;
    dupNamesCache = new Map();
    for (const c of pack.cities) {
      const key = `${c.name}|${c.country}`;
      dupNamesCache.set(key, (dupNamesCache.get(key) || 0) + 1);
    }
    return dupNamesCache;
  }
  function homeOptionLabel(city) {
    const dup = (dupNames().get(`${city.name}|${city.country}`) || 0) > 1;
    return dup && city.admin1
      ? `${city.name} (${city.admin1}), ${city.country}`
      : `${city.name}, ${city.country}`;
  }

  function planTrip() {
    return store.getPlanTrip();
  }
  function getStays() {
    return planTrip()?.nodes ?? [];
  }
  function persist(nodes) {
    // DESIGN §11.6: ADD TO PLAN works from RANK before PLAN has ever been
    // shown, so the plan trip may not exist yet — create it (not made
    // active; that's `show()`'s job) rather than silently dropping the edit.
    const trip = store.ensurePlanTrip();
    store.setNodes(trip.id, nodes);
  }
  function toNode(stay) {
    const city = cityRecord(stay.cityId);
    return {
      ...stay,
      name: city?.name ?? stay.cityId,
      lat: city?.lat,
      lng: city?.lon,
      iata: city?.airport?.iata,
    };
  }
  function buildCtx() {
    const live = getCtx?.() ?? {};
    const prefs = getPrefs?.() ?? {};
    return {
      scoredById: live.scoredById ?? new Map(),
      advisories: live.advisories,
      visa: live.visa,
      rentByCity: live.rentByCity,
      countries,
      seasonality,
      citiesById,
      profile: {
        homeCityId: prefs.homeCityId,
        monthlySpendUsd: prefs.monthlySpendUsd,
      },
      overrides: prefs.overrides ?? {},
    };
  }

  // -- mutation API ----------------------------------------------------

  /** DESIGN §11.6: start = firstFreeMonth, len = largest of 3/2/1 that fits. */
  function addStay(cityId) {
    const stays = getStays();
    const start = firstFreeMonth(stays);
    if (start === null)
      return {
        ok: false,
        error: 'full',
        message: 'Plan is full (12/12). Remove or shorten a stay in PLAN.',
      };
    const len = [3, 2, 1].find(
      (n) => overlaps(stays, { start, len: n }).length === 0,
    );
    const result = planAddStay(stays, { cityId, start, len });
    if (!result.ok)
      return {
        ok: false,
        error: result.error,
        message: 'Could not add that stay.',
      };
    const newStay = result.stays.find((s) => !stays.includes(s));
    const nodes = result.stays.map((s) => (s === newStay ? toNode(s) : s));
    persist(nodes);
    render();
    const city = cityRecord(cityId);
    const message = `Added ${city?.name ?? cityId} to plan: ${spanCore(newStay)} (${newStay.len} mo). ${monthsCoveredOf(nodes)} of 12 months covered.`;
    return { ok: true, stay: toNode(newStay), message };
  }

  /** Voice `plan_lifestyle`: validate the whole plan, then one setNodes. */
  function replacePlan(list) {
    if (!Array.isArray(list) || !list.length)
      return {
        ok: false,
        error: 'invalid',
        detail: 'A plan needs at least one stay.',
      };
    let stays = [];
    for (const item of list) {
      const result = planAddStay(stays, item);
      if (!result.ok)
        return {
          ok: false,
          error: result.error,
          detail: cityRecord(item?.cityId)?.name ?? item?.cityId ?? 'unknown',
        };
      stays = result.stays;
    }
    const nodes = stays.map(toNode);
    persist(nodes);
    render();
    // DESIGN §8: "Plan replaced by voice: Lisbon JAN–APR, ... . 12 of 12 months."
    announce?.(
      `Plan replaced by voice: ${nodes.map((n) => `${n.name} ${spanCore(n)}`).join(', ')}. ${monthsCoveredOf(nodes)} of 12 months.`,
    );
    return { ok: true, stays: nodes };
  }

  function updateStayLocal(id, patch) {
    const stays = getStays();
    const result = planUpdateStay(stays, id, patch);
    if (!result.ok) {
      if (result.error === 'overlap') {
        const owner = stays.find(
          (s) => s.id !== id && monthsOf(s).includes(result.months[0]),
        );
        const label = owner
          ? `${owner.name} (${spanCore(owner)})`
          : 'another stay';
        const text = `Overlaps ${label}. Shorten or move one of them.`;
        stayError = { id, text };
        showToast?.(text);
        announce?.(text);
      }
      render();
      return;
    }
    if (stayError?.id === id) stayError = null;
    persist(result.stays);
    const stay = result.stays.find((s) => s.id === id);
    announce?.(
      `${stay.name} moved to ${spanCore(stay)}. ${monthsCoveredOf(result.stays)} of 12 months covered.`,
    );
    render();
  }

  function removeStayLocal(id) {
    const stays = getStays();
    const stay = stays.find((s) => s.id === id);
    const result = planRemoveStay(stays, id);
    if (!result.ok) return;
    if (stayError?.id === id) stayError = null;
    persist(result.stays);
    const prefs = getPrefs?.() ?? {};
    if (prefs.overrides && id in prefs.overrides) {
      const overrides = { ...prefs.overrides };
      delete overrides[id];
      setPrefs?.({ overrides });
    }
    announce?.(
      `${stay?.name ?? 'Stay'} removed. ${monthsCoveredOf(result.stays)} of 12 months covered.`,
    );
    render();
  }

  function onCostOverrideChange(stayId, rawValue) {
    const prefs = getPrefs?.() ?? {};
    const overrides = { ...(prefs.overrides ?? {}) };
    const trimmed = String(rawValue ?? '').trim();
    if (trimmed === '') delete overrides[stayId];
    else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) return;
      overrides[stayId] = n;
    }
    setPrefs?.({ overrides });
    render();
  }

  function onHomeChange(rawValue) {
    const text = String(rawValue ?? '').trim();
    if (!text) {
      setPrefs?.({ homeCityId: undefined });
      announce?.('Set home to compare costs.');
      render();
      return;
    }
    const exact = pack.cities.find((c) => homeOptionLabel(c) === text);
    const resolved = exact ?? searchCities(pack.cities, text, 1)[0];
    if (!resolved) {
      render(`No city called "${text}" in the pack.`);
      return;
    }
    setPrefs?.({ homeCityId: resolved.id });
    announce?.(`Home set to ${resolved.name}, ${resolved.country}.`);
    render();
  }

  function onSpendChange(rawValue) {
    const trimmed = String(rawValue ?? '').trim();
    const n = Number(trimmed);
    setPrefs?.({
      monthlySpendUsd: trimmed === '' || !Number.isFinite(n) ? undefined : n,
    });
    render();
  }

  // -- read API ----------------------------------------------------------

  function getSummary() {
    const ctx = buildCtx();
    const stays = getStays();
    const metrics = new Map();
    for (const stay of stays) metrics.set(stay.id, stayMetrics(stay, ctx));
    const roll = planRollup(stays, metrics, citiesById);
    return {
      stays: stays.map((stay) => {
        const city = cityRecord(stay.cityId);
        return {
          id: stay.id,
          cityId: stay.cityId,
          name: city?.name ?? stay.name ?? stay.cityId,
          country: city?.country ?? null,
          span: spanLabel(stay),
          metrics: metrics.get(stay.id),
        };
      }),
      rollup: roll,
    };
  }

  function markVoice(splitSentence) {
    voiceMarkedAt = Date.now();
    if (voiceChipEl) voiceChipEl.hidden = false;
    clearTimeout(voiceTimer);
    voiceTimer = setTimeout(() => {
      voiceMarkedAt = null;
      if (voiceChipEl) voiceChipEl.hidden = true;
    }, 4000);
    if (splitSentence) announce?.(splitSentence);
    // DESIGN §8: the only caller of markVoice() is the plan_lifestyle voice
    // path (replacePlan already committed the new stays by the time this fires).
    showToast?.(`Plan replaced by voice (${getStays().length} stays)`);
  }

  // -- render --------------------------------------------------------------

  function renderProfile(root, prefs) {
    const profile = h(doc, 'div', { class: 'ci-profile' });
    const homeCity = prefs.homeCityId ? cityRecord(prefs.homeCityId) : null;

    const homeRow = h(doc, 'div', { class: 'ci-home-row' }, [
      h(doc, 'label', {
        for: 'ci-home',
        class: 'ci-section-label',
        text: 'HOME',
      }),
      h(doc, 'input', {
        id: 'ci-home',
        class: 'pp-select',
        type: 'search',
        list: 'ci-home-list',
        autocomplete: 'off',
        placeholder: 'City to compare costs against',
        value: homeCity ? homeOptionLabel(homeCity) : '',
        onchange: (e) => onHomeChange(e.target.value),
      }),
      h(
        doc,
        'datalist',
        { id: 'ci-home-list' },
        pack.cities.map((c) => h(doc, 'option', { value: homeOptionLabel(c) })),
      ),
    ]);
    const homeHelper = h(doc, 'p', {
      id: 'ci-home-helper',
      class: 'ci-helper',
      text: homeCity
        ? `Home: ${homeCity.name} · ${homeCity.country} · ${homeCity.iso3}`
        : 'Set home to compare costs.',
    });

    const spendRow = h(doc, 'div', { class: 'ci-spend-row' }, [
      h(doc, 'label', {
        for: 'ci-spend',
        class: 'ci-section-label',
        text: 'MONTHLY SPEND',
      }),
      h(doc, 'span', { class: 'ci-spend-prefix', text: '$' }),
      h(doc, 'input', {
        id: 'ci-spend',
        class: 'pp-select',
        type: 'number',
        min: '0',
        step: '50',
        inputmode: 'numeric',
        value: Number.isFinite(prefs.monthlySpendUsd)
          ? String(prefs.monthlySpendUsd)
          : '',
        onchange: (e) => onSpendChange(e.target.value),
      }),
      h(doc, 'span', { class: 'ci-spend-suffix', text: '/ mo' }),
    ]);
    const spendHelper = h(doc, 'p', {
      class: 'ci-helper',
      text: 'All-in monthly spend at home in USD, rent included. Only used to turn ×home ratios into dollar estimates.',
    });

    const usingLine = h(doc, 'p', { class: 'ci-helper' }, [
      doc.createTextNode('Edit weights and passport in RANK. '),
      h(doc, 'button', {
        type: 'button',
        class: 'ci-link-btn',
        text: 'edit in RANK',
        onclick: () => switchMode?.('rank'),
      }),
    ]);

    profile.append(homeRow, homeHelper, spendRow, spendHelper, usingLine);
    root.appendChild(profile);
  }

  function renderHeatmap(root, stays) {
    const model = heatmapModel(stays, seasonality, citiesById);
    const heat = h(doc, 'div', {
      class: 'ci-heat',
      role: 'img',
      'aria-label': model.ariaLabel,
    });
    heat.appendChild(
      h(
        doc,
        'div',
        { class: 'ci-heat-months' },
        MONTH_ABBR.map((m) => h(doc, 'span', { text: m[0] })),
      ),
    );
    for (const row of model.rows) {
      const header = h(doc, 'span', {
        class: 'ci-heat-row-label',
        text: row.iata ? `${row.name} · ${row.iata}` : row.name,
      });
      const cellsWrap = h(
        doc,
        'div',
        { class: 'ci-heat-cells' },
        row.cells.map((cell) =>
          h(doc, 'span', {
            class: 'ci-heat-cell',
            title: cell.title,
            'data-bin': cell.missing ? 'missing' : String(cell.bin),
            'data-chosen': cell.chosen ? 'true' : 'false',
            'data-gap': cell.gap ? 'true' : 'false',
          }),
        ),
      );
      heat.appendChild(
        h(doc, 'div', { class: 'ci-heat-row' }, [header, cellsWrap]),
      );
    }
    root.appendChild(heat);
    if (model.truncated)
      root.appendChild(
        h(doc, 'p', {
          class: 'ci-helper',
          text: 'Showing the first 6 cities in the plan.',
        }),
      );
  }

  function renderEmpty(root) {
    root.appendChild(
      h(doc, 'p', {
        class: 'ci-list-empty',
        text: '0/12 months',
      }),
    );
    const stays = h(doc, 'div', { class: 'ci-stays-empty' }, [
      h(doc, 'p', {
        class: 'ci-list-empty',
        text: 'No stays yet. Open a city in RANK and use ADD TO PLAN.',
      }),
      h(doc, 'button', {
        type: 'button',
        class: 'scene-btn',
        text: 'GO TO RANK',
        onclick: () => switchMode?.('rank'),
      }),
    ]);
    root.appendChild(stays);
  }

  function metricRow(labelText, valueNode) {
    return h(doc, 'div', { class: 'ci-stay-metric' }, [
      h(doc, 'span', { class: 'ci-stay-metric-label', text: labelText }),
      valueNode,
    ]);
  }

  function renderFitRow(m) {
    if (!m.fit)
      return metricRow(
        'FIT',
        h(doc, 'span', { class: 'ci-stay-metric-value', text: 'not ranked' }),
      );
    const bin = binForScore(m.fit.score);
    const bar = h(doc, 'span', { class: 'ci-row-bar' }, [
      h(doc, 'span', {
        class: 'ci-row-bar-fill',
        style: `width:${Math.max(0, Math.min(100, m.fit.score))}%;background:var(--ci-score-${bin ?? 0})`,
      }),
    ]);
    const value = h(doc, 'span', {
      class: 'ci-stay-metric-value',
      title: m.fit.coverageText,
      text: `${Math.round(m.fit.score)}`,
    });
    return h(doc, 'div', { class: 'ci-stay-metric' }, [
      h(doc, 'span', { class: 'ci-stay-metric-label', text: 'FIT' }),
      value,
      bar,
    ]);
  }

  function renderCostRow(stay, m) {
    const copy = costCopy(m.cost);
    const wrap = h(doc, 'div', { class: 'ci-stay-metric' });
    wrap.appendChild(
      h(doc, 'span', { class: 'ci-stay-metric-label', text: 'COST' }),
    );
    if (m.cost.basis === 'no-home')
      wrap.appendChild(
        h(doc, 'button', {
          type: 'button',
          class: 'ci-link-btn',
          text: copy.text,
          onclick: () => doc.getElementById('ci-home')?.focus(),
        }),
      );
    else
      wrap.appendChild(
        h(doc, 'span', {
          class: 'ci-stay-metric-value',
          title: copy.title,
          text: copy.text,
        }),
      );
    const overrideRow = h(doc, 'div', { class: 'ci-stay-override' }, [
      h(doc, 'span', { text: '$' }),
      h(doc, 'input', {
        type: 'number',
        min: '0',
        step: '50',
        inputmode: 'numeric',
        placeholder: 'your figure',
        'aria-label': `Your monthly figure for ${stay.name}, USD`,
        value: Number.isFinite(m.cost.override) ? String(m.cost.override) : '',
        onchange: (e) => onCostOverrideChange(stay.id, e.target.value),
      }),
    ]);
    if (m.cost.rentInfo)
      wrap.append(
        overrideRow,
        h(doc, 'p', {
          class: 'ci-helper',
          text: `Rent ref. $${m.cost.rentInfo.zori.toLocaleString('en-US')}/mo · ZORI ${m.cost.rentInfo.month} · Zillow · ${m.cost.rentInfo.metro} · not added (spend includes housing)`,
        }),
      );
    else wrap.appendChild(overrideRow);
    return wrap;
  }

  function renderComfortRow(m) {
    if (m.comfort.status !== 'ok')
      return metricRow(
        'COMFORT',
        h(doc, 'span', { class: 'ci-stay-metric-value', text: 'unavailable' }),
      );
    const bin = comfortBin(m.comfort.mean);
    return metricRow(
      'COMFORT',
      h(doc, 'span', {
        class: 'ci-stay-metric-value',
        title: 'Mean monthly comfort · NASA POWER 2001–2020',
        text: `${Math.round(m.comfort.mean)} · ${COMFORT_LABELS[bin]}`,
      }),
    );
  }

  function renderSafetyRow(m) {
    const scoreText =
      m.safety.score == null ? '—' : `${Math.round(m.safety.score)}`;
    const coverage = m.safety.coverage.toUpperCase();
    const level = m.advisory.level;
    const badge = h(doc, 'span', {
      class: 'ci-row-advisory',
      'data-level': level == null ? undefined : String(level),
      text: level == null ? '—' : `L${level}`,
    });
    return h(doc, 'div', { class: 'ci-stay-metric' }, [
      h(doc, 'span', { class: 'ci-stay-metric-label', text: 'SAFETY' }),
      h(doc, 'span', {
        class: 'ci-stay-metric-value',
        text: `${scoreText} · ${coverage} · `,
      }),
      badge,
    ]);
  }

  function renderVisaRow(m) {
    const text = visaCopy(m.visa);
    if (m.visa.status === 'no-passport')
      return h(doc, 'div', { class: 'ci-stay-metric' }, [
        h(doc, 'span', { class: 'ci-stay-metric-label', text: 'VISA' }),
        h(doc, 'button', {
          type: 'button',
          class: 'ci-link-btn',
          text,
          onclick: () => switchMode?.('rank'),
        }),
      ]);
    return metricRow(
      'VISA',
      h(doc, 'span', { class: 'ci-stay-metric-value', text }),
    );
  }

  function renderStayCard(stay, stays, metrics) {
    const m = metrics.get(stay.id);
    const card = h(doc, 'li', { class: 'ci-stay' });

    const head = h(doc, 'div', { class: 'ci-stay-head' }, [
      h(doc, 'span', { class: 'ci-stay-index' }),
      h(doc, 'button', {
        type: 'button',
        class: 'ci-stay-title',
        text: `${stay.name} · ${cityRecord(stay.cityId)?.country ?? ''}`,
        onclick: () => flyTo?.(stay),
      }),
      h(doc, 'button', {
        type: 'button',
        class: 'ci-stay-remove',
        'aria-label': `Remove ${stay.name} (${spanCore(stay)}) from plan`,
        text: '✕',
        onclick: () => removeStayLocal(stay.id),
      }),
    ]);

    const startSelect = h(doc, 'select', {
      'aria-label': `Start month, ${stay.name}`,
      class: 'pp-select',
      onchange: (e) =>
        updateStayLocal(stay.id, { start: Number(e.target.value) }),
    });
    for (let month = 1; month <= 12; month++)
      startSelect.appendChild(
        h(doc, 'option', {
          value: String(month),
          selected: month === stay.start,
          disabled:
            month !== stay.start &&
            overlaps(stays, { start: month, len: stay.len }, stay.id).length >
              0,
          text: MONTH_ABBR[month - 1],
        }),
      );

    const lenSelect = h(doc, 'select', {
      'aria-label': `Length in months, ${stay.name}`,
      class: 'pp-select',
      onchange: (e) =>
        updateStayLocal(stay.id, { len: Number(e.target.value) }),
    });
    for (let len = 1; len <= 12; len++)
      lenSelect.appendChild(
        h(doc, 'option', {
          value: String(len),
          selected: len === stay.len,
          disabled:
            len !== stay.len &&
            overlaps(stays, { start: stay.start, len }, stay.id).length > 0,
          text: `${len} mo`,
        }),
      );

    const when = h(doc, 'div', { class: 'ci-stay-when' }, [
      h(doc, 'output', { text: spanLabel(stay) }),
      startSelect,
      lenSelect,
    ]);
    const errorLine =
      stayError?.id === stay.id
        ? h(doc, 'p', { class: 'ci-stay-error', text: stayError.text })
        : null;

    card.append(
      ...[
        head,
        when,
        errorLine,
        renderFitRow(m),
        renderCostRow(stay, m),
        renderComfortRow(m),
        renderSafetyRow(m),
        renderVisaRow(m),
      ].filter(Boolean),
    );
    return card;
  }

  /**
   * The run of consecutive uncovered months immediately before `start`,
   * walking backward (wrap-aware): the gap "that ends at stay 1's start is
   * drawn above stay 1" (DESIGN §11.3), even when it wraps through December.
   */
  function gapRunBefore(covered, start) {
    const months = [];
    let m = start === 1 ? 12 : start - 1;
    while (!covered.has(m) && months.length < 12) {
      months.unshift(m);
      m = m === 1 ? 12 : m - 1;
    }
    return months;
  }

  function renderStays(root, stays, metrics) {
    const list = h(doc, 'ol', { class: 'ci-stays' });
    const covered = new Set(stays.flatMap(monthsOf));
    for (const stay of stays) {
      const gapMonths = gapRunBefore(covered, stay.start);
      if (gapMonths.length)
        list.appendChild(
          h(doc, 'li', {
            class: 'ci-gap',
            role: 'listitem',
            text: `— gap · ${gapRuns(gapMonths)[0]} · ${gapMonths.length} mo —`,
          }),
        );
      list.appendChild(renderStayCard(stay, stays, metrics));
    }
    root.appendChild(list);
  }

  function renderRollup(root, stays, ctx, metrics) {
    const roll = planRollup(stays, metrics, citiesById);
    const hasOverride = [...metrics.values()].some(
      (m) => m.cost.basis === 'override',
    );
    const missingComfortMonths = stays.reduce(
      (sum, s) => sum + (metrics.get(s.id).comfort.status === 'ok' ? 0 : s.len),
      0,
    );
    let zeroPricedReason;
    if (!ctx.profile.homeCityId)
      zeroPricedReason = 'set home and monthly spend';
    else if (!Number.isFinite(ctx.profile.monthlySpendUsd))
      zeroPricedReason = 'set monthly spend';
    const copy = rollupCopy(roll, {
      hasOverride,
      missingComfortMonths,
      zeroPricedReason,
    });

    const rows = [
      ['MONTHS COVERED', copy.monthsCovered],
      ['FIT · WEIGHTED', copy.fitWeighted],
      ['ANNUAL COST', copy.annualCost],
      ['COMFORT · WEIGHTED', copy.comfortWeighted],
      ['HIGHEST ADVISORY', copy.highestAdvisory],
      ['MOVES', copy.moves],
    ];
    const section = h(doc, 'div', { class: 'ci-rollup' }, [
      h(doc, 'span', { class: 'ci-section-label', text: 'ROLLUP · YEAR' }),
      ...rows.map(([label, value]) =>
        h(doc, 'div', { class: 'ci-rollup-row' }, [
          h(doc, 'span', { class: 'ci-rollup-label', text: label }),
          h(doc, 'span', { class: 'ci-rollup-value', text: value }),
        ]),
      ),
      h(doc, 'p', {
        class: 'ci-helper',
        text: 'Visa flags are per stay. The Schengen 90/180-day rule across stays is not checked in v1.',
      }),
    ]);
    root.appendChild(section);
  }

  function render(homeError) {
    if (!container) return;
    container.textContent = '';
    const root = h(doc, 'div', { class: 'ci-plan' });
    voiceChipEl = h(doc, 'span', {
      class: 'ci-voice-chip',
      hidden: !(voiceMarkedAt && Date.now() - voiceMarkedAt < 4000),
      text: 'VIA VOICE',
    });
    root.appendChild(voiceChipEl);

    const prefs = getPrefs?.() ?? {};
    renderProfile(root, prefs);
    if (homeError)
      root.appendChild(h(doc, 'p', { class: 'ci-helper', text: homeError }));

    const stays = getStays();
    const ctx = buildCtx();
    if (!stays.length) {
      renderEmpty(root);
    } else {
      const metrics = new Map();
      for (const stay of stays) metrics.set(stay.id, stayMetrics(stay, ctx));
      renderHeatmap(root, stays);
      renderStays(root, stays, metrics);
      renderRollup(root, stays, ctx, metrics);
    }
    container.appendChild(root);
  }

  function show() {
    const trip = store.ensurePlanTrip();
    planTripId = trip.id;
    if (container) container.hidden = false;
    render();
  }
  function hide() {
    if (container) container.hidden = true;
  }

  return {
    show,
    hide,
    render,
    addStay,
    replacePlan,
    getStays,
    getSummary,
    markVoice,
    get planTripId() {
      return planTripId;
    },
  };
}
