// src/data/cityIntelPack.test.mjs — schema and integrity checks for the
// bundled City Intel data pack (docs/cockpit/SPEC.md §3.1-3.2), built by
// scripts/build-city-intel.mjs. Pure JSON checks, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'local_data/city_intel',
);
const cities = JSON.parse(readFileSync(path.join(DIR, 'cities.json'), 'utf8'));
const countries = JSON.parse(
  readFileSync(path.join(DIR, 'countries.json'), 'utf8'),
);
const seasonality = JSON.parse(
  readFileSync(path.join(DIR, 'seasonality.json'), 'utf8'),
);

test('cities.json: top-level shape', () => {
  assert.equal(cities.version, 1);
  assert.match(cities.generatedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(cities.count, cities.cities.length);
  assert.ok(
    cities.count > 0 && cities.count <= 3000,
    `count ${cities.count} within [1, 3000]`,
  );
});

test('cities.json: every city has the required shape', () => {
  for (const c of cities.cities) {
    assert.equal(typeof c.id, 'string');
    assert.equal(typeof c.name, 'string');
    assert.match(c.iso3, /^[A-Z]{3}$/, `${c.id}: iso3 is a 3-letter code`);
    assert.equal(typeof c.country, 'string');
    assert.ok(
      c.admin1 === null || typeof c.admin1 === 'string',
      `${c.id}: admin1`,
    );
    assert.ok(
      Number.isFinite(c.lat) && c.lat >= -90 && c.lat <= 90,
      `${c.id}: lat`,
    );
    assert.ok(
      Number.isFinite(c.lon) && c.lon >= -180 && c.lon <= 180,
      `${c.id}: lon`,
    );
    assert.ok(
      Number.isInteger(c.pop) && c.pop >= 150000,
      `${c.id}: pop >= 150000`,
    );
    assert.equal(typeof c.capital, 'boolean');
    if (c.airport !== null) {
      assert.match(c.airport.iata, /^[A-Z0-9]{3,4}$/, `${c.id}: airport iata`);
      assert.ok(
        Number.isFinite(c.airport.km) && c.airport.km >= 0,
        `${c.id}: airport km`,
      );
      assert.ok(
        ['large', 'medium'].includes(c.airport.type),
        `${c.id}: airport type`,
      );
    }
  }
});

test('cities.json: ids are unique', () => {
  const ids = cities.cities.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('cities.json: sorted by population desc, then id asc', () => {
  for (let i = 1; i < cities.cities.length; i++) {
    const [prev, cur] = [cities.cities[i - 1], cities.cities[i]];
    assert.ok(
      prev.pop > cur.pop || (prev.pop === cur.pop && prev.id <= cur.id),
      `sort order broken at index ${i}: ${prev.id}(${prev.pop}) -> ${cur.id}(${cur.pop})`,
    );
  }
});

test('countries.json: top-level shape and indicator metadata', () => {
  assert.equal(countries.version, 1);
  assert.match(countries.generatedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof countries.buildYear, 'number');
  assert.equal(countries.maxAgeYears, 10);
  const expectedIndicators = [
    'lifeExpectancy',
    'internetUsers',
    'pm25',
    'priceLevel',
    'homicideRate',
    'politicalStability',
  ];
  assert.deepEqual(
    Object.keys(countries.indicators).sort(),
    expectedIndicators.sort(),
  );
  for (const [key, meta] of Object.entries(countries.indicators)) {
    for (const field of [
      'label',
      'unit',
      'pillar',
      'direction',
      'source',
      'code',
      'url',
      'license',
    ]) {
      assert.ok(field in meta, `indicator ${key} has ${field}`);
    }
    assert.ok(
      ['higher', 'lower'].includes(meta.direction),
      `indicator ${key} direction`,
    );
  }
  assert.equal(countries.indicators.priceLevel.derived, true);
});

test('countries.json: every metric year respects the staleness cutoff', () => {
  const minYear = countries.buildYear - countries.maxAgeYears;
  for (const [iso3, country] of Object.entries(countries.countries)) {
    for (const [key, metric] of Object.entries(country.metrics)) {
      assert.ok(
        metric.y >= minYear,
        `${iso3}.${key}: year ${metric.y} >= ${minYear}`,
      );
      assert.equal(typeof metric.v, 'number', `${iso3}.${key}: numeric value`);
    }
  }
});

test('every city iso3 resolves to a countries.json record', () => {
  for (const c of cities.cities) {
    assert.ok(
      countries.countries[c.iso3],
      `${c.id}: iso3 ${c.iso3} has a country record`,
    );
  }
});

test('seasonality.json: shape, city ids, and 12 months each', () => {
  assert.equal(seasonality.version, 1);
  assert.ok(Object.keys(seasonality.cities).length > 0);
  for (const [id, entry] of Object.entries(seasonality.cities)) {
    assert.ok(
      cities.cities.some((c) => c.id === id),
      `seasonality id ${id} exists in cities.json`,
    );
    assert.ok(
      Number.isFinite(entry.matchedKm) && entry.matchedKm <= 25,
      `${id}: matchedKm <= 25`,
    );
    assert.equal(entry.months.length, 12, `${id}: 12 months`);
    for (const m of entry.months) {
      assert.ok(
        Number.isFinite(m.score) && m.score >= 0 && m.score <= 100,
        `${id}: score`,
      );
      assert.equal(typeof m.tempC, 'number', `${id}: tempC`);
      assert.equal(typeof m.precipMm, 'number', `${id}: precipMm`);
    }
  }
});

test('known cities are present with expected flags', () => {
  const byId = new Map(cities.cities.map((c) => [c.id, c]));
  assert.equal(byId.get('lisbon-prt')?.capital, true);
  assert.ok(byId.has('tokyo-jpn'));
  assert.ok(byId.has('valencia-esp'));
  assert.equal(byId.get('montevideo-ury')?.capital, true);
});

test('pack stays within the 1.5 MB uncompressed size budget', () => {
  const files = [
    'cities.json',
    'countries.json',
    'seasonality.json',
    'source.json',
    'README.md',
  ];
  const totalBytes = files.reduce(
    (sum, name) => sum + statSync(path.join(DIR, name)).size,
    0,
  );
  assert.ok(
    totalBytes < 1.5 * 1024 * 1024,
    `pack is ${(totalBytes / 1024).toFixed(1)} KB, budget 1536 KB`,
  );
});
