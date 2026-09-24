import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PILLARS,
  airportAccess,
  createCityIntelIndex,
  percentileRanks,
  visaAccessLevel,
} from './scoring.js';

const meta = (pillar, direction, extra = {}) => ({
  label: extra.label ?? 'Metric',
  unit: 'unit',
  pillar,
  direction,
  source: 'World Bank WDI',
  code: 'X',
  url: 'https://example.org',
  license: 'CC BY 4.0',
  derived: false,
  ...extra,
});
const INDICATORS = {
  lifeExpectancy: meta('qol', 'higher', { label: 'Life expectancy' }),
  internetUsers: meta('qol', 'higher'),
  pm25: meta('qol', 'lower'),
  priceLevel: meta('cost', 'lower', { derived: true }),
  homicideRate: meta('safety', 'lower'),
  politicalStability: meta('safety', 'higher'),
};
const KEYS = Object.keys(INDICATORS);

/** Country record with every metric = value (year 2024), minus `omit` keys. */
function country(value, { continent = 'Europe', omit = [], y = 2024 } = {}) {
  const metrics = {};
  for (const key of KEYS)
    if (!omit.includes(key)) metrics[key] = { v: value, y };
  return {
    name: 'X',
    iso2: 'XX',
    region: 'R',
    continent,
    subregion: 'S',
    metrics,
  };
}
const LARGE_NEAR = { iata: 'AAA', km: 10, type: 'large' };
const city = (id, iso3, pop = 1e6, airport = LARGE_NEAR) => ({
  id,
  name: id,
  iso3,
  country: `Country ${iso3}`,
  admin1: '',
  lat: 0,
  lon: 0,
  pop,
  capital: false,
  airport,
});
const pack = (countries, cities) => ({
  cities,
  countries: {
    buildYear: 2026,
    maxAgeYears: 10,
    indicators: INDICATORS,
    countries,
  },
});
const EQUAL = { qol: 1, cost: 1, safety: 1, travel: 1 };
const byId = (list) => new Map(list.map((s) => [s.id, s]));
const metricOf = (s, pillar, key) =>
  s.pillars[pillar].metrics.find((m) => m.key === key);

test('percentile ranks are direction-aware with average-rank ties', () => {
  const entries = [
    ['a', 1],
    ['b', 2],
    ['c', 2],
    ['d', 3],
    ['e', 5],
  ];
  const higher = percentileRanks(entries, 'higher');
  assert.deepEqual(Object.fromEntries(higher), {
    a: 0,
    b: 37.5,
    c: 37.5,
    d: 75,
    e: 100,
  });
  const lower = percentileRanks(entries, 'lower');
  assert.deepEqual(Object.fromEntries(lower), {
    e: 0,
    d: 25,
    b: 62.5,
    c: 62.5,
    a: 100,
  });
  assert.equal(percentileRanks([['x', 9]], 'higher').get('x'), 50);
  assert.deepEqual(
    [
      ...percentileRanks(
        [
          ['x', 1],
          ['y', 1],
        ],
        'lower',
      ).values(),
    ],
    [50, 50],
  );
});

test('country metrics are ranked once across countries, not per city', () => {
  const countries = { AAA: country(70), BBB: country(80), CCC: country(75) };
  const cities = [
    ...Array.from({ length: 10 }, (_, i) => city(`a${i}`, 'AAA')),
    city('b', 'BBB'),
    city('c', 'CCC'),
  ];
  const scored = byId(
    createCityIntelIndex(pack(countries, cities)).score(EQUAL),
  );
  const life = (id) => metricOf(scored.get(id), 'qol', 'lifeExpectancy');
  assert.equal(life('a3').pct, 0);
  assert.equal(life('c').pct, 50);
  assert.equal(life('b').pct, 100);
  assert.deepEqual(life('c'), {
    key: 'lifeExpectancy',
    label: 'Life expectancy',
    raw: 75,
    unit: 'unit',
    year: 2024,
    level: 'country',
    pct: 50,
    source: 'World Bank WDI',
    derived: false,
    status: 'ok',
    detail: null,
  });
  // Direction flips for lower-is-better metrics.
  assert.equal(metricOf(scored.get('b'), 'cost', 'priceLevel').pct, 0);
  assert.equal(metricOf(scored.get('b'), 'cost', 'priceLevel').derived, true);
});

