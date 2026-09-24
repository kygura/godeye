/**
 * @file ATLAS (City Intel) right-rail panel: ranking view + mode wiring.
 * docs/cockpit/DESIGN.md §2, §7-9. T6a scope only — scorecard, compare and
 * trip content are T6b (see the `// T6b:` markers below and the empty mount
 * points in `src/ui/templates/city-intel.html`).
 *
 * Pure helpers (preset/weight math, row view models, pagination, pin cap,
 * persistence, roving-focus index math) are exported for node:test and used
 * unchanged by the DOM factory `createCityIntelPanel` below.
 *
 * @module layers/cityIntel/panel
 */
import { PILLARS } from './scoring.js';
import { loadCityIntelPack, fetchAdvisories, fetchVisa } from './source.js';
import { selectLabelIds } from './index.js';

const STORAGE_KEY = 'gev:city-intel:v1';
export const PAGE_SIZE = 100;
export const PIN_MAX = 4;
/** DESIGN §2: row click flies the camera but never zooms in below this. */
export const MIN_FLY_HEIGHT_M = 800_000;
const TOP_LABEL_COUNT = 20;

/** DESIGN §2: the four weighting presets (CUSTOM has no fixed weights). */
export const PRESET_WEIGHTS = Object.freeze({
  BALANCED: Object.freeze({ qol: 5, cost: 5, safety: 5, travel: 5 }),
  BUDGET: Object.freeze({ qol: 3, cost: 8, safety: 5, travel: 3 }),
  SAFETY: Object.freeze({ qol: 4, cost: 3, safety: 9, travel: 3 }),
});

const DEFAULT_WEIGHTS = PRESET_WEIGHTS.BALANCED;
const DEFAULT_FILTERS = Object.freeze({
  continent: null,
  minPop: 0,
  hideAdvisoryLevelAtLeast: null,
  includeIneligible: false,
});
const DEFAULT_STATE = Object.freeze({
  weights: DEFAULT_WEIGHTS,
  preset: 'BALANCED',
  passport: null,
  filters: DEFAULT_FILTERS,
  pins: Object.freeze([]),
  view: 'grouped',
});

// ---------------------------------------------------------------------------
// Pure helpers (node:test coverage lives in panel.test.mjs)
// ---------------------------------------------------------------------------

/** Clamp to an integer 0-10 (slider domain); non-finite input becomes 0. */
export function clampWeight(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(10, Math.max(0, n));
}

/** Which preset (if any) these weights match exactly; else 'CUSTOM'. */
export function matchPreset(weights) {
  for (const [name, preset] of Object.entries(PRESET_WEIGHTS)) {
    if (PILLARS.every((p) => weights[p] === preset[p])) return name;
  }
  return 'CUSTOM';
}

/** DESIGN §2: all four weights at 0 means "ignore everything". */
export function isAllZero(weights) {
  return PILLARS.every((p) => weights[p] === 0);
}

/** 1-based rank per city id, in the given (already sorted/filtered) order. */
export function rankIndexMap(flatRows) {
  const map = new Map();
  flatRows.forEach((s, i) => map.set(s.id, i + 1));
  return map;
}

/** Flat view row models: one per city, depth 0. */
export function flatRowModels(flatRows, rankMap) {
  return flatRows.map((s) => ({
    kind: 'city',
    depth: 0,
    rank: rankMap.get(s.id) ?? null,
    scored: s,
  }));
}

/**
 * Grouped view row models: one 'group' row per country (its best city),
 * followed by 'child' rows (depth 1) for the rest when that country is
 * expanded. Group order follows `groups` (best-city rank ascending).
 */
export function groupedRowModels(groups, rankMap, expandedIso3 = new Set()) {
  const out = [];
  for (const group of groups) {
    const [best, ...rest] = group.cities;
    if (!best) continue;
    out.push({
      kind: 'group',
      depth: 0,
      rank: rankMap.get(best.id) ?? null,
      scored: best,
      iso3: group.iso3,
      moreCount: rest.length,
      expanded: expandedIso3.has(group.iso3),
    });
    if (rest.length && expandedIso3.has(group.iso3)) {
      for (const child of rest) {
        out.push({
          kind: 'child',
          depth: 1,
          rank: rankMap.get(child.id) ?? null,
          scored: child,
          iso3: group.iso3,
        });
      }
    }
  }
  return out;
}

