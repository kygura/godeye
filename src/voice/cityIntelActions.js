/**
 * @file Voice handlers for the City Intel cockpit (docs/cockpit/SPEC.md §4).
 *
 * Delegates all UI/state work to the `cityIntel` handle
 * (`{ mode, panel }`, see docs/cockpit/DESIGN.md §10) that `gevActions.js`
 * passes in; this module never touches Cesium or the DOM. City name -> pack
 * id resolution reuses `src/travel/citySearch.js` over the same pack
 * `src/layers/cityIntel/source.js` loads, so Trips and voice share one
 * dataset and one ranking rule.
 *
 * @module voice/cityIntelActions
 */
import { loadCityIntelPack } from '../layers/cityIntel/source.js';
import { searchCities } from '../travel/citySearch.js';
import {
  evenSplit,
  monthsOf,
  overlaps,
  spanLabel,
} from '../layers/cityIntel/plan.js';

const CAVEAT =
  'Scores are mostly country-level public statistics; not relocation advice.';

const CANCELLED = {
  error: 'City Intel request was superseded by a newer voice turn',
};

function isCurrent(runOptions = {}) {
  return (
    !runOptions.signal?.aborted &&
    (typeof runOptions.isCurrent !== 'function' || runOptions.isCurrent())
  );
}

function unavailable(action) {
  return { ok: false, action, error: 'city-intel-unavailable' };
}

function cancelled(action) {
  return { ok: false, action, cancelled: true, ...CANCELLED };
}

async function loadPackData() {
  const pack = await loadCityIntelPack();
  return {
    cities: Array.isArray(pack?.cities) ? pack.cities : [],
    countries: pack?.countries?.countries || {},
  };
}

/**
 * Enter City Intel mode if it isn't already active, bailing out (without
 * entering) when the run has already been superseded. Shared by the four
 * voice tools that gate on mode entry before touching the panel/plan.
 * @returns {Promise<boolean>} false when the run is no longer current
 */
async function ensureMode(cityIntel, runOptions) {
  if (!isCurrent(runOptions)) return false;
  if (!cityIntel.mode.isActive()) await cityIntel.mode.enter();
  return isCurrent(runOptions);
}

/** Score+coverage per pillar — the shape both compare_cities and show_city_intel report. */
function pillarSummary(scored) {
  return Object.fromEntries(
    Object.entries(scored.pillars).map(([key, p]) => [
      key,
      { score: p.score, coverage: p.coverage },
    ]),
  );
}

/**
 * Parse one free-form city query — optionally "City, Country" or
 * "City Country" — into its name/country-hint parts and the ranked pack
 * candidates (via `searchCities`'s own population/rank ordering), narrowed to
 * the hinted country when one is given. `hinted` is true only when a country
 * was explicitly named (comma or trailing country name), so callers can tell
 * an unambiguous hinted pick from an unhinted, possibly-wrong top rank.
 * @param {object[]} cities Pack cities (citySearch schema).
 * @param {string} query
 * @returns {{name: string, hinted: boolean, matches: object[]}}
 */
function candidatesFor(cities, query) {
  const raw = String(query || '').trim();
  if (!raw || !Array.isArray(cities) || !cities.length)
    return { name: raw, hinted: false, matches: [] };

  let name = raw;
  let countryHint = null;
  const comma = raw.indexOf(',');
  if (comma >= 0) {
    name = raw.slice(0, comma).trim();
    countryHint = raw.slice(comma + 1).trim();
  } else {
    // No comma: check whether the query ends in a known country name on a
    // word boundary, e.g. "San Jose Costa Rica" -> name "San Jose", hint
    // "Costa Rica". Longest country names are tried first so "Costa Rica"
    // wins over any shorter clash.
    const countries = [...new Set(cities.map((c) => c.country))].sort(
      (a, b) => b.length - a.length,
    );
    const lower = raw.toLowerCase();
    const suffix = countries.find((country) => {
      if (!country || country.length >= raw.length) return false;
      if (!lower.endsWith(country.toLowerCase())) return false;
      return /\s/.test(raw[raw.length - country.length - 1] || '');
    });
    if (suffix) {
      name = raw.slice(0, raw.length - suffix.length).trim();
      countryHint = suffix;
    }
  }

  let matches = searchCities(cities, name, 10);
  if (countryHint) {
    const hint = countryHint.toLowerCase();
    const narrowed = matches.filter((c) => c.country.toLowerCase() === hint);
    matches = narrowed.length ? narrowed : searchCities(cities, raw, 10);
  }
  if (!matches.length) matches = searchCities(cities, raw, 10);
  return { name, hinted: Boolean(countryHint), matches };
}

