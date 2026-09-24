import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadCityIntelPack,
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
