import test from 'node:test';
import assert from 'node:assert/strict';
import { GEV_ACTION_SCHEMAS, createActionTools } from './actionSchemas.js';
import { ACTION_DESCRIPTIONS } from '../../server/providers/openai/toolDescriptions.js';
import {
  compareCities,
  planLifestyle,
  rankCities,
  resolveCity,
  showCityIntel,
} from './cityIntelActions.js';
import { evenSplit } from '../layers/cityIntel/plan.js';

const CAVEAT =
  'Scores are mostly country-level public statistics; not relocation advice.';
const NEW_TOOLS = [
  'rank_cities',
  'compare_cities',
  'show_city_intel',
  'plan_lifestyle',
];

function fakeCityIntel(overrides = {}) {
  const calls = [];
  const cityIntel = {
    mode: {
      active: overrides.modeActive ?? false,
      isActive() {
        return this.active;
      },
      async enter() {
        calls.push(['mode.enter']);
        this.active = true;
      },
      exit() {
        calls.push(['mode.exit']);
      },
    },
    panel: {
      async ready() {
        calls.push(['panel.ready']);
      },
      setWeights(weights) {
        calls.push(['panel.setWeights', weights]);
      },
      setFilters(filters) {
        calls.push(['panel.setFilters', filters]);
      },
      getTopRanked(n) {
        calls.push(['panel.getTopRanked', n]);
        return overrides.topRanked ?? [];
      },
      getScored(id) {
        calls.push(['panel.getScored', id]);
        return overrides.scoredById?.get(id) ?? null;
      },
      select(id) {
        calls.push(['panel.select', id]);
      },
      setPins(ids) {
        calls.push(['panel.setPins', ids]);
        return overrides.setPinsResult ?? { pinned: ids, refused: [] };
      },
      openCompare() {
        calls.push(['panel.openCompare']);
      },
      markVoice(surface) {
        calls.push(['panel.markVoice', surface]);
      },
    },
  };
  if (overrides.noPlan !== true) {
    cityIntel.plan = {
      async ready() {
        calls.push(['plan.ready']);
      },
      show() {
        calls.push(['plan.show']);
      },
      getStays() {
        return overrides.planStays ?? [];
      },
      replaceStays(stays) {
        calls.push(['plan.replaceStays', stays]);
        return overrides.replaceStaysResult ?? { ok: true, stays };
      },
      getSummary() {
        calls.push(['plan.getSummary']);
        return overrides.planSummary ?? { stays: [], rollup: null };
      },
    };
  }
  return { cityIntel, calls };
}

function scoredFixture(id, name, country, composite = 70) {
  const metric = (key, label, raw, unit, source) => ({
    key,
    label,
    raw,
    unit,
    year: 2023,
    level: 'country',
    pct: 60,
    source,
    derived: false,
    status: 'ok',
    detail: null,
  });
  return {
    id,
    city: { id, name, country },
    composite,
    coverage: {
      pillarsAvailable: 4,
      cityLevelMetrics: 1,
      text: '4 of 4 pillars · 1 city-level metric',
    },
    eligible: true,
    reason: null,
    pillars: {
      qol: {
        score: 70,
        coverage: 'full',
        metrics: [
          metric('lifeExpectancy', 'Life expectancy', 80, 'years', 'WDI'),
        ],
      },
      cost: {
        score: 60,
        coverage: 'full',
        metrics: [metric('priceLevel', 'Price level', 0.9, 'ratio', 'WDI')],
      },
      safety: {
        score: 75,
        coverage: 'full',
        metrics: [
          metric('homicideRate', 'Homicide rate', 1.2, 'per 100k', 'WDI'),
        ],
      },
      travel: {
        score: 65,
        coverage: 'full',
        metrics: [
          metric(
            'airportAccess',
            'Airport access',
            90,
            'index 0-100',
            'OurAirports',
          ),
        ],
      },
    },
  };
}