/**
 * Resolve one free-form city query to a pack city, preferring the
 * larger-population match on ambiguity (via `searchCities`'s own ranking).
 * Never throws; returns null when nothing matches.
 * @param {object[]} cities Pack cities (citySearch schema).
 * @param {string} query
 * @returns {{city: object, label: string}|null}
 */
export function resolveCity(cities, query) {
  const city = candidatesFor(cities, query).matches[0];
  return city ? { city, label: `${city.name} (${city.country})` } : null;
}

/**
 * Resolve a list of free-form city names, in order, using the anchor-vote
 * continent disambiguation shared by `compare_cities` and `plan_lifestyle`:
 * names that are already unambiguous (hinted, or a single pack match) vote
 * their continent, and an ambiguous unhinted name then prefers the candidate
 * matching the majority continent over the bare population-rank top pick —
 * otherwise "compare Lisbon and Valencia" would pick Valencia, Venezuela
 * over Valencia, Spain on population alone.
 * @param {object[]} cities Pack cities (citySearch schema).
 * @param {object} countries Pack per-country records (`source.js` pack `countries.countries`).
 * @param {string[]} names Free-form city queries, in order.
 * @returns {{resolved: Array<{raw: string, city: object}|null>, unresolved: string[]}} `resolved` is parallel to `names`; `null` marks an unresolved entry.
 */
function resolveNames(cities, countries, names) {
  const continentOf = (city) => countries[city.iso3]?.continent || null;
  const perName = names.map((raw) => ({ raw, ...candidatesFor(cities, raw) }));

  const votes = new Map();
  for (const entry of perName) {
    if (!entry.matches.length) continue;
    if (entry.hinted || entry.matches.length === 1) {
      const continent = continentOf(entry.matches[0]);
      if (continent) votes.set(continent, (votes.get(continent) || 0) + 1);
    }
  }
  let majority = null;
  let majorityVotes = 0;
  for (const [continent, count] of votes) {
    if (count > majorityVotes) {
      majority = continent;
      majorityVotes = count;
    }
  }

  const unresolved = [];
  const resolved = perName.map((entry) => {
    if (!entry.matches.length) {
      unresolved.push(entry.raw);
      return null;
    }
    let city = entry.matches[0];
    if (!entry.hinted && entry.matches.length > 1 && majority) {
      const preferred = entry.matches.find(
        (candidate) => continentOf(candidate) === majority,
      );
      if (preferred) city = preferred;
    }
    return { raw: entry.raw, city };
  });
  return { resolved, unresolved };
}

/**
 * Mean seasonality comfort for one city over an arbitrary set of months
 * (unlike `plan.js`'s `stayComfort`, these months need not be contiguous —
 * `rank_cities` reports comfort, it does not model a stay).
 * @param {string} cityId
 * @param {number[]} months 1-12
 * @param {object} seasonality Pack seasonality (`source.js` pack `.seasonality`).
 * @returns {number|null} Mean 0-100, or null when no month has a score.
 */
function meanComfort(cityId, months, seasonality) {
  const cityRow = seasonality?.cities?.[cityId];
  const scores = months
    .map((m) => cityRow?.months?.[m - 1]?.score)
    .filter((score) => Number.isFinite(score));
  return scores.length
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : null;
}

/**
 * `rank_cities` voice tool: apply weights/region and return the top ranked
 * cities. See docs/cockpit/SPEC.md §4.
 * @param {object|null} cityIntel
 * @param {{region?: string, weights?: object, limit?: number, months?: number[]}} [args]
 * @param {{signal?: AbortSignal, isCurrent?: () => boolean}} [runOptions]
 */