test('composite renormalises weights over available pillars', () => {
  const countries = {
    AAA: country(1, { omit: ['priceLevel'] }),
    BBB: country(2),
    CCC: country(3),
  };
  const index = createCityIntelIndex(
    pack(countries, [city('a', 'AAA'), city('b', 'BBB'), city('c', 'CCC')]),
  );
  const weights = { qol: 2, cost: 5, safety: 1, travel: 1 };
  const a = byId(index.score(weights)).get('a');
  assert.equal(a.pillars.cost.coverage, 'unavailable');
  assert.equal(a.pillars.cost.score, null);
  const { qol, safety, travel } = a.pillars;
  const expected = (2 * qol.score + safety.score + travel.score) / 4;
  assert.ok(Math.abs(a.composite - expected) < 1e-9);
  assert.equal(a.coverage.pillarsAvailable, 3);
  assert.equal(a.coverage.text, '3 of 4 pillars · 1 city-level metric');
  assert.equal(a.eligible, true);
});

test('all-zero weights mean equal weights; invalid weights throw', () => {
  const index = createCityIntelIndex(
    pack({ AAA: country(1), BBB: country(2) }, [
      city('a', 'AAA'),
      city('b', 'BBB'),
    ]),
  );
  assert.deepEqual(
    index.score({ qol: 0, cost: 0, safety: 0, travel: 0 }),
    index.score({ qol: 1, cost: 1, safety: 1, travel: 1 }),
  );
  assert.throws(() => index.score({ ...EQUAL, cost: -1 }), RangeError);
  assert.throws(() => index.score({ qol: 1, cost: 1, safety: 1 }), RangeError);
});

test('eligibility needs safety and at least 3 of 4 pillars', () => {
  const countries = {
    OK: country(5),
    NOSAFE: country(5, { omit: ['homicideRate', 'politicalStability'] }),
    TWO: country(5, {
      omit: ['lifeExpectancy', 'internetUsers', 'pm25', 'priceLevel'],
    }),
  };
  const index = createCityIntelIndex(
    pack(countries, [
      city('ok', 'OK'),
      city('nosafe', 'NOSAFE'),
      city('two', 'TWO'),
    ]),
  );
  const scored = index.score(EQUAL);
  const s = byId(scored);
  assert.equal(s.get('nosafe').coverage.pillarsAvailable, 3);
  assert.equal(s.get('nosafe').eligible, false);
  assert.equal(s.get('nosafe').reason, 'safety-unavailable');
  assert.equal(s.get('two').eligible, false);
  assert.equal(s.get('two').reason, 'insufficient-pillars');
  assert.equal(s.get('ok').reason, null);
  assert.deepEqual(
    index.rank(scored, { groupByCountry: false }).rows.map((r) => r.id),
    ['ok'],
  );
  const all = index.rank(scored, {
    groupByCountry: false,
    includeIneligible: true,
  });
  assert.equal(all.rows[0].id, 'ok');
  assert.equal(all.rows.length, 3);
});

test('stale metrics are unavailable and excluded from country ranking', () => {
  const countries = {
    AAA: country(1),
    BBB: country(2),
    OLD: country(9, { y: 2015 }),
    EDGE: country(3, { y: 2016 }),
  };
  const scored = byId(
    createCityIntelIndex(
      pack(
        countries,
        ['AAA', 'BBB', 'OLD', 'EDGE'].map((c) => city(c, c)),
      ),
    ).score(EQUAL),
  );
  const old = metricOf(scored.get('OLD'), 'qol', 'lifeExpectancy');
  assert.deepEqual(
    [old.status, old.raw, old.pct, old.year],
    ['stale', null, null, 2015],
  );
  assert.equal(scored.get('OLD').pillars.safety.coverage, 'unavailable');
  assert.equal(scored.get('OLD').reason, 'safety-unavailable');
  // 2016 = buildYear - maxAgeYears is still fresh, and tops the 3 fresh countries.
  assert.equal(metricOf(scored.get('EDGE'), 'qol', 'lifeExpectancy').pct, 100);
  assert.equal(metricOf(scored.get('BBB'), 'qol', 'lifeExpectancy').pct, 50);
});