/**
 * First `pageCount` top-level rows (depth 0), keeping every expanded child
 * that follows one of them. In grouped view a "row" for paging purposes is a
 * country group, matching DESIGN §2 ("the count applies to country groups").
 */
export function paginateModels(models, pageCount) {
  const out = [];
  let topCount = 0;
  for (const model of models) {
    if (model.depth === 0) {
      if (topCount >= pageCount) break;
      topCount++;
    }
    out.push(model);
  }
  return out;
}

/** Whether more top-level rows exist beyond `pageCount`. */
export function hasMoreModels(models, pageCount) {
  return models.filter((m) => m.depth === 0).length > pageCount;
}

/** Toggle one pin, refusing a 5th (DESIGN §2/§8). */
export function togglePin(pinnedIds, id, max = PIN_MAX) {
  const set = new Set(pinnedIds);
  if (set.has(id)) {
    set.delete(id);
    return { pinned: [...set], refused: false };
  }
  if (set.size >= max) return { pinned: [...pinnedIds], refused: true };
  set.add(id);
  return { pinned: [...set], refused: false };
}

/** Bulk pin replacement (API contract `setPins`): caps at `max`, dedup. */
export function applyPinSet(ids, max = PIN_MAX) {
  const seen = new Set();
  const pinned = [];
  const refused = [];
  for (const id of ids || []) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    if (pinned.length < max) pinned.push(id);
    else refused.push(id);
  }
  return { pinned, refused };
}

/** "L1".."L4", or "—" when the level is unknown/unavailable. */
export function advisoryBadgeText(level) {
  return Number.isInteger(level) && level >= 1 && level <= 4
    ? `L${level}`
    : '—';
}

/** Next focus index for a roving-tabindex list (Arrow/Home/End); -1 if empty. */
export function nextRovingIndex(current, key, count) {
  if (count <= 0) return -1;
  if (key === 'ArrowDown') return (current + 1 + count) % count;
  if (key === 'ArrowUp') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return current;
}

/** Next index for a horizontal radiogroup (Arrow Left/Right/Up/Down). */
export function stepRadioIndex(current, key, count) {
  const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[key];
  if (!step || count <= 0) return current;
  return (current + step + count) % count;
}

/** Serialize the persisted slice of state (DESIGN §0: `gev:city-intel:v1`). */
export function serializePersistedState({
  weights,
  preset,
  passport,
  filters,
  pins,
  view,
}) {
  return JSON.stringify({
    v: 1,
    weights,
    preset,
    passport,
    filters,
    pins,
    view,
  });
}

/** Parse persisted JSON, falling back to defaults on anything unexpected. */
export function parsePersistedState(raw) {
  if (typeof raw !== 'string' || !raw) return clonePersistedDefaults();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return clonePersistedDefaults();
  }
  if (!parsed || typeof parsed !== 'object') return clonePersistedDefaults();
  const weights = {
    qol: clampWeight(parsed.weights?.qol ?? DEFAULT_WEIGHTS.qol),
    cost: clampWeight(parsed.weights?.cost ?? DEFAULT_WEIGHTS.cost),
    safety: clampWeight(parsed.weights?.safety ?? DEFAULT_WEIGHTS.safety),
    travel: clampWeight(parsed.weights?.travel ?? DEFAULT_WEIGHTS.travel),
  };
  const minPop = Number(parsed.filters?.minPop);
  return {
    weights,
    preset: matchPreset(weights),
    passport:
      typeof parsed.passport === 'string' && parsed.passport
        ? parsed.passport
        : null,
    filters: {
      continent:
        typeof parsed.filters?.continent === 'string'
          ? parsed.filters.continent
          : null,
      minPop: Number.isFinite(minPop) && minPop > 0 ? minPop : 0,
      hideAdvisoryLevelAtLeast:
        parsed.filters?.hideAdvisoryLevelAtLeast === 3 ? 3 : null,
      includeIneligible: parsed.filters?.includeIneligible === true,
    },
    pins: Array.isArray(parsed.pins)
      ? parsed.pins.filter((id) => typeof id === 'string').slice(0, PIN_MAX)
      : [],
    view: parsed.view === 'flat' ? 'flat' : 'grouped',
  };
}