export async function rankCities(cityIntel, args = {}, runOptions = {}) {
  if (!cityIntel) return unavailable('rank_cities');
  try {
    if (!(await ensureMode(cityIntel, runOptions)))
      return cancelled('rank_cities');
    await cityIntel.panel.ready();
    if (!isCurrent(runOptions)) return cancelled('rank_cities');

    const weights = {};
    if (args.weights && typeof args.weights === 'object') {
      for (const key of ['qol', 'cost', 'safety', 'travel']) {
        const value = args.weights[key];
        if (Number.isFinite(value)) weights[key] = value;
      }
    }
    if (Object.keys(weights).length) cityIntel.panel.setWeights(weights);
    cityIntel.panel.setFilters({ continent: args.region ?? null });
    cityIntel.panel.markVoice('panel');

    const limit = Number.isFinite(args.limit)
      ? Math.min(10, Math.max(1, Math.round(args.limit)))
      : 5;
    let cities = cityIntel.panel.getTopRanked(limit) || [];

    const months = Array.isArray(args.months)
      ? [...new Set(args.months)].filter(
          (m) => Number.isInteger(m) && m >= 1 && m <= 12,
        )
      : [];
    if (months.length) {
      const { seasonality } = await loadCityIntelPack();
      cities = cities.map((city) => {
        const mean = meanComfort(city.id, months, seasonality);
        return {
          ...city,
          comfort: Number.isFinite(mean) ? Math.round(mean) : null,
          comfortStatus: Number.isFinite(mean) ? 'ok' : 'unavailable',
        };
      });
    }

    const summary = cities.length
      ? `Top ${cities.length}: ${cities.map((c) => `${c.rank} ${c.name}`).join(', ')}. ${CAVEAT}`
      : `No cities matched the current filters. ${CAVEAT}`;
    return { ok: true, action: 'rank_cities', cities, summary };
  } catch (error) {
    return {
      ok: false,
      action: 'rank_cities',
      error: error?.message || 'rank_cities failed',
    };
  }
}

/**
 * `compare_cities` voice tool: resolve 2-4 names, pin them and open compare.
 * See docs/cockpit/SPEC.md §4.
 * @param {object|null} cityIntel
 * @param {{cities?: string[]}} [args]
 * @param {{signal?: AbortSignal, isCurrent?: () => boolean}} [runOptions]
 */
export async function compareCities(cityIntel, args = {}, runOptions = {}) {
  if (!cityIntel) return unavailable('compare_cities');
  const names = Array.isArray(args.cities) ? args.cities : [];
  if (names.length < 2) {
    return {
      ok: false,
      action: 'compare_cities',
      error: 'compare_cities needs at least 2 city names',
    };
  }
  try {
    const { cities, countries } = await loadPackData();
    const { resolved: perName, unresolved } = resolveNames(
      cities,
      countries,
      names,
    );

    const resolved = [];
    const picks = [];
    for (const entry of perName) {
      if (!entry) continue;
      resolved.push(entry.city);
      picks.push(`${entry.city.name} (${entry.city.country})`);
    }
    if (resolved.length < 2) {
      return {
        ok: false,
        action: 'compare_cities',
        error: `Could not resolve enough cities to compare (${resolved.length} of ${names.length})`,
        unresolved,
      };
    }
    if (!(await ensureMode(cityIntel, runOptions)))
      return cancelled('compare_cities');

    const ids = resolved.slice(0, 4).map((c) => c.id);
    const { pinned, refused } = cityIntel.panel.setPins(ids);
    cityIntel.panel.openCompare();
    cityIntel.panel.markVoice('compare');

    const scored = ids
      .map((id) => cityIntel.panel.getScored(id))
      .filter(Boolean)
      .map((s) => ({
        id: s.id,
        name: s.city.name,
        country: s.city.country,
        composite: s.composite,
        coverage: s.coverage.text,
        eligible: s.eligible,
        pillars: pillarSummary(s),
      }));

    return {
      ok: true,
      action: 'compare_cities',
      resolved: picks,
      unresolved,
      pinned,
      refused,
      cities: scored,
      summary: CAVEAT,
    };
  } catch (error) {
    return {
      ok: false,
      action: 'compare_cities',
      error: error?.message || 'compare_cities failed',
    };
  }
}

/**
 * `show_city_intel` voice tool: resolve one city and open its scorecard.
 * See docs/cockpit/SPEC.md §4.
 * @param {object|null} cityIntel
 * @param {{city?: string}} [args]
 * @param {{signal?: AbortSignal, isCurrent?: () => boolean}} [runOptions]
 */