test('visa access is unavailable until a passport is set', () => {
  assert.equal(visaAccessLevel(90), 4);
  assert.equal(visaAccessLevel('30'), 4);
  assert.equal(visaAccessLevel(-1), 5);
  assert.equal(visaAccessLevel('Visa free'), 4);
  assert.equal(visaAccessLevel('ETA'), 3);
  assert.equal(visaAccessLevel('visa on arrival'), 3);
  assert.equal(visaAccessLevel('e-visa'), 2);
  assert.equal(visaAccessLevel('visa required'), 1);
  assert.equal(visaAccessLevel('no admission'), 0);
  assert.equal(visaAccessLevel('maybe'), null);
  assert.equal(visaAccessLevel(undefined), null);

  const countries = {
    PRT: country(1),
    USA: country(2),
    CHN: country(3),
    XXX: country(4),
  };
  const index = createCityIntelIndex(
    pack(
      countries,
      Object.keys(countries).map((c) => city(c, c)),
    ),
  );
  const unset = byId(index.score(EQUAL));
  const none = metricOf(unset.get('USA'), 'travel', 'visaAccess');
  assert.deepEqual(
    [none.status, none.raw, none.pct],
    ['no-passport', null, null],
  );
  assert.equal(unset.get('USA').pillars.travel.coverage, 'partial');

  const visa = {
    passport: 'PRT',
    year: 2025,
    byDest: { PRT: -1, USA: 'eta', CHN: 'visa required' },
  };
  const set = byId(index.score(EQUAL, { visa }));
  const usa = metricOf(set.get('USA'), 'travel', 'visaAccess');
  assert.deepEqual(
    [usa.status, usa.raw, usa.pct, usa.level, usa.detail],
    ['ok', 3, 50, 'country', 'eta'],
  );
  assert.equal(metricOf(set.get('PRT'), 'travel', 'visaAccess').pct, 100);
  assert.equal(
    metricOf(set.get('XXX'), 'travel', 'visaAccess').status,
    'missing',
  );
  assert.equal(set.get('USA').pillars.travel.coverage, 'full');
  const stale = byId(index.score(EQUAL, { visa: { ...visa, year: 2010 } }));
  assert.equal(
    metricOf(stale.get('USA'), 'travel', 'visaAccess').status,
    'stale',
  );
  // Back to unset: cached rows for the old visa are not reused.
  assert.equal(
    metricOf(byId(index.score(EQUAL)).get('USA'), 'travel', 'visaAccess')
      .status,
    'no-passport',
  );
  assert.throws(
    () => index.score(EQUAL, { visa: { passport: 'PRT' } }),
    TypeError,
  );
});

test('null airport is lowest access; undefined airport is missing', () => {
  assert.equal(airportAccess({ km: 0, type: 'large' }), 100);
  assert.equal(airportAccess({ km: 50, type: 'medium' }), 25);
  assert.equal(airportAccess({ km: 150, type: 'large' }), 0);
  assert.equal(airportAccess(null), 0);
  assert.equal(airportAccess(undefined), null);
  assert.equal(airportAccess({ km: 5, type: 'small' }), null);

  const index = createCityIntelIndex(
    pack({ AAA: country(1) }, [
      city('near', 'AAA'),
      city('none', 'AAA', 1e6, null),
      { ...city('unknown', 'AAA'), airport: undefined },
    ]),
  );
  const s = byId(index.score(EQUAL));
  const none = metricOf(s.get('none'), 'travel', 'airportAccess');
  assert.deepEqual(
    [none.status, none.raw, none.pct, none.level],
    ['ok', 0, 0, 'city'],
  );
  assert.equal(metricOf(s.get('near'), 'travel', 'airportAccess').pct, 100);
  assert.deepEqual(
    metricOf(s.get('near'), 'travel', 'airportAccess').detail,
    LARGE_NEAR,
  );
  assert.equal(s.get('unknown').pillars.travel.coverage, 'unavailable');
  assert.equal(
    s.get('unknown').coverage.text,
    '3 of 4 pillars · 0 city-level metrics',
  );
});