function clonePersistedDefaults() {
  return {
    weights: { ...DEFAULT_STATE.weights },
    preset: DEFAULT_STATE.preset,
    passport: DEFAULT_STATE.passport,
    filters: { ...DEFAULT_STATE.filters },
    pins: [],
    view: DEFAULT_STATE.view,
  };
}

/** Load persisted state from a Storage-like object; never throws. */
export function loadPersisted(storage) {
  try {
    return parsePersistedState(storage?.getItem?.(STORAGE_KEY));
  } catch {
    return clonePersistedDefaults();
  }
}

/** Save persisted state to a Storage-like object; never throws. */
export function savePersisted(storage, state) {
  try {
    storage?.setItem?.(STORAGE_KEY, serializePersistedState(state));
  } catch {
    /* private browsing / quota / no storage: session-only, not fatal */
  }
}

/** "2.9 M" / "640 k" / "820" population formatting (DESIGN §3). */
export function formatPopulation(pop) {
  if (!Number.isFinite(pop)) return '—';
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(1)} M`;
  if (pop >= 1_000) return `${Math.round(pop / 1000)} k`;
  return String(Math.round(pop));
}

// ---------------------------------------------------------------------------
// DOM factory
// ---------------------------------------------------------------------------

/**
 * ATLAS ranking panel: weights, passport, filters, ranking list, pins.
 * Scorecard/compare/trip are T6b (empty mount points only, see the template).
 * @param {{layer: object, flyTo?: (lat:number, lon:number)=>void, showToast?: (msg:string)=>void, storage?: Storage, doc?: Document}} options
 */
export function createCityIntelPanel({
  layer,
  flyTo = () => {},
  showToast = () => {},
  storage = typeof localStorage === 'undefined' ? null : localStorage,
  doc = typeof document === 'undefined' ? null : document,
} = {}) {
  const root = doc?.getElementById?.('city-intel-panel');
  if (!layer || !root) {
    // No DOM / no layer (e.g. a non-browser test importing this module):
    // degrade to an inert panel rather than throwing during app boot.
    return {
      ready: async () => {},
      setWeights() {},
      setFilters() {},
      getTopRanked: () => [],
      getScored: () => null,
      select() {},
      setPins: () => ({ pinned: [], refused: [] }),
      openCompare() {},
      markVoice() {},
    };
  }

  const el = (tag, className) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    return node;
  };

  const els = {
    status: doc.getElementById('ci-status'),
    voiceChip: doc.getElementById('ci-voice-chip'),
    presetSeg: doc.getElementById('ci-preset-seg'),
    passport: doc.getElementById('ci-passport'),
    passportHelper: doc.getElementById('ci-passport-helper'),
    region: doc.getElementById('ci-filter-region'),
    minPop: doc.getElementById('ci-filter-min-pop'),
    hideAdvisory: doc.getElementById('ci-filter-hide-advisory'),
    hideAdvisoryHelper: doc.getElementById('ci-filter-hide-advisory-helper'),
    includeIneligible: doc.getElementById('ci-filter-include-ineligible'),
    rankingCount: doc.getElementById('ci-ranking-count'),
    viewSeg: doc.getElementById('ci-view-seg'),
    list: doc.getElementById('ci-list'),
    showMore: doc.getElementById('ci-show-more'),
    pinsTray: doc.getElementById('ci-pins-tray'),
    compareBtn: doc.getElementById('ci-compare-btn'),
  };
  const weightInputs = {
    qol: doc.getElementById('ci-weight-qol'),
    cost: doc.getElementById('ci-weight-cost'),
    safety: doc.getElementById('ci-weight-safety'),
    travel: doc.getElementById('ci-weight-travel'),
  };
  const weightOutputs = {
    qol: doc.getElementById('ci-weight-qol-value'),
    cost: doc.getElementById('ci-weight-cost-value'),
    safety: doc.getElementById('ci-weight-safety-value'),
    travel: doc.getElementById('ci-weight-travel-value'),
  };

  let index = null;
  let countries = null; // pack.countries.countries, ISO3 -> record
  let advisoriesByIso3 = null;
  let advisoriesOffline = false;

  const state = loadPersisted(storage);
  let visaContext = null; // { byDest, year } | null
  let scoredById = new Map();
  let selectedId = null;
  let pageCount = PAGE_SIZE;
  const expandedIso3 = new Set();
  let voiceChipTimer = null;

  const persist = () => savePersisted(storage, state);

  function announce(message) {
    if (els.status) els.status.textContent = message;
  }

  function syncWeightsUi() {
    for (const p of PILLARS) {
      if (weightInputs[p]) weightInputs[p].value = String(state.weights[p]);
      if (weightOutputs[p])
        weightOutputs[p].textContent = String(state.weights[p]);
    }
    for (const btn of els.presetSeg?.querySelectorAll('[data-preset]') || []) {
      const active = btn.dataset.preset === state.preset;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', String(active));
    }
  }

  function syncFiltersUi() {
    if (els.region) els.region.value = state.filters.continent || '';
    if (els.minPop) els.minPop.value = String(state.filters.minPop || 0);
    if (els.hideAdvisory)
      els.hideAdvisory.checked = state.filters.hideAdvisoryLevelAtLeast === 3;
    if (els.includeIneligible)
      els.includeIneligible.checked = state.filters.includeIneligible === true;
  }

  function syncViewUi() {
    for (const btn of els.viewSeg?.querySelectorAll('[data-view]') || []) {
      const active = btn.dataset.view === state.view;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', String(active));
    }
  }

  function syncPassportHelper() {
    if (!els.passportHelper) return;
    els.passportHelper.textContent = state.passport
      ? `Visa access from ${state.passport} counted in Travel ease.`
      : 'Visa access counts toward Travel ease once set.';
  }

  // -- Ranking -------------------------------------------------------------

  function computeFilterOptions() {
    return {
      continent: state.filters.continent || undefined,
      minPop: state.filters.minPop || undefined,
      hideAdvisoryLevelAtLeast:
        state.filters.hideAdvisoryLevelAtLeast || undefined,
      advisories: advisoriesByIso3 || undefined,
      includeIneligible: state.filters.includeIneligible,
    };
  }

  function renderRows() {
    if (!els.list) return;
    els.list.replaceChildren();
    if (!index) return;
    if (isAllZero(state.weights)) {
      els.list.append(textNode('Set at least one weight above 0.'));
      updateRankingCount(0);
      updateShowMore(false);
      // DESIGN §8: every marker falls back to the neutral "no weights" style.
      layer.setScores([], {});
      return;
    }
    const scored = index.score(state.weights, { visa: visaContext });
    scoredById = new Map(scored.map((s) => [s.id, s]));
    const filterOptions = computeFilterOptions();
    const flat = index.rank(scored, {
      ...filterOptions,
      groupByCountry: false,
    }).rows;
    const rankMap = rankIndexMap(flat);
    const grouped =
      state.view === 'grouped'
        ? index.rank(scored, { ...filterOptions, groupByCountry: true }).groups
        : null;
    const models = grouped
      ? groupedRowModels(grouped, rankMap, expandedIso3)
      : flatRowModels(flat, rankMap);

    updateRankingCount(flat.length);

    // Globe: DESIGN §7. rankedIds = every eligible city, regardless of the
    // current filters; filteredOutIds = eligible cities the filters hid, so
    // the map keeps them visible (dimmed) instead of removing them.
    const allEligibleIds = scored.filter((s) => s.eligible).map((s) => s.id);
    const filteredIds = new Set(flat.map((s) => s.id));
    const filteredOutIds = allEligibleIds.filter((id) => !filteredIds.has(id));
    const topIds = grouped
      ? grouped.slice(0, TOP_LABEL_COUNT).map((g) => g.cities[0]?.id)
      : flat.slice(0, TOP_LABEL_COUNT).map((s) => s.id);
    const labelIds = selectLabelIds({
      topRankedIds: topIds.filter(Boolean),
      pinnedIds: state.pins,
      selectedId,
    });
    layer.setScores(scored, {
      rankedIds: allEligibleIds,
      filteredOutIds,
      labelIds,
    });

    if (!flat.length) {
      const reset = el('button', 'scene-btn');
      reset.type = 'button';
      reset.textContent = 'RESET FILTERS';
      reset.addEventListener('click', () => {
        state.filters = { ...DEFAULT_FILTERS };
        syncFiltersUi();
        persist();
        rerank();
      });
      const wrap = el('div', 'ci-list-empty');
      wrap.append(textInline('No cities match. Loosen the filters.'), reset);
      els.list.append(wrap);
      updateShowMore(false);
      return;
    }

    const page = paginateModels(models, pageCount);
    for (const model of page) els.list.append(buildRow(model));
    updateShowMore(hasMoreModels(models, pageCount));
  }

  function textNode(message) {
    const p = el('div', 'ci-list-empty');
    p.textContent = message;
    return p;
  }

  function updateRankingCount(count) {
    if (!els.rankingCount) return;
    const noun = count === 1 ? 'city' : 'cities';
    els.rankingCount.textContent = `RANKING · ${count} ${noun}`;
  }

  function updateShowMore(hasMore) {
    if (els.showMore) els.showMore.hidden = !hasMore;
  }

  function buildRow(model) {
    const { scored, kind, depth, rank } = model;
    const city = scored.city;
    const button = el(
      'button',
      `ci-row${depth ? ' ci-row-child' : ''}${selectedId === scored.id ? ' ci-row-selected' : ''}`,
    );
    button.type = 'button';
    button.dataset.cityId = scored.id;
    button.setAttribute('role', 'listitem');
    button.tabIndex = -1;

    const rankEl = el('span', 'ci-row-rank');
    rankEl.textContent = rank == null ? '—' : String(rank);

    const nameEl = el('span', 'ci-row-name');
    nameEl.textContent = city.name;
    if (kind !== 'child') {
      const countrySpan = el('span', 'ci-row-country');
      countrySpan.textContent = ` · ${city.country}`;
      nameEl.append(countrySpan);
    }

    const bin = binFromComposite(scored.composite);
    const scoreEl = el('span', 'ci-row-score');
    scoreEl.textContent =
      scored.composite == null ? '—' : String(Math.round(scored.composite));
    scoreEl.style.color =
      bin == null ? 'var(--ci-neutral)' : `var(--ci-score-${bin})`;

    const barEl = el('span', 'ci-row-bar');
    const fillEl = el('span', 'ci-row-bar-fill');
    fillEl.style.width = `${Math.max(0, Math.min(100, scored.composite ?? 0))}%`;
    fillEl.style.background =
      bin == null ? 'var(--ci-neutral)' : `var(--ci-score-${bin})`;
    barEl.append(fillEl);

    const coverageEl = el('span', 'ci-row-coverage');
    coverageEl.textContent = `${scored.coverage.pillarsAvailable}/4`;
    coverageEl.title = scored.coverage.text;

    const level = advisoriesByIso3?.[city.iso3]?.level ?? null;
    const advisoryEl = el('span', 'ci-row-advisory');
    advisoryEl.textContent = advisoriesOffline ? '—' : advisoryBadgeText(level);
    if (!advisoriesOffline && level) advisoryEl.dataset.level = String(level);
    advisoryEl.title = advisoriesOffline
      ? 'Advisory unavailable (source offline)'
      : level
        ? `Level ${level}`
        : 'Advisory unavailable';

    const pinBtn = el('button', 'ci-row-pin');
    pinBtn.type = 'button';
    const pinned = state.pins.includes(scored.id);
    pinBtn.textContent = pinned ? '★' : '☆';
    pinBtn.setAttribute('aria-pressed', String(pinned));
    pinBtn.setAttribute('aria-label', `Pin ${city.name} for comparison`);
    pinBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      pinRow(scored.id, city.name);
    });

    button.append(
      rankEl,
      nameEl,
      scoreEl,
      barEl,
      coverageEl,
      advisoryEl,
      pinBtn,
    );

    if (kind === 'group' && model.moreCount > 0) {
      const expander = el('button', 'ci-row-expander');
      expander.type = 'button';
      expander.setAttribute('aria-expanded', String(model.expanded));
      expander.setAttribute(
        'aria-label',
        `${model.expanded ? 'Hide' : 'Show'} ${model.moreCount} more ${city.country} cities`,
      );
      expander.textContent = model.expanded ? '−' : `+${model.moreCount}`;
      expander.addEventListener('click', (event) => {
        event.stopPropagation();
        if (expandedIso3.has(model.iso3)) expandedIso3.delete(model.iso3);
        else expandedIso3.add(model.iso3);
        renderRows();
      });
      button.append(expander);
    } else {
      button.append(el('span', 'ci-row-expander'));
    }

    button.addEventListener('click', () => select(scored.id));
    return button;
  }

  function binFromComposite(score) {
    if (!Number.isFinite(score)) return null;
    return Math.min(
      4,
      Math.max(0, Math.floor(Math.min(100, Math.max(0, score)) / 20)),
    );
  }

  function renderPins() {
    if (els.pinsTray) {
      els.pinsTray.replaceChildren();
      if (!state.pins.length) {
        els.pinsTray.append(textInline('Pin 2–4 cities to compare.'));
      } else if (state.pins.length === 1) {
        appendPinChips();
        els.pinsTray.append(textInline(' Pin one more to compare.'));
      } else {
        appendPinChips();
      }
    }
    if (els.compareBtn) {
      els.compareBtn.textContent = `COMPARE (${state.pins.length})`;
      els.compareBtn.disabled = state.pins.length < 2;
    }
  }

  function textInline(message) {
    const span = el('span');
    span.textContent = message;
    return span;
  }

  function appendPinChips() {
    for (const id of state.pins) {
      const s = scoredById.get(id);
      const chip = el('span', 'ci-pin-chip');
      const label = el('span');
      label.textContent = s ? s.city.name : id;
      const remove = el('button');
      remove.type = 'button';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', `Unpin ${s ? s.city.name : id}`);
      remove.addEventListener('click', () => pinRow(id, s?.city.name || id));
      chip.append(label, remove);
      els.pinsTray.append(chip);
    }
  }

  function pinRow(id, name) {
    const { pinned, refused } = togglePin(state.pins, id, PIN_MAX);
    if (refused) {
      showToast('Compare holds 4 cities. Unpin one first.');
      return;
    }
    state.pins = pinned;
    persist();
    layer.setPinned(state.pins);
    const nowPinned = state.pins.includes(id);
    announce(
      `${name} ${nowPinned ? 'pinned' : 'unpinned'}, ${state.pins.length} of ${PIN_MAX}`,
    );
    renderPins();
    renderRows();
  }

  function rerank() {
    renderRows();
    renderPins();
  }

  function select(id) {
    selectedId = id;
    layer.setSelected(id);
    const s = scoredById.get(id);
    if (s) flyTo(s.city.lat, s.city.lon, MIN_FLY_HEIGHT_M);
    renderRows();
  }

  // -- Wiring ----------------------------------------------------------------

  function bindWeightSlider(pillar) {
    const input = weightInputs[pillar];
    if (!input) return;
    input.addEventListener('input', () => {
      state.weights = { ...state.weights, [pillar]: clampWeight(input.value) };
      state.preset = matchPreset(state.weights);
      if (weightOutputs[pillar])
        weightOutputs[pillar].textContent = String(state.weights[pillar]);
      syncWeightsUi();
      persist();
      rerank();
    });
    input.addEventListener('change', () => {
      announce(`${pillar} weight ${state.weights[pillar]}`);
    });
  }

  function bindPresetSeg() {
    els.presetSeg?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-preset]');
      if (!btn) return;
      const name = btn.dataset.preset;
      if (name !== 'CUSTOM' && PRESET_WEIGHTS[name]) {
        state.weights = { ...PRESET_WEIGHTS[name] };
      }
      state.preset = name === 'CUSTOM' ? matchPreset(state.weights) : name;
      syncWeightsUi();
      persist();
      rerank();
      announce(`Weighting preset ${state.preset}`);
    });
    els.presetSeg?.addEventListener('keydown', (event) => {
      const buttons = [
        ...(els.presetSeg.querySelectorAll('[data-preset]') || []),
      ];
      const current = buttons.findIndex((b) => b === doc.activeElement);
      const next = stepRadioIndex(current, event.key, buttons.length);
      if (next === current || current < 0) return;
      event.preventDefault();
      buttons[next].focus();
      buttons[next].click();
    });
  }

  function bindViewSeg() {
    els.viewSeg?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-view]');
      if (!btn) return;
      state.view = btn.dataset.view === 'flat' ? 'flat' : 'grouped';
      syncViewUi();
      persist();
      pageCount = PAGE_SIZE;
      rerank();
    });
    els.viewSeg?.addEventListener('keydown', (event) => {
      const buttons = [...(els.viewSeg.querySelectorAll('[data-view]') || [])];
      const current = buttons.findIndex((b) => b === doc.activeElement);
      const next = stepRadioIndex(current, event.key, buttons.length);
      if (next === current || current < 0) return;
      event.preventDefault();
      buttons[next].focus();
      buttons[next].click();
    });
  }

  function bindFilters() {
    els.region?.addEventListener('change', () => {
      state.filters = { ...state.filters, continent: els.region.value || null };
      persist();
      rerank();
    });
    els.minPop?.addEventListener('change', () => {
      state.filters = {
        ...state.filters,
        minPop: Number(els.minPop.value) || 0,
      };
      persist();
      rerank();
    });
    els.hideAdvisory?.addEventListener('change', () => {
      state.filters = {
        ...state.filters,
        hideAdvisoryLevelAtLeast: els.hideAdvisory.checked ? 3 : null,
      };
      persist();
      rerank();
    });
    els.includeIneligible?.addEventListener('change', () => {
      state.filters = {
        ...state.filters,
        includeIneligible: els.includeIneligible.checked === true,
      };
      persist();
      rerank();
    });
  }

  function bindPassport() {
    els.passport?.addEventListener('change', async () => {
      const iso3 = els.passport.value || null;
      state.passport = iso3;
      syncPassportHelper();
      persist();
      visaContext = await loadVisaContext(iso3);
      rerank();
    });
  }

  async function loadVisaContext(iso3) {
    if (!iso3) return null;
    const result = await fetchVisa(iso3).catch(() => ({ ok: false }));
    return result?.ok ? result.data : null;
  }

  function bindList() {
    els.list?.addEventListener('keydown', (event) => {
      const rows = [...(els.list.querySelectorAll('.ci-row') || [])];
      if (!rows.length) return;
      const current = rows.findIndex((r) => r === doc.activeElement);
      let next;
      if (current < 0) {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
          return;
        next =
          event.key === 'ArrowUp' || event.key === 'End' ? rows.length - 1 : 0;
      } else {
        next = nextRovingIndex(current, event.key, rows.length);
        if (next === current) return;
      }
      event.preventDefault();
      rows.forEach((r, i) => (r.tabIndex = i === next ? 0 : -1));
      rows[next].focus();
    });
    els.showMore?.addEventListener('click', () => {
      pageCount += PAGE_SIZE;
      renderRows();
    });
  }

  function bindCompare() {
    els.compareBtn?.addEventListener('click', () => api.openCompare());
  }

  async function populatePassportOptions() {
    if (!els.passport || !countries) return;
    const options = Object.entries(countries)
      .map(([iso3, record]) => ({ iso3, name: record?.name || iso3 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    els.passport.replaceChildren();
    const unset = el('option');
    unset.value = '';
    unset.textContent = 'Not set';
    els.passport.append(unset);
    for (const { iso3, name } of options) {
      const opt = el('option');
      opt.value = iso3;
      opt.textContent = `${name} · ${iso3}`;
      els.passport.append(opt);
    }
    els.passport.value = state.passport || '';
  }

  async function loadAdvisories() {
    const result = await fetchAdvisories().catch(() => ({ ok: false }));
    advisoriesOffline = !result?.ok;
    advisoriesByIso3 = result?.ok ? result.data?.byIso3 || {} : null;
    if (els.hideAdvisory) els.hideAdvisory.disabled = advisoriesOffline;
    if (els.hideAdvisoryHelper)
      els.hideAdvisoryHelper.hidden = !advisoriesOffline;
  }

  function setDisabled(disabled) {
    for (const node of [
      ...Object.values(weightInputs),
      els.passport,
      els.region,
      els.minPop,
      els.hideAdvisory,
      els.includeIneligible,
    ])
      if (node) node.disabled = disabled;
  }

  let readyPromise = null;

  async function init() {
    setDisabled(true);
    if (els.list) els.list.replaceChildren(textNode('LOADING CITY PACK…'));
    let pack;
    try {
      [pack] = await Promise.all([loadCityIntelPack(), layer.whenReady()]);
    } catch {
      if (els.list)
        els.list.replaceChildren(
          textNode('CITY PACK UNAVAILABLE'),
          textNode('Reload the page to retry.'),
        );
      return;
    }
    index = layer.getIndex();
    if (!index) {
      if (els.list)
        els.list.replaceChildren(
          textNode('CITY PACK UNAVAILABLE'),
          textNode('Reload the page to retry.'),
        );
      return;
    }
    countries = pack.countries?.countries || {};
    await populatePassportOptions();
    setDisabled(false);
    syncWeightsUi();
    syncFiltersUi();
    syncViewUi();
    syncPassportHelper();
    await loadAdvisories();
    if (state.passport) visaContext = await loadVisaContext(state.passport);
    layer.onPick((id) => select(id));
    bindPresetSeg();
    bindViewSeg();
    bindFilters();
    bindPassport();
    bindList();
    bindCompare();
    for (const p of PILLARS) bindWeightSlider(p);
    layer.setPinned(state.pins);
    rerank();
  }

  const api = {
    ready() {
      if (!readyPromise) readyPromise = init();
      return readyPromise;
    },
    setWeights(partial = {}) {
      state.weights = {
        ...state.weights,
        ...Object.fromEntries(
          Object.entries(partial)
            .filter(([p]) => PILLARS.includes(p))
            .map(([p, v]) => [p, clampWeight(v)]),
        ),
      };
      state.preset = matchPreset(state.weights);
      syncWeightsUi();
      persist();
      rerank();
    },
    setFilters(partial = {}) {
      state.filters = { ...state.filters, ...partial };
      syncFiltersUi();
      persist();
      rerank();
    },
    getTopRanked(n) {
      if (!index || isAllZero(state.weights)) return [];
      const scored = index.score(state.weights, { visa: visaContext });
      const flat = index.rank(scored, {
        ...computeFilterOptions(),
        groupByCountry: false,
      }).rows;
      return flat.slice(0, n).map((s, i) => ({
        rank: i + 1,
        id: s.id,
        name: s.city.name,
        country: s.city.country,
        composite: s.composite,
        coverageText: s.coverage.text,
        eligible: s.eligible,
      }));
    },
    getScored(id) {
      return scoredById.get(id) || null;
    },
    select,
    setPins(ids) {
      const { pinned, refused } = applyPinSet(ids, PIN_MAX);
      state.pins = pinned;
      persist();
      layer.setPinned(pinned);
      renderPins();
      renderRows();
      if (refused.length) showToast('Compare holds 4 cities. Unpin one first.');
      return { pinned, refused };
    },
    openCompare() {
      // T6b: the compare overlay (#city-intel-compare) is built in the next
      // task; this is a deliberate no-op until then.
    },
    markVoice(surface) {
      if (surface !== 'panel' || !els.voiceChip) return;
      els.voiceChip.hidden = false;
      clearTimeout(voiceChipTimer);
      voiceChipTimer = setTimeout(() => {
        els.voiceChip.hidden = true;
      }, 4000);
    },
  };
  return api;
}
