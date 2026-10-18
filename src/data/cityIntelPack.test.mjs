// src/data/cityIntelPack.test.mjs — schema and integrity checks for the
// bundled City Intel data pack (docs/cockpit/SPEC.md §3.1-3.2), built by
// scripts/build-city-intel.mjs. Pure JSON checks, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, 'local_data/city_intel');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const cities = readJson(path.join(DIR, 'cities.json'));
const countries = readJson(path.join(DIR, 'countries.json'));
const seasonality = readJson(path.join(DIR, 'seasonality.json'));
const source = readJson(path.join(DIR, 'source.json'));

const FIELDS = [
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
];
// Rows -> objects, the same field order the client decoder expects.
const rows = cities.cities.map((row) =>
  Object.fromEntries(FIELDS.map((f, i) => [f, row[i]])),
);
const byId = new Map(rows.map((c) => [c.id, c]));

test('cities.json: v2 compact rows with the expected field layout', () => {
  assert.equal(cities.version, 2);
  assert.match(cities.generatedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(cities.fields, FIELDS);
  assert.equal(cities.count, cities.cities.length);
  assert.ok(
    cities.count >= 5000 && cities.count <= 15000,
    `count ${cities.count} within [5000, 15000]`,
  );
  for (const row of cities.cities) assert.equal(row.length, FIELDS.length);
});

test('cities.json: every city has the required shape', () => {
  for (const c of rows) {
    assert.equal(typeof c.id, 'string');
    assert.equal(typeof c.name, 'string');
    assert.match(c.iso3, /^[A-Z]{3}$/, `${c.id}: iso3 is a 3-letter code`);
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
    assert.ok(Number.isInteger(c.pop) && c.pop >= 0, `${c.id}: pop`);
    assert.ok(c.capital === 0 || c.capital === 1, `${c.id}: capital flag`);
    if (c.airport !== null) {
      const [iata, km, type] = c.airport;
      assert.match(iata, /^[A-Z0-9]{3,4}$/, `${c.id}: airport iata`);
      assert.ok(Number.isFinite(km) && km >= 0, `${c.id}: airport km`);
      assert.ok(['large', 'medium'].includes(type), `${c.id}: airport type`);
    }
    if (c.housing !== null) {
      const [usd, src, n, rule] = c.housing;
      assert.ok(Number.isInteger(usd) && usd > 0, `${c.id}: housing usd`);
      assert.ok(['insideairbnb', 'model'].includes(src), `${c.id}: src`);
      if (src === 'insideairbnb') {
        assert.ok(Number.isInteger(n) && n >= 15, `${c.id}: listings n`);
        assert.ok(['min28', 'min7'].includes(rule), `${c.id}: rule`);
      }
    }
    assert.ok(
      ['geonames', 'naturalearth', 'manual'].includes(c.origin),
      `${c.id}: origin`,
    );
    assert.ok(
      c.origin === 'geonames' ? Number.isInteger(c.gid) : c.gid === null,
      `${c.id}: GeoNames id iff origin geonames`,
    );
  }
});

test('cities.json: ids and GeoNames ids are unique', () => {
  const ids = rows.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  const gids = rows.filter((c) => c.gid !== null).map((c) => c.gid);
  assert.equal(new Set(gids).size, gids.length);
});

test('cities.json: sorted by population desc, then id asc', () => {
  for (let i = 1; i < rows.length; i++) {
    const [prev, cur] = [rows[i - 1], rows[i]];
    assert.ok(
      prev.pop > cur.pop || (prev.pop === cur.pop && prev.id <= cur.id),
      `sort order broken at index ${i}: ${prev.id}(${prev.pop}) -> ${cur.id}(${cur.pop})`,
    );
  }
});

test('cities.json: every id of the v1 pack (2,480 cities) still resolves', () => {
  // Users hold these ids in localStorage (pins, home city, plan stays).
  const v1Ids = readJson(path.join(HERE, 'fixtures/city-intel-v1-ids.json'));
  assert.equal(v1Ids.length, 2480);
  const missing = v1Ids.filter((id) => !byId.has(id));
  assert.deepEqual(missing, [], 'no v1 id may disappear');
});

test('cities.json: curated lifestyle towns and the manual Canggu record', () => {
  for (const id of ['tulum-mex', 'kotor-mne', 'ubud-idn', 'budva-mne'])
    assert.equal(byId.get(id)?.origin, 'geonames', `${id} from GeoNames`);
  assert.equal(byId.get('canggu-idn')?.origin, 'manual');
});

test('cities.json: housing covers most cities, Inside Airbnb for some', () => {
  const withHousing = rows.filter((c) => c.housing);
  assert.ok(withHousing.length / rows.length >= 0.9, 'housing >= 90%');
  const observed = withHousing.filter((c) => c.housing[1] === 'insideairbnb');
  assert.ok(observed.length >= 50, `${observed.length} Inside Airbnb cities`);
  assert.equal(byId.get('lisbon-prt')?.housing?.[1], 'insideairbnb');
  const model = source.inputs.housingModel;
  assert.ok(Number.isFinite(model.r2) && model.r2 >= 0 && model.r2 <= 1);
  assert.ok(Number.isFinite(model.looMedianAbsPctError));
  assert.equal(model.fittedOn, observed.length);
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
  for (const c of rows) {
    assert.ok(
      countries.countries[c.iso3],
      `${c.id}: iso3 ${c.iso3} has a country record`,
    );
  }
});

test('seasonality.json: v3 grid cells, 12 months each, valid city -> cell map', () => {
  assert.equal(seasonality.version, 3);
  assert.deepEqual(seasonality.cellFields, ['score', 'tempC', 'precipMm']);
  assert.ok(seasonality.cells.length > 0);
  for (const [i, cell] of seasonality.cells.entries()) {
    assert.equal(cell.length, 36, `cell ${i}: 12 months × 3 values`);
    for (let m = 0; m < 12; m++) {
      const [score, tempC, precipMm] = cell.slice(m * 3, m * 3 + 3);
      assert.ok(
        Number.isInteger(score) && score >= 0 && score <= 100,
        `cell ${i}: integer score 0-100`,
      );
      assert.equal(typeof tempC, 'number', `cell ${i}: tempC`);
      assert.ok(Number.isInteger(precipMm), `cell ${i}: precipMm`);
    }
  }
  for (const [id, index] of Object.entries(seasonality.cities)) {
    assert.ok(byId.has(id), `seasonality id ${id} exists in cities.json`);
    assert.ok(seasonality.cells[index], `${id}: cell ${index} exists`);
  }
});

test('seasonality.json: covers at least 95% of pack cities', () => {
  const covered = Object.keys(seasonality.cities).length;
  const ratio = covered / rows.length;
  assert.ok(
    ratio >= 0.95,
    `seasonality covers ${covered}/${rows.length} cities (${(ratio * 100).toFixed(1)}%), need >= 95%`,
  );
});

test('known cities are present with expected flags', () => {
  assert.equal(byId.get('lisbon-prt')?.capital, 1);
  assert.ok(byId.has('tokyo-jpn'));
  assert.ok(byId.has('valencia-esp'));
  assert.equal(byId.get('montevideo-ury')?.capital, 1);
});

test('seasonality.json: known cities present and sane', () => {
  for (const id of [
    'lisbon-prt',
    'chiang-mai-tha',
    'barcelona-esp',
    'medellin-col',
    'tulum-mex',
    'canggu-idn',
  ]) {
    assert.ok(byId.has(id), `${id}: in the pack`);
    assert.ok(id in seasonality.cities, `${id}: has a seasonality cell`);
  }
  const lisbon = seasonality.cells[seasonality.cities['lisbon-prt']];
  const julyTempC = lisbon[6 * 3 + 1];
  assert.ok(
    julyTempC >= 18 && julyTempC <= 26,
    `lisbon-prt July tempC ${julyTempC} in [18,26]`,
  );
});

test('pack stays within the 4.5 MB uncompressed size budget', () => {
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
    totalBytes < 4.5 * 1024 * 1024,
    `pack is ${(totalBytes / 1024).toFixed(1)} KB, budget 4608.0 KB`,
  );
});