test('ranking groups by country, flat mode and filters', () => {
  const countries = {
    AAA: country(9, { continent: 'Europe' }),
    BBB: country(5, { continent: 'Asia' }),
    CCC: country(1, { continent: 'Asia' }),
  };
  const cities = [
    city('a-small', 'AAA', 2e5, { iata: 'X', km: 90, type: 'medium' }),
    city('a-big', 'AAA', 5e6),
    city('a-tie', 'AAA', 5e6),
    city('b1', 'BBB', 3e6),
    city('c1', 'CCC', 8e6),
  ];
  // Value 9 is best on higher-is-better metrics and worst on lower-is-better
  // ones, so QoL orders AAA > BBB > CCC; cost and safety are zero-weighted.
  const index = createCityIntelIndex(pack(countries, cities));
  const scored = index.score({ qol: 1, cost: 0, safety: 0, travel: 1 });
  const flat = index.rank(scored, { groupByCountry: false }).rows;
  const composite = byId(scored);
  for (let i = 1; i < flat.length; i++)
    assert.ok(flat[i - 1].composite >= flat[i].composite);
  // Same composite and population -> id breaks the tie.
  const aTie = flat.findIndex((r) => r.id === 'a-big');
  assert.equal(flat[aTie + 1].id, 'a-tie');
  assert.equal(
    composite.get('a-big').composite,
    composite.get('a-tie').composite,
  );

  const { groups } = index.rank(scored);
  assert.deepEqual(
    groups.map((g) => g.iso3),
    [...new Set(flat.map((r) => r.city.iso3))],
  );
  const aaa = groups.find((g) => g.iso3 === 'AAA');
  assert.deepEqual(
    aaa.cities.map((c) => c.id),
    ['a-big', 'a-tie', 'a-small'],
  );
  assert.equal(aaa.country, 'Country AAA');

  const ids = (opts) =>
    index
      .rank(scored, { groupByCountry: false, ...opts })
      .rows.map((r) => r.id)
      .sort();
  assert.deepEqual(ids({ continent: 'Asia' }), ['b1', 'c1']);
  assert.deepEqual(ids({ minPop: 4e6 }), ['a-big', 'a-tie', 'c1']);
  const advisories = { CCC: { level: 4 }, BBB: { level: 2 } };
  assert.deepEqual(ids({ hideAdvisoryLevelAtLeast: 3, advisories }), [
    'a-big',
    'a-small',
    'a-tie',
    'b1',
  ]);
  assert.equal(
    ids({ hideAdvisoryLevelAtLeast: 3 }).length,
    5,
    'offline advisories hide nothing',
  );
});

test('scoring is deterministic and independent of input order', () => {
  const countries = {};
  const cities = [];
  for (let c = 0; c < 12; c++) {
    countries[`C${c}`] = country((c * 7) % 5, { omit: c % 4 ? [] : ['pm25'] });
    for (let i = 0; i < 4; i++)
      cities.push(
        city(`C${c}-${i}`, `C${c}`, ((c + i) % 3) * 1e5 + 2e5, {
          iata: 'X',
          km: (i * 13) % 60,
          type: i % 2 ? 'medium' : 'large',
        }),
      );
  }
  const weights = { qol: 3, cost: 1, safety: 2, travel: 0.5 };
  const one = createCityIntelIndex(pack(countries, cities));
  const two = createCityIntelIndex(pack(countries, [...cities].reverse()));
  const order = (index) =>
    index
      .rank(index.score(weights), { groupByCountry: false })
      .rows.map((r) => [r.id, r.composite]);
  assert.deepEqual(order(one), order(two));
  assert.deepEqual(one.score(weights), one.score(weights));
  assert.equal(PILLARS.length, 4);
});

test('re-scoring 3000 cities on a weight change is cheap', () => {
  const countries = {};
  const cities = [];
  for (let c = 0; c < 150; c++) {
    countries[`K${c}`] = country((c * 37) % 101);
    for (let i = 0; i < 20; i++)
      cities.push(
        city(`K${c}-${i}`, `K${c}`, 2e5 + i * 1e4, {
          iata: 'X',
          km: (c + i) % 100,
          type: i % 3 ? 'medium' : 'large',
        }),
      );
  }
  const index = createCityIntelIndex(pack(countries, cities));
  index.score(EQUAL);
  const start = performance.now();
  const scored = index.score({ qol: 2, cost: 1, safety: 3, travel: 1 });
  const elapsed = performance.now() - start;
  assert.equal(scored.length, 3000);
  assert.ok(elapsed < 50, `re-score took ${elapsed.toFixed(2)} ms`);
});