test('schema/description parity: every new schema has a description', () => {
  for (const name of NEW_TOOLS) {
    assert.ok(
      GEV_ACTION_SCHEMAS.some((s) => s.name === name),
      `${name} missing from schemas`,
    );
    assert.ok(
      ACTION_DESCRIPTIONS[name]?.description,
      `${name} missing a description`,
    );
  }
  const tools = createActionTools(ACTION_DESCRIPTIONS);
  for (const name of NEW_TOOLS) {
    const tool = tools.find((t) => t.name === name);
    assert.equal(tool.type, 'function');
    assert.equal(tool.parameters.additionalProperties, false);
    assert.ok(tool.description);
  }
});

test('resolveCity: exact match, country hint overrides population, unresolved', () => {
  const cities = [
    {
      id: 'valencia-ven',
      name: 'Valencia',
      country: 'Venezuela, RB',
      pop: 1770000,
      airport: { iata: 'VLN', type: 'large' },
      capital: false,
    },
    {
      id: 'valencia-esp',
      name: 'Valencia',
      country: 'Spain',
      pop: 808000,
      airport: { iata: 'VLC', type: 'large' },
      capital: false,
    },
    {
      id: 'san-jose-cri',
      name: 'San José',
      country: 'Costa Rica',
      pop: 1284000,
      airport: { iata: 'SJO', type: 'large' },
      capital: true,
    },
    {
      id: 'lisbon-prt',
      name: 'Lisbon',
      country: 'Portugal',
      pop: 2812000,
      airport: { iata: 'LIS', type: 'large' },
      capital: true,
    },
  ];

  // Ambiguous, no hint: the larger-population match wins (Venezuela over Spain).
  const noHint = resolveCity(cities, 'Valencia');
  assert.equal(noHint.city.id, 'valencia-ven');

  // Comma country hint overrides the population-only pick.
  const commaHint = resolveCity(cities, 'Valencia, Spain');
  assert.equal(commaHint.city.id, 'valencia-esp');
  assert.equal(commaHint.label, 'Valencia (Spain)');

  // Space-separated country hint, no comma.
  const spaceHint = resolveCity(cities, 'San José Costa Rica');
  assert.equal(spaceHint.city.id, 'san-jose-cri');

  // Simple unambiguous match.
  assert.equal(resolveCity(cities, 'Lisbon').city.id, 'lisbon-prt');

  // Nothing matches.
  assert.equal(resolveCity(cities, 'Nowhereville'), null);
  assert.equal(resolveCity(cities, ''), null);
  assert.equal(resolveCity(null, 'Lisbon'), null);
});

test('rank_cities: null handle reports unavailable without touching cityIntel', async () => {
  const result = await rankCities(null, {});
  assert.deepEqual(result, {
    ok: false,
    action: 'rank_cities',
    error: 'city-intel-unavailable',
  });
});

test('rank_cities: enters mode, applies only provided weights, filters by region, marks voice', async () => {
  const { cityIntel, calls } = fakeCityIntel({
    topRanked: [{ rank: 1, name: 'Lisbon', country: 'Portugal' }],
  });
  const result = await rankCities(cityIntel, {
    region: 'Europe',
    weights: { safety: 9, cost: 8 },
    limit: 3,
  });
  assert.equal(result.ok, true);
  assert.ok(result.summary.includes(CAVEAT));
  assert.deepEqual(result.cities, [
    { rank: 1, name: 'Lisbon', country: 'Portugal' },
  ]);
  assert.deepEqual(
    calls.filter(([op]) => op === 'mode.enter' || op === 'panel.ready'),
    [['mode.enter'], ['panel.ready']],
  );
  assert.deepEqual(
    calls.find(([op]) => op === 'panel.setWeights'),
    ['panel.setWeights', { safety: 9, cost: 8 }],
  );
  assert.deepEqual(
    calls.find(([op]) => op === 'panel.setFilters'),
    ['panel.setFilters', { continent: 'Europe' }],
  );
  assert.deepEqual(
    calls.find(([op]) => op === 'panel.getTopRanked'),
    ['panel.getTopRanked', 3],
  );
  assert.ok(
    calls.some(([op, arg]) => op === 'panel.markVoice' && arg === 'panel'),
  );
});