export async function showCityIntel(cityIntel, args = {}, runOptions = {}) {
  if (!cityIntel) return unavailable('show_city_intel');
  const query = String(args.city || '').trim();
  if (!query) {
    return {
      ok: false,
      action: 'show_city_intel',
      error: 'show_city_intel needs a city name',
    };
  }
  try {
    const cities = (await loadPackData()).cities;
    const match = resolveCity(cities, query);
    if (!match) {
      return {
        ok: false,
        action: 'show_city_intel',
        error: `Could not find a city matching "${query}"`,
      };
    }
    if (!(await ensureMode(cityIntel, runOptions)))
      return cancelled('show_city_intel');

    cityIntel.panel.select(match.city.id);
    cityIntel.panel.markVoice('panel');
    const scored = cityIntel.panel.getScored(match.city.id);
    if (!scored) {
      return {
        ok: true,
        action: 'show_city_intel',
        resolved: match.label,
        composite: null,
        error: 'No score available for this city',
        summary: CAVEAT,
      };
    }

    const headlineMetrics = [];
    for (const key of ['qol', 'cost', 'safety', 'travel']) {
      for (const m of scored.pillars[key]?.metrics || []) {
        if (m.status !== 'ok') continue;
        headlineMetrics.push({
          key: m.key,
          label: m.label,
          raw: m.raw,
          unit: m.unit,
          year: m.year,
          level: m.level,
          source: m.source,
        });
        if (headlineMetrics.length >= 4) break;
      }
      if (headlineMetrics.length >= 4) break;
    }

    return {
      ok: true,
      action: 'show_city_intel',
      resolved: match.label,
      composite: scored.composite,
      coverage: scored.coverage.text,
      eligible: scored.eligible,
      reason: scored.reason,
      pillars: pillarSummary(scored),
      headlineMetrics,
      summary: CAVEAT,
    };
  } catch (error) {
    return {
      ok: false,
      action: 'show_city_intel',
      error: error?.message || 'show_city_intel failed',
    };
  }
}

/**
 * Fit a set of months to `{start, len}` iff they form one contiguous run
 * (wrap past December allowed), by brute-forcing the 12 possible starts
 * against `plan.js`'s own `monthsOf` — cheaper than writing a bespoke
 * contiguity check, and it can never disagree with what `plan.js` accepts.
 * @param {*} months Expected to be an array of unique integers 1-12.
 * @returns {{start: number, len: number}|null} null when invalid or non-contiguous.
 */
function monthsToRun(months) {
  if (!Array.isArray(months) || !months.length || months.length > 12)
    return null;
  const set = new Set(months);
  if (set.size !== months.length) return null; // duplicates
  for (const m of set) if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  const len = months.length;
  for (let start = 1; start <= 12; start++) {
    const candidate = monthsOf({ start, len });
    if (candidate.length === set.size && candidate.every((m) => set.has(m)))
      return { start, len };
  }
  return null;
}

/** First stay in `placed` that shares a month with `candidate`, or null. */
function findClash(placed, candidate) {
  const clash = new Set(overlaps(placed, candidate));
  return placed.find((p) => monthsOf(p).some((m) => clash.has(m))) || null;
}

/**
 * `plan_lifestyle` voice tool: resolve every stay's city, work out its
 * months (evenly split when omitted), validate contiguity and overlap, then
 * replace the whole Lifestyle Plan atomically. See docs/cockpit/SPEC.md §3.5.
 * @param {object|null} cityIntel
 * @param {{stays?: Array<{city?: string, months?: number[]}>}} [args]
 * @param {{signal?: AbortSignal, isCurrent?: () => boolean}} [runOptions]
 */
