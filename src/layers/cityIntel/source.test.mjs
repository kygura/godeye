import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadCityIntelPack,
  decodeCities,
  decodeSeasonality,
  fetchAdvisories,
  fetchVisa,
  fetchRent,
  fetchAir,
  matchRentToCities,
} from './source.js';

test('loadCityIntelPack loads and caches the bundled cities/countries/seasonality', async () => {
  const pack = await loadCityIntelPack();
  assert.ok(Array.isArray(pack.cities));
  assert.ok(pack.cities.length > 1000);
  assert.ok(pack.countries?.countries?.USA);
  assert.ok(pack.seasonality?.cities);
  const again = await loadCityIntelPack();
  assert.equal(again, pack, 'the pack is memoized, not re-parsed');
});

test('loadCityIntelPack decodes rows and grid cells into plain objects', async () => {
  const pack = await loadCityIntelPack();
  const byId = new Map(pack.cities.map((c) => [c.id, c]));
  const lisbon = byId.get('lisbon-prt');
  assert.equal(lisbon.country, pack.countries.countries.PRT.name);
  assert.equal(lisbon.capital, true);
  assert.equal(lisbon.airport.iata, 'LIS');
  assert.equal(lisbon.housing.src, 'insideairbnb');
  assert.ok(lisbon.housing.usd > 0 && lisbon.housing.n > 0);
  assert.equal(byId.get('canggu-idn')?.origin, 'manual');
  const months = pack.seasonality.cities['lisbon-prt'].months;
  assert.equal(months.length, 12);
  assert.deepEqual(Object.keys(months[0]), ['score', 'tempC', 'precipMm']);
});

test('decodeCities / decodeSeasonality map the compact encodings', () => {
  const countries = { countries: { PRT: { name: 'Portugal' } } };
  const raw = {
    fields: [
      'id',
      'name',
      'iso3',
      'admin1',
      'lat',
      'lon',
      'pop',
      'capital',
      'airport',
      'housing',
      'origin',
      'gid',
    ],
    cities: [
      [
        'a-prt',
        'A',
        'PRT',
        null,
        1,
        2,
        5,
        1,
        ['LIS', 3.5, 'large'],
        [900, 'model'],
        'geonames',
        123,
      ],
      [
        'b-xxx',
        'B',
        'XXX',
        'R',
        3,
        4,
        0,
        0,
        null,
        [1200, 'insideairbnb', 40, 'min7'],
        'manual',
        null,
      ],
    ],
  };
  const [a, b] = decodeCities(raw, countries);
  assert.deepEqual(a, {
    id: 'a-prt',
    name: 'A',
    iso3: 'PRT',
    country: 'Portugal',
    admin1: null,
    lat: 1,
    lon: 2,
    pop: 5,
    capital: true,
    airport: { iata: 'LIS', km: 3.5, type: 'large' },
    housing: { usd: 900, src: 'model' },
    origin: 'geonames',
  });
  assert.equal(b.country, 'XXX', 'unknown iso3 falls back to the code');
  assert.equal(b.airport, null);
  assert.deepEqual(b.housing, {
    usd: 1200,
    src: 'insideairbnb',
    n: 40,
    rule: 'min7',
  });
  assert.throws(() => decodeCities({ ...raw, fields: ['id'] }, countries));

  const cell = Array.from({ length: 12 }, (_, m) => [
    m,
    m + 0.5,
    m * 10,
  ]).flat();
  const v3 = {
    version: 3,
    cellFields: ['score', 'tempC', 'precipMm'],
    cells: [cell],
    cities: { x: 0, y: 0, z: 7 },
  };
  const season = decodeSeasonality(v3);
  assert.equal(season.version, 3);
  assert.deepEqual(season.cities.x.months[2], {
    score: 2,
    tempC: 2.5,
    precipMm: 20,
  });
  assert.equal(
    season.cities.x.months,
    season.cities.y.months,
    'shared per cell',
  );
  assert.equal(season.cities.z, undefined, 'dangling cell index dropped');
});

