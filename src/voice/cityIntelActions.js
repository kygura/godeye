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

async function loadCities() {
  return (await loadPackData()).cities;
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
 * `rank_cities` voice tool: apply weights/region and return the top ranked
 * cities. See docs/cockpit/SPEC.md §4.
 * @param {object|null} cityIntel
 * @param {{region?: string, weights?: object, limit?: number}} [args]
 * @param {{signal?: AbortSignal, isCurrent?: () => boolean}} [runOptions]
 */
export async function rankCities(cityIntel, args = {}, runOptions = {}) {
  if (!cityIntel) return unavailable('rank_cities');
  try {
    if (!cityIntel.mode.isActive()) await cityIntel.mode.enter();
    if (!isCurrent(runOptions)) return cancelled('rank_cities');
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
    const cities = cityIntel.panel.getTopRanked(limit) || [];
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
    const continentOf = (city) => countries[city.iso3]?.continent || null;

    const perName = names.map((raw) => ({
      raw,
      ...candidatesFor(cities, raw),
    }));

    // Anchor vote: names that are already unambiguous (hinted, or only one
    // pack match) vote their continent. An ambiguous, unhinted name (e.g.
    // "Valencia" against Lisbon and Montevideo) then prefers the candidate
    // matching the other cities' continent over the bare population-rank
    // top pick, which is otherwise wrong for "compare Lisbon and Valencia"
    // (Valencia, Venezuela outranks Valencia, Spain on population alone).
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

    const resolved = [];
    const picks = [];
    const unresolved = [];
    for (const entry of perName) {
      if (!entry.matches.length) {
        unresolved.push(entry.raw);
        continue;
      }
      let city = entry.matches[0];
      if (!entry.hinted && entry.matches.length > 1 && majority) {
        const preferred = entry.matches.find(
          (candidate) => continentOf(candidate) === majority,
        );
        if (preferred) city = preferred;
      }
      resolved.push(city);
      picks.push(`${city.name} (${city.country})`);
    }
    if (resolved.length < 2) {
      return {
        ok: false,
        action: 'compare_cities',
        error: `Could not resolve enough cities to compare (${resolved.length} of ${names.length})`,
        unresolved,
      };
    }
    if (!isCurrent(runOptions)) return cancelled('compare_cities');
    if (!cityIntel.mode.isActive()) await cityIntel.mode.enter();
    if (!isCurrent(runOptions)) return cancelled('compare_cities');

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
        pillars: Object.fromEntries(
          Object.entries(s.pillars).map(([pillar, p]) => [
            pillar,
            { score: p.score, coverage: p.coverage },
          ]),
        ),
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
    const cities = await loadCities();
    const match = resolveCity(cities, query);
    if (!match) {
      return {
        ok: false,
        action: 'show_city_intel',
        error: `Could not find a city matching "${query}"`,
      };
    }
    if (!isCurrent(runOptions)) return cancelled('show_city_intel');
    if (!cityIntel.mode.isActive()) await cityIntel.mode.enter();
    if (!isCurrent(runOptions)) return cancelled('show_city_intel');

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
      pillars: Object.fromEntries(
        Object.entries(scored.pillars).map(([key, p]) => [
          key,
          { score: p.score, coverage: p.coverage },
        ]),
      ),
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