test('rank_cities: skips mode.enter when already active and defaults limit to 5', async () => {
  const { cityIntel, calls } = fakeCityIntel({
    modeActive: true,
    topRanked: [],
  });
  const result = await rankCities(cityIntel, {});
  assert.equal(result.ok, true);
  assert.ok(result.summary.includes(CAVEAT));
  assert.equal(
    calls.some(([op]) => op === 'mode.enter'),
    false,
  );
  assert.deepEqual(
    calls.find(([op]) => op === 'panel.getTopRanked'),
    ['panel.getTopRanked', 5],
  );
  assert.deepEqual(
    calls.find(([op]) => op === 'panel.setFilters'),
    ['panel.setFilters', { continent: null }],
  );
});

test('compare_cities: an ambiguous unhinted name picks the continent matching the other city', async () => {
  const { cityIntel } = fakeCityIntel();
  // Bare population rank would pick Valencia, Venezuela — wrong for a
  // "compare Lisbon and Valencia" request where Lisbon anchors Europe.
  const result = await compareCities(cityIntel, {
    cities: ['Lisbon', 'Valencia'],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.resolved, ['Lisbon (Portugal)', 'Valencia (Spain)']);
});

test('compare_cities: null handle reports unavailable', async () => {
  const result = await compareCities(null, { cities: ['Lisbon', 'Valencia'] });
  assert.deepEqual(result, {
    ok: false,
    action: 'compare_cities',
    error: 'city-intel-unavailable',
  });
});

test('compare_cities: fewer than 2 resolved names fails honestly', async () => {
  const { cityIntel, calls } = fakeCityIntel();
  const result = await compareCities(cityIntel, {
    cities: ['Nowhereville', 'Nowhereland'],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /0 of 2/);
  assert.deepEqual(result.unresolved, ['Nowhereville', 'Nowhereland']);
  assert.equal(
    calls.length,
    0,
    'must not touch cityIntel before resolution succeeds',
  );
});

test('compare_cities: resolves, pins (reporting refused), opens compare, reports unresolved', async () => {
  const scoredById = new Map([
    ['lisbon-prt', scoredFixture('lisbon-prt', 'Lisbon', 'Portugal', 82)],
  ]);
  const { cityIntel, calls } = fakeCityIntel({
    scoredById,
    setPinsResult: { pinned: ['lisbon-prt'], refused: ['some-other-id'] },
  });
  // 3 names, 2 resolvable — must still succeed and report the one unresolved.
  const result = await compareCities(cityIntel, {
    cities: ['Lisbon', 'Valencia, Spain', 'Nowhereville'],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.unresolved, ['Nowhereville']);
  assert.deepEqual(result.resolved, ['Lisbon (Portugal)', 'Valencia (Spain)']);
  assert.deepEqual(result.pinned, ['lisbon-prt']);
  assert.deepEqual(result.refused, ['some-other-id']);
  assert.equal(result.cities[0].name, 'Lisbon');
  assert.equal(result.summary, CAVEAT);
  assert.ok(calls.some(([op]) => op === 'mode.enter'));
  assert.ok(calls.some(([op]) => op === 'panel.openCompare'));
  assert.ok(
    calls.some(([op, arg]) => op === 'panel.markVoice' && arg === 'compare'),
  );
});

test('show_city_intel: null handle reports unavailable', async () => {
  const result = await showCityIntel(null, { city: 'Lisbon' });
  assert.deepEqual(result, {
    ok: false,
    action: 'show_city_intel',
    error: 'city-intel-unavailable',
  });
});

test('show_city_intel: unresolved name fails honestly without touching cityIntel', async () => {
  const { cityIntel, calls } = fakeCityIntel();
  const result = await showCityIntel(cityIntel, { city: 'Nowhereville' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Nowhereville/);
  assert.equal(calls.length, 0);
});

test('show_city_intel: resolves, selects, returns pillars/headline metrics and eligibility reason', async () => {
  const scored = scoredFixture('lisbon-prt', 'Lisbon', 'Portugal', 82);
  const { cityIntel, calls } = fakeCityIntel({
    scoredById: new Map([['lisbon-prt', scored]]),
  });
  const result = await showCityIntel(cityIntel, { city: 'Lisbon' });
  assert.equal(result.ok, true);
  assert.equal(result.resolved, 'Lisbon (Portugal)');
  assert.equal(result.composite, 82);
  assert.equal(result.eligible, true);
  assert.equal(result.reason, null);
  assert.equal(result.headlineMetrics.length, 4);
  assert.ok(result.headlineMetrics.every((m) => m.source && m.year && m.level));
  assert.equal(result.summary, CAVEAT);
  assert.ok(
    calls.some(([op, id]) => op === 'panel.select' && id === 'lisbon-prt'),
  );
  assert.ok(
    calls.some(([op, arg]) => op === 'panel.markVoice' && arg === 'panel'),
  );
});

test('show_city_intel: ineligible city still reports its reason', async () => {
  const scored = {
    ...scoredFixture('x', 'X', 'Y', null),
    eligible: false,
    reason: 'safety-unavailable',
  };
  const { cityIntel } = fakeCityIntel({
    scoredById: new Map([['lisbon-prt', scored]]),
  });
  const result = await showCityIntel(cityIntel, { city: 'Lisbon' });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'safety-unavailable');
});

test('runOptions.isCurrent supersedes an in-flight request', async () => {
  const { cityIntel } = fakeCityIntel({ topRanked: [] });
  const result = await rankCities(cityIntel, {}, { isCurrent: () => false });
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.match(result.error, /superseded/);
});

// ── rank_cities: report-only months/comfort ─────────────────────────────

test('rank_cities: months adds report-only comfort without touching ranking', async () => {
  const topRanked = [
    {
      rank: 1,
      id: 'tokyo-jpn',
      name: 'Tokyo',
      country: 'Japan',
      composite: 80,
    },
    {
      rank: 2,
      id: 'nowhere-xyz',
      name: 'Nowhere',
      country: 'Nowhereland',
      composite: 70,
    },
  ];
  const { cityIntel } = fakeCityIntel({ topRanked });
  const result = await rankCities(cityIntel, { months: [12, 1, 2] });
  assert.equal(result.ok, true);
  // Ranking fields are untouched.
  assert.equal(result.cities[0].rank, 1);
  assert.equal(result.cities[0].composite, 80);
  assert.equal(result.cities[1].composite, 70);
  // Comfort is present (real seasonality) for Tokyo, unavailable for a
  // city id with no seasonality row.
  assert.equal(result.cities[0].comfortStatus, 'ok');
  assert.ok(Number.isInteger(result.cities[0].comfort));
  assert.equal(result.cities[1].comfortStatus, 'unavailable');
  assert.equal(result.cities[1].comfort, null);
  assert.ok(result.summary.includes(CAVEAT));
});

test('rank_cities: without months, no comfort fields are added', async () => {
  const { cityIntel } = fakeCityIntel({
    topRanked: [{ rank: 1, id: 'tokyo-jpn', name: 'Tokyo', country: 'Japan' }],
  });
  const result = await rankCities(cityIntel, {});
  assert.equal(result.ok, true);
  assert.equal('comfort' in result.cities[0], false);
  assert.equal('comfortStatus' in result.cities[0], false);
});

// ── plan_lifestyle ───────────────────────────────────────────────────────

test('plan_lifestyle: null handle reports unavailable', async () => {
  const result = await planLifestyle(null, { stays: [{ city: 'Lisbon' }] });
  assert.deepEqual(result, {
    ok: false,
    action: 'plan_lifestyle',
    error: 'city-intel-unavailable',
  });
});

test('plan_lifestyle: no plan handle reports lifestyle-plan-unavailable', async () => {
  const { cityIntel } = fakeCityIntel({ noPlan: true });
  const result = await planLifestyle(cityIntel, {
    stays: [{ city: 'Lisbon' }],
  });
  assert.deepEqual(result, {
    ok: false,
    action: 'plan_lifestyle',
    error: 'lifestyle-plan-unavailable',
  });
});

test('plan_lifestyle: an unresolved city fails honestly and touches nothing', async () => {
  const { cityIntel, calls } = fakeCityIntel();
  const result = await planLifestyle(cityIntel, {
    stays: [{ city: 'Lisbon' }, { city: 'Nowhereville' }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unresolved, ['Nowhereville']);
  assert.equal(calls.length, 0, 'must not touch cityIntel or replaceStays');
});

test('plan_lifestyle: no stay has months -> evenSplit in the order given (n=1..3)', async () => {
  const names = ['Lisbon', 'Valencia, Spain', 'Montevideo'];
  const ids = ['lisbon-prt', 'valencia-esp', 'montevideo-ury'];
  for (let n = 1; n <= 3; n++) {
    const { cityIntel, calls } = fakeCityIntel();
    const stays = names.slice(0, n).map((city) => ({ city }));
    const result = await planLifestyle(cityIntel, { stays });
    assert.equal(result.ok, true, result.error);
    const splits = evenSplit(n);
    assert.equal(
      result.note,
      `Split the year evenly in the order given: ${splits.map((s) => s.len).join('/')} months.`,
    );
    const expected = splits.map((split, i) => ({
      cityId: ids[i],
      ...split,
    }));
    assert.deepEqual(
      calls.find(([op]) => op === 'plan.replaceStays')[1],
      expected,
    );
  }
});

test('plan_lifestyle: some months given, others filled evenly across what is left', async () => {
  const { cityIntel, calls } = fakeCityIntel();
  const result = await planLifestyle(cityIntel, {
    stays: [
      { city: 'Lisbon', months: [1, 2, 3, 4] },
      { city: 'Valencia, Spain' },
      { city: 'Montevideo' },
    ],
  });
  assert.equal(result.ok, true, result.error);
  assert.match(result.note, /Filled the open months evenly/);
  assert.deepEqual(calls.find(([op]) => op === 'plan.replaceStays')[1], [
    { cityId: 'lisbon-prt', start: 1, len: 4 },
    { cityId: 'valencia-esp', start: 5, len: 4 },
    { cityId: 'montevideo-ury', start: 9, len: 4 },
  ]);
});

test('plan_lifestyle: wrap-past-December months are accepted', async () => {
  const { cityIntel, calls } = fakeCityIntel();
  const result = await planLifestyle(cityIntel, {
    stays: [{ city: 'Lisbon', months: [11, 12, 1, 2] }],
  });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(calls.find(([op]) => op === 'plan.replaceStays')[1], [
    { cityId: 'lisbon-prt', start: 11, len: 4 },
  ]);
});

test('plan_lifestyle: non-contiguous months are rejected honestly, nothing touched', async () => {
  const { cityIntel, calls } = fakeCityIntel();
  const result = await planLifestyle(cityIntel, {
    stays: [{ city: 'Lisbon', months: [1, 3] }],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /not one contiguous run/);
  assert.equal(calls.length, 0);
});

test('plan_lifestyle: an overlap between named-months stays is rejected, naming both', async () => {
  const { cityIntel, calls } = fakeCityIntel();
  const result = await planLifestyle(cityIntel, {
    stays: [
      { city: 'Lisbon', months: [1, 2, 3, 4] },
      { city: 'Valencia, Spain', months: [3, 4, 5, 6] },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Lisbon \(Portugal\)/);
  assert.match(result.error, /Valencia \(Spain\)/);
  assert.equal(calls.length, 0);
});

test('plan_lifestyle: a replaceStays failure is reported, not swallowed', async () => {
  const { cityIntel } = fakeCityIntel({
    replaceStaysResult: { ok: false, error: 'overlap', detail: 'clash' },
  });
  const result = await planLifestyle(cityIntel, {
    stays: [{ city: 'Lisbon' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'clash');
});

test('plan_lifestyle: success reshapes the summary into per-stay fields, rollup and caveat', async () => {
  const planSummary = {
    stays: [
      {
        id: 's1',
        cityId: 'lisbon-prt',
        name: 'Lisbon',
        country: 'Portugal',
        span: 'JAN–DEC · 12 mo',
        metrics: {
          fit: { score: 73, coverageText: '4 of 4 pillars' },
          cost: {
            ratio: 0.62,
            estimateUsd: 1860,
            basis: 'estimate',
            label: 'x0.62 home',
          },
          comfort: { mean: 61, months: [], status: 'ok' },
          safety: { score: 80, coverage: 'full' },
          advisory: { level: 1 },
          visa: { status: 'ok', allowanceDays: 90 },
        },
      },
    ],
    rollup: {
      monthsCovered: 12,
      gaps: [],
      fitMean: 73,
      annualCost: { usd: 22000, coveredMonths: 12, complete: true },
      comfortMean: 61,
      maxAdvisory: 1,
      moves: 0,
      km: 0,
    },
  };
  const { cityIntel } = fakeCityIntel({ planSummary });
  const result = await planLifestyle(cityIntel, {
    stays: [{ city: 'Lisbon' }],
  });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.stays, [
    {
      city: 'Lisbon (Portugal)',
      span: 'JAN–DEC · 12 mo',
      fit: 73,
      cost: {
        ratio: 0.62,
        estimateUsd: 1860,
        basis: 'estimate',
        label: 'x0.62 home',
      },
      comfort: 61,
      visa: 'ok',
    },
  ]);
  assert.deepEqual(result.rollup, {
    monthsCovered: 12,
    gaps: [],
    annualCost: 22000,
    moves: 0,
    km: 0,
  });
  assert.equal(result.summary, CAVEAT);
});

function schengenPlanSummary(schengen) {
  return {
    stays: [],
    rollup: {
      monthsCovered: 4,
      gaps: [],
      annualCost: { usd: null, complete: false, label: 'partial' },
      moves: 1,
      km: 500,
      schengen,
    },
  };
}

test('plan_lifestyle: a Schengen-exceeding plan reports rollup.schengen', async () => {
  const { cityIntel } = fakeCityIntel({
    planSummary: schengenPlanSummary({
      applies: true,
      maxDaysIn180: 120,
      limit: 90,
      exceeds: true,
      windowStartDay: 0,
    }),
  });
  const result = await planLifestyle(cityIntel, {
    stays: [{ city: 'Lisbon', months: [1, 2, 3, 4] }],
  });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(
    result.rollup.schengen,
    { maxDaysIn180: 120, limit: 90, exceeds: true },
    'only the voice-facing fields, no windowStartDay',
  );
});

test('plan_lifestyle: rollup.schengen is absent when the rule does not apply', async () => {
  const { cityIntel } = fakeCityIntel({
    planSummary: schengenPlanSummary({
      applies: false,
      maxDaysIn180: 0,
      limit: 90,
      exceeds: false,
      windowStartDay: null,
    }),
  });
  const result = await planLifestyle(cityIntel, {
    stays: [{ city: 'Lisbon', months: [1, 2, 3, 4] }],
  });
  assert.equal(result.ok, true, result.error);
  assert.equal('schengen' in result.rollup, false);
  assert.equal(result.rollup.annualCost, 'partial');
});

test('plan_lifestyle: isCurrent supersedes an in-flight request', async () => {
  const { cityIntel } = fakeCityIntel();
  const result = await planLifestyle(
    cityIntel,
    { stays: [{ city: 'Lisbon' }] },
    { isCurrent: () => false },
  );
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.match(result.error, /superseded/);
});