test('decodeSeasonality rejects an unexpected version, field list or stride', () => {
  const cell = new Array(36).fill(1);
  const ok = {
    version: 3,
    cellFields: ['score', 'tempC', 'precipMm'],
    cells: [cell],
    cities: { x: 0 },
  };
  assert.doesNotThrow(() => decodeSeasonality(ok));
  for (const bad of [
    { ...ok, version: 2 },
    { ...ok, cellFields: ['score', 'tempC'] },
    { ...ok, cells: [cell.slice(0, 24)] },
    { ...ok, cells: undefined },
    null,
  ])
    assert.throws(() => decodeSeasonality(bad), /unexpected v3 cell layout/);
});

function withStubbedFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test('the live client passes through the server envelope on success', () =>
  withStubbedFetch(
    async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: { url: String(url) },
        fetchedAt: 1,
        stale: false,
        source: { name: 'Test' },
      }),
    }),
    async () => {
      const result = await fetchAdvisories();
      assert.equal(result.ok, true);
      assert.match(result.data.url, /\/api\/city-intel\/advisories$/);
    },
  ));

test('the live client passes through the server error envelope on a non-2xx response', () =>
  withStubbedFetch(
    async () => ({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: 'invalid-passport' }),
    }),
    async () => {
      const result = await fetchVisa('ZZZ');
      assert.deepEqual(result, { ok: false, error: 'invalid-passport' });
    },
  ));

test('the live client never throws: a network failure resolves ok:false', () =>
  withStubbedFetch(
    async () => {
      throw new Error('boom');
    },
    async () => {
      const result = await fetchRent();
      assert.deepEqual(result, { ok: false, error: 'boom' });
    },
  ));

test('the live client never throws: an aborted request resolves ok:false', () =>
  withStubbedFetch(
    async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    },
    async () => {
      const result = await fetchAir(1, 2);
      assert.deepEqual(result, { ok: false, error: 'aborted' });
    },
  ));

test('the live client rejects a response body with no recognizable envelope', () =>
  withStubbedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({}) }),
    async () => {
      const result = await fetchAdvisories();
      assert.equal(result.ok, false);
      assert.match(result.error, /HTTP 200/);
    },
  ));

const PACK_CITIES = [
  {
    id: 'new-york-usa',
    iso3: 'USA',
    name: 'New York',
    admin1: 'New York',
    pop: 19_040_000,
  },
  {
    id: 'jersey-city-usa',
    iso3: 'USA',
    name: 'New York',
    admin1: 'New York',
    pop: 300_000,
  },
  {
    id: 'austin-usa',
    iso3: 'USA',
    name: 'Austin',
    admin1: 'Texas',
    pop: 1_000_000,
  },
  {
    id: 'toronto-can',
    iso3: 'CAN',
    name: 'Toronto',
    admin1: 'Ontario',
    pop: 6_000_000,
  },
];

test('matchRentToCities matches US metros to pack cities by principal + state', () => {
  const rentData = {
    metros: [
      {
        principal: 'Austin',
        state: 'TX',
        zori: 1800,
        month: '2026-07',
        name: 'Austin, TX',
      },
      {
        principal: 'Toronto',
        state: 'ON',
        zori: 2200,
        month: '2026-07',
        name: 'Toronto, ON',
      },
    ],
  };
  const matched = matchRentToCities(rentData, PACK_CITIES);
  assert.deepEqual(matched.get('austin-usa'), {
    zori: 1800,
    month: '2026-07',
    metro: 'Austin, TX',
  });
  assert.equal(matched.has('toronto-can'), false, 'non-US metros are ignored');
  assert.equal(matched.size, 1);
});

test('matchRentToCities picks the largest-population city on a name clash', () => {
  const rentData = {
    metros: [
      {
        principal: 'New York',
        state: 'NY',
        zori: 3400,
        month: '2026-07',
        name: 'New York, NY',
      },
    ],
  };
  const matched = matchRentToCities(rentData, PACK_CITIES);
  assert.equal(matched.has('new-york-usa'), true);
  assert.equal(matched.has('jersey-city-usa'), false);
});

test('matchRentToCities tolerates malformed input without throwing', () => {
  assert.equal(matchRentToCities(null, PACK_CITIES).size, 0);
  assert.equal(matchRentToCities({ metros: [] }, null).size, 0);
  assert.equal(
    matchRentToCities(
      { metros: [{ principal: 'X', state: 'ZZ' }] },
      PACK_CITIES,
    ).size,
    0,
    'an unknown state abbreviation is ignored',
  );
});