export async function planLifestyle(cityIntel, args = {}, runOptions = {}) {
  if (!cityIntel) return unavailable('plan_lifestyle');
  if (!cityIntel.plan)
    return {
      ok: false,
      action: 'plan_lifestyle',
      error: 'lifestyle-plan-unavailable',
    };

  const inputStays = Array.isArray(args.stays) ? args.stays : [];
  if (!inputStays.length) {
    return {
      ok: false,
      action: 'plan_lifestyle',
      error: 'plan_lifestyle needs at least one stay',
    };
  }

  const { cities, countries } = await loadPackData();
  const { resolved: perName, unresolved } = resolveNames(
    cities,
    countries,
    inputStays.map((s) => s?.city),
  );
  if (unresolved.length) {
    return {
      ok: false,
      action: 'plan_lifestyle',
      error: `Could not find: ${unresolved.join(', ')}`,
      unresolved,
    };
  }

  // Each run tracks its own months once known; `start`/`len` stay null for a
  // stay whose months are assigned automatically below.
  const runs = inputStays.map((input, i) => ({
    label: `${perName[i].city.name} (${perName[i].city.country})`,
    city: perName[i].city,
    start: null,
    len: null,
    hadMonths: input?.months !== undefined && input?.months !== null,
  }));
  for (let i = 0; i < runs.length; i++) {
    if (!runs[i].hadMonths) continue;
    const run = monthsToRun(inputStays[i].months);
    if (!run) {
      return {
        ok: false,
        action: 'plan_lifestyle',
        error: `${runs[i].label}'s months are not one contiguous run: ${JSON.stringify(inputStays[i].months)}`,
      };
    }
    runs[i].start = run.start;
    runs[i].len = run.len;
  }

  const explicit = runs.filter((r) => r.hadMonths);
  const implicit = runs.filter((r) => !r.hadMonths);
  let note = null;

  if (implicit.length === runs.length) {
    // No stay named months: split the year evenly, in the order given.
    const splits = evenSplit(runs.length);
    runs.forEach((r, i) => {
      r.start = splits[i].start;
      r.len = splits[i].len;
    });
    note = `Split the year evenly in the order given: ${splits.map((s) => s.len).join('/')} months.`;
  } else {
    // At least one stay named months: they must not clash with each other.
    const placed = [];
    for (const r of explicit) {
      const clash = findClash(placed, r);
      if (clash) {
        return {
          ok: false,
          action: 'plan_lifestyle',
          error: `${r.label} (${spanLabel(r)}) overlaps ${clash.label} (${spanLabel(clash)})`,
        };
      }
      placed.push(r);
    }
    if (implicit.length) {
      // Fill the unspecified stays evenly across whatever's left, in order.
      const covered = new Set(explicit.flatMap((r) => monthsOf(r)));
      const free = [];
      for (let m = 1; m <= 12; m++) if (!covered.has(m)) free.push(m);
      const freeRun = monthsToRun(free);
      if (!freeRun) {
        return {
          ok: false,
          action: 'plan_lifestyle',
          error: `The open months are split across the year; give explicit months for ${implicit.map((r) => r.label).join(', ')}`,
        };
      }
      if (freeRun.len < implicit.length) {
        return {
          ok: false,
          action: 'plan_lifestyle',
          error: `Only ${freeRun.len} open month(s) left for ${implicit.length} unhinted stays`,
        };
      }
      const fillSplits = evenSplit(implicit.length, freeRun.len, freeRun.start);
      implicit.forEach((r, i) => {
        r.start = fillSplits[i].start;
        r.len = fillSplits[i].len;
      });
      note = `Filled the open months evenly for ${implicit.map((r) => r.label).join(', ')}.`;
    }
  }

  try {
    if (!(await ensureMode(cityIntel, runOptions)))
      return cancelled('plan_lifestyle');
    await cityIntel.plan.ready();
    if (!isCurrent(runOptions)) return cancelled('plan_lifestyle');

    const stays = runs.map((r) => ({
      cityId: r.city.id,
      start: r.start,
      len: r.len,
    }));
    const result = cityIntel.plan.replaceStays(stays);
    if (!result.ok) {
      return {
        ok: false,
        action: 'plan_lifestyle',
        error: result.detail || result.error || 'plan_lifestyle failed',
      };
    }
    cityIntel.plan.show();
    cityIntel.panel.markVoice('plan');

    const summary = cityIntel.plan.getSummary();
    const staysOut = (summary?.stays || []).map((s) => ({
      city: `${s.name} (${s.country})`,
      span: s.span,
      fit: s.metrics?.fit?.score ?? null,
      cost: s.metrics?.cost
        ? {
            ratio: s.metrics.cost.ratio,
            estimateUsd: s.metrics.cost.override ?? s.metrics.cost.estimateUsd,
            basis: s.metrics.cost.basis,
            label: s.metrics.cost.label,
          }
        : null,
      comfort: s.metrics?.comfort?.mean ?? null,
      visa: s.metrics?.visa?.status ?? null,
    }));
    const r = summary?.rollup;
    const rollup = r
      ? {
          monthsCovered: r.monthsCovered,
          gaps: r.gaps,
          annualCost: r.annualCost?.complete
            ? r.annualCost.usd
            : (r.annualCost?.label ?? null),
          moves: r.moves,
          km: r.km,
        }
      : null;

    return {
      ok: true,
      action: 'plan_lifestyle',
      stays: staysOut,
      rollup,
      ...(note ? { note } : {}),
      summary: CAVEAT,
    };
  } catch (error) {
    return {
      ok: false,
      action: 'plan_lifestyle',
      error: error?.message || 'plan_lifestyle failed',
    };
  }
}
