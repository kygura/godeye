import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPopulation,
  advisoryBadgeText,
  weightChipText,
  formatIndicatorRaw,
  formatAirportDetail,
  formatVisaDetail,
  metricRowModel,
  pillarBlockModel,
  scorecardHeaderModel,
  directionTitle,
  isPlanFull,
  climateStripModel,
  bestInRow,
  compareRowsModel,
  buildCompareTable,
  europeanAqiCategory,
  buildAdvisoryRow,
  loadAirQuality,
  resetAirCacheForTest,
} from './scorecard.js';

function fakeDoc() {
  class FakeEl {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this._text = '';
      this._attrs = {};
      this._listeners = {};
    }
    append(...cs) {
      this.children.push(...cs);
    }
    addEventListener(type, handler) {
      this._listeners[type] = handler;
    }
    click() {
      this._listeners.click?.();
    }
    setAttribute(k, v) {
      this._attrs[k] = v;
    }
    getAttribute(k) {
      return this._attrs[k];
    }
    set textContent(v) {
      this._text = v;
    }
    get textContent() {
      return this._text;
    }
  }
  return { createElement: (tag) => new FakeEl(tag) };
}

const okMetric = (overrides = {}) => ({
  key: 'lifeExpectancy',
  label: 'Life expectancy',
  raw: 82.383,
  unit: 'years',
  year: 2024,
  level: 'country',
  pct: 84.2,
  source: 'World Bank WDI',
  derived: false,
  status: 'ok',
  detail: null,
  ...overrides,
});

test('formatPopulation: millions, thousands, small counts, missing', () => {
  assert.equal(formatPopulation(2_900_000), '2.9 M');
  assert.equal(formatPopulation(640_000), '640 k');
  assert.equal(formatPopulation(820), '820');
  assert.equal(formatPopulation(null), '—');
});

test('advisoryBadgeText formats known levels and falls back to an em dash', () => {
  assert.equal(advisoryBadgeText(1), 'L1');
  assert.equal(advisoryBadgeText(4), 'L4');
  assert.equal(advisoryBadgeText(null), '—');
});

test('weightChipText: "wN" or "off"', () => {
  assert.equal(weightChipText(5), 'w5');
  assert.equal(weightChipText(0), 'off');
});

test('formatIndicatorRaw applies the unit-specific format', () => {
  assert.equal(formatIndicatorRaw(82.383, 'years'), '82.4 yr');
  assert.equal(formatIndicatorRaw(87.2, '% of population'), '87 %');
  assert.equal(formatIndicatorRaw(0.649, '× US'), '0.65 × US');
  assert.equal(formatIndicatorRaw(8.6, 'µg/m³'), '8.6 µg/m³');
  assert.equal(formatIndicatorRaw(0.72, 'per 100k'), '0.7 per 100k');
  assert.equal(formatIndicatorRaw(null, 'years'), '—');
});

test('formatAirportDetail: known airport vs. the DESIGN-uncovered "none nearby" fact', () => {
  assert.equal(
    formatAirportDetail({ iata: 'LIS', type: 'large', km: 7.2 }),
    'LIS · large · 7 km',
  );
  assert.equal(formatAirportDetail(null), 'None within 100 km');
});

test('formatVisaDetail: numeric days, own-country, and category strings', () => {
  assert.equal(formatVisaDetail(90), '90 days visa-free');
  assert.equal(formatVisaDetail('-1'), 'home country');
  assert.equal(formatVisaDetail('visa required'), 'Visa required');
  assert.equal(formatVisaDetail(null), null);
});

test('metricRowModel: ok metric renders value/percentile/bar/source/level', () => {
  const row = metricRowModel(okMetric());
  assert.equal(row.valueText, '82.4 yr');
  assert.equal(row.pctText, 'P84');
  assert.equal(row.barPct, 84.2);
  assert.equal(row.yearSourceText, '2024 · World Bank WDI');
  assert.equal(row.levelBadge, 'COUNTRY');
  assert.equal(row.isPassportLink, false);
});

test('metricRowModel: derived metric appends " · derived" and carries a title', () => {
  const row = metricRowModel(
    okMetric({ key: 'priceLevel', raw: 0.649, unit: '× US', derived: true }),
  );
  assert.match(row.yearSourceText, / · derived$/);
  assert.match(row.derivedTitle, /PA\.NUS\.PRVT\.PP/);
});

test('metricRowModel: city-level housing and climate carry value, source and CITY badge', () => {
  const observed = metricRowModel(
    okMetric({
      key: 'housing',
      label: 'Housing',
      raw: 2499,
      unit: 'USD / month',
      year: null,
      level: 'city',
      source: 'Inside Airbnb median · entire homes · 28+ nights',
      detail: { usd: 2499, src: 'insideairbnb', n: 3331, rule: 'min28' },
    }),
  );
  assert.equal(observed.valueText, '$2,499 / mo');
  assert.equal(
    observed.yearSourceText,
    '— · Inside Airbnb median · entire homes · 28+ nights',
  );
  assert.equal(observed.levelBadge, 'CITY');
  assert.equal(observed.derivedTitle, null);

  const modelled = metricRowModel(
    okMetric({
      key: 'housing',
      raw: 1355,
      unit: 'USD / month',
      year: null,
      level: 'city',
      source: 'Estimate · country price level + city size',
      derived: true,
      detail: { usd: 1355, src: 'model' },
    }),
  );
  assert.match(
    modelled.yearSourceText,
    /Estimate · country price level \+ city size · derived$/,
  );
  assert.match(modelled.derivedTitle, /Inside Airbnb/);

  const climate = metricRowModel(
    okMetric({
      key: 'climate',
      raw: 73.4,
      unit: 'comfort 0-100',
      derived: true,
    }),
  );
  assert.equal(climate.valueText, '73 / 100');
  assert.match(climate.derivedTitle, /12 monthly comfort/);
  assert.equal(directionTitle('housing', {}), 'Lower raw value is better');
  assert.equal(directionTitle('climate', {}), null);
});

test('compareRowsModel: housing cell names its origin inline and in the title', () => {
  const housing = (usd, src) =>
    okMetric({
      key: 'housing',
      label: 'Housing',
      raw: usd,
      unit: 'USD / month',
      level: 'city',
      pct: 50,
      source:
        src === 'model'
          ? 'Estimate · country price level + city size'
          : 'Inside Airbnb median · entire homes · 28+ nights',
      detail: { usd, src },
    });
  const scored = (id, metric) => ({
    id,
    city: { id, name: id, iso3: 'PRT', country: 'Portugal' },
    composite: 60,
    pillars: {
      qol: { score: 50, metrics: [] },
      cost: { score: 50, metrics: [metric] },
      safety: { score: 50, metrics: [] },
      travel: { score: 50, metrics: [] },
    },
  });
  const rows = compareRowsModel([
    scored('a', housing(3729, 'insideairbnb')),
    scored('b', housing(1500, 'model')),
  ]);
  const row = rows.find((r) => r.label === 'Housing');
  assert.equal(row.cells[0].rawText, '$3,729 / mo · Inside Airbnb');
  assert.equal(row.cells[1].rawText, '$1,500 / mo · est.');
  assert.equal(
    row.cells[1].sourceTitle,
    'Estimate · country price level + city size',
  );
});

test('metricRowModel: missing/stale -> unavailable + pack-age copy', () => {
  const row = metricRowModel(
    okMetric({ status: 'missing', pct: null, raw: undefined }),
  );
  assert.equal(row.valueText, 'unavailable');
  assert.equal(row.yearSourceText, 'no data within 10 years · World Bank WDI');
  assert.equal(row.pctText, '—');
});

test('metricRowModel: no-passport special value is a link with its own copy', () => {
  const row = metricRowModel(
    okMetric({ key: 'visaAccess', status: 'no-passport' }),
  );
  assert.equal(row.valueText, 'Set your passport');
  assert.equal(row.isPassportLink, true);
  assert.equal(row.yearSourceText, 'counts once a passport is set');
});

test('metricRowModel: airportAccess formats from detail, including the "none nearby" fact', () => {
  const withAirport = metricRowModel(
    okMetric({
      key: 'airportAccess',
      detail: { iata: 'LIS', type: 'large', km: 7 },
      raw: 91,
    }),
  );
  assert.equal(withAirport.valueText, 'LIS · large · 7 km');
  const noAirport = metricRowModel(
    okMetric({ key: 'airportAccess', detail: null, raw: 0 }),
  );
  assert.equal(noAirport.valueText, 'None within 100 km');
});

test('metricRowModel: null metric is null (pillar simply has fewer rows)', () => {
  assert.equal(metricRowModel(null), null);
  assert.equal(metricRowModel(undefined), null);
});

test('directionTitle: only indicators whose pack direction is "lower" carry the title', () => {
  const indicators = {
    pm25: { direction: 'lower' },
    homicideRate: { direction: 'lower' },
    lifeExpectancy: { direction: 'higher' },
  };
  assert.equal(directionTitle('pm25', indicators), 'Lower raw value is better');
  assert.equal(
    directionTitle('homicideRate', indicators),
    'Lower raw value is better',
  );
  assert.equal(directionTitle('lifeExpectancy', indicators), null);
  assert.equal(
    directionTitle('airportAccess', indicators),
    null,
    'a key missing from the indicators pack is not lower-is-better',
  );
  assert.equal(directionTitle('pm25', undefined), null, 'no pack yet');
});

test('pillarBlockModel builds the header numbers and per-metric rows', () => {
  const pillar = {
    score: 71.4,
    coverage: 'full',
    metrics: [okMetric(), okMetric({ key: 'internetUsers', pct: 71 })],
  };
  const model = pillarBlockModel('qol', pillar, 5);
  assert.equal(model.label, 'Quality of life');
  assert.equal(model.scoreText, '71');
  assert.equal(model.coverageWord, 'FULL');
  assert.equal(model.weightChip, 'w5');
  assert.equal(model.metrics.length, 2);
});

test('scorecardHeaderModel: eligible city shows its rank and advisory badge', () => {
  const scored = {
    city: {
      name: 'Lisbon',
      country: 'Portugal',
      admin1: 'Lisboa',
      pop: 2_900_000,
    },
    composite: 74.4,
    coverage: {
      pillarsAvailable: 3,
      cityLevelMetrics: 1,
      text: '3 of 4 pillars · 1 city-level metric',
    },
    eligible: true,
    reason: null,
  };
  const model = scorecardHeaderModel(scored, 1, 412, 1);
  assert.equal(model.metaText, 'Portugal · Lisboa · 2.9 M · rank 1 of 412');
  assert.equal(model.compositeText, '74');
  assert.equal(model.coverageText, '3 of 4 pillars · 1 city-level metric · L1');
  assert.equal(model.bannerText, null);
});

test('scorecardHeaderModel: ineligible city gets the "not ranked" reason banner', () => {
  const base = {
    city: { name: 'X', country: 'Y', admin1: null, pop: 100 },
    composite: null,
    coverage: {
      pillarsAvailable: 2,
      cityLevelMetrics: 0,
      text: '2 of 4 pillars',
    },
    eligible: false,
  };
  assert.equal(
    scorecardHeaderModel({ ...base, reason: 'safety-unavailable' }, null, 10)
      .bannerText,
    'Not ranked: Safety unavailable.',
  );
  assert.equal(
    scorecardHeaderModel({ ...base, reason: 'insufficient-pillars' }, null, 10)
      .bannerText,
    'Not ranked: only 2 of 4 pillars available.',
  );
});

test('isPlanFull: full once every month is covered', () => {
  assert.equal(isPlanFull([{ start: 1, len: 6 }]), false);
  assert.equal(
    isPlanFull([
      { start: 1, len: 6 },
      { start: 7, len: 6 },
    ]),
    true,
  );
  assert.equal(isPlanFull([]), false);
});

test('climateStripModel: 12 cells tinted by score, plus the best window text', () => {
  const months = Array.from({ length: 12 }, (_, i) => ({
    score: i < 4 ? 20 : 90,
  }));
  const model = climateStripModel({ months });
  assert.equal(model.cells.length, 12);
  assert.equal(model.cells[0].initial, 'J');
  assert.match(model.bestSpanText, /^Best /);
});

test('climateStripModel: absent seasonality row -> null (no placeholder)', () => {
  assert.equal(climateStripModel(undefined), null);
  assert.equal(climateStripModel({ months: [] }), null);
});

test('bestInRow: ties share the mark, direction is pre-applied, <2 values marks nothing', () => {
  assert.deepEqual(bestInRow([50, 80, 80]), new Set([1, 2]));
  assert.deepEqual(bestInRow([80]), new Set());
  assert.deepEqual(bestInRow([null, 50]), new Set());
  assert.deepEqual(bestInRow([]), new Set());
});

function scoredCity(id, overrides = {}) {
  return {
    id,
    city: { name: id, country: 'C', iso3: 'USA', lat: 0, lon: 0, pop: 1 },
    composite: 50,
    eligible: true,
    reason: null,
    coverage: {
      pillarsAvailable: 4,
      cityLevelMetrics: 1,
      text: '4 of 4 pillars',
    },
    pillars: {
      qol: { score: 50, coverage: 'full', metrics: [okMetric()] },
      cost: {
        score: 50,
        coverage: 'full',
        metrics: [okMetric({ key: 'priceLevel' })],
      },
      safety: {
        score: 50,
        coverage: 'full',
        metrics: [okMetric({ key: 'homicideRate' })],
      },
      travel: {
        score: 50,
        coverage: 'full',
        metrics: [okMetric({ key: 'airportAccess', detail: null, raw: 0 })],
      },
    },
    ...overrides,
  };
}

test('europeanAqiCategory: Open-Meteo European AQI index -> its category label', () => {
  assert.equal(europeanAqiCategory(10), 'Good');
  assert.equal(europeanAqiCategory(20), 'Good');
  assert.equal(europeanAqiCategory(21), 'Fair');
  assert.equal(europeanAqiCategory(100), 'Very Poor');
  assert.equal(europeanAqiCategory(150), 'Extremely Poor');
  assert.equal(europeanAqiCategory(null), null);
});

test('buildAdvisoryRow: only links out over a verified http(s) URL, else renders plain text', () => {
  const doc = fakeDoc();
  const scored = { city: { iso3: 'PRT' } };
  const record = {
    title: 'Exercise Normal Precautions',
    updated: '2025-01-15T00:00:00Z',
    url: 'https://travel.state.gov/x',
  };

  const safe = buildAdvisoryRow(doc, scored, { PRT: record }, false);
  const link = safe.children[1];
  assert.equal(link.tagName, 'a');
  assert.equal(link.href, 'https://travel.state.gov/x');
  assert.match(link.textContent, /Exercise Normal Precautions/);

  const badProtocol = buildAdvisoryRow(
    doc,
    scored,
    { PRT: { ...record, url: 'javascript:alert(1)' } },
    false,
  );
  const plain = badProtocol.children[1];
  assert.equal(plain.tagName, 'div');
  assert.equal(plain.href, undefined);
  assert.match(plain.textContent, /Exercise Normal Precautions/);

  const missingUrl = buildAdvisoryRow(
    doc,
    scored,
    { PRT: { ...record, url: '' } },
    false,
  );
  assert.equal(missingUrl.children[1].tagName, 'div');

  const malformedUrl = buildAdvisoryRow(
    doc,
    scored,
    { PRT: { ...record, url: 'not a url' } },
    false,
  );
  assert.equal(malformedUrl.children[1].tagName, 'div');
});

test('compareRowsModel: composite/pillar/metric rows with best-in-row marks, advisory/rent last', () => {
  const a = scoredCity('a', { composite: 74 });
  const b = scoredCity('b', { composite: 60 });
  const rows = compareRowsModel([a, b], {
    advisoriesByIso3: {},
    rentByCity: new Map(),
  });
  assert.equal(rows[0].type, 'composite');
  assert.deepEqual(rows[0].best, new Set([0]));
  assert.equal(rows.at(-2).type, 'advisory');
  assert.equal(rows.at(-1).type, 'rent');
});

test('buildCompareTable: each city header gets a "+ PLAN" button wired to ctx.onAddToPlan', () => {
  const doc = fakeDoc();
  const a = scoredCity('a', { composite: 74 });
  const b = scoredCity('b', { composite: 60 });
  const added = [];
  const root = buildCompareTable(doc, [a, b], {
    advisoriesByIso3: {},
    rentByCity: new Map(),
    onUnpin: () => {},
    onClearPins: () => {},
    onClose: () => {},
    onAddToPlan: (id) => added.push(id),
  });
  const table = root.children[1];
  const headRow = table.children[1].children[0];
  const [, thA, thB] = headRow.children;
  const addBtnA = thA.children[2];
  assert.equal(addBtnA.textContent, '+ PLAN');
  assert.equal(addBtnA.getAttribute('aria-label'), 'Add a to plan');
  addBtnA.click();
  thB.children[2].click();
  assert.deepEqual(added, ['a', 'b']);
});

test('loadAirQuality: dedupes concurrent calls and caches within the TTL', async () => {
  resetAirCacheForTest();
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: { pm25: 8, europeanAqi: 15 },
        fetchedAt: Date.now(),
      }),
    };
  };
  try {
    const city = { id: 'lisbon-prt', lat: 38.72, lon: -9.14 };
    const [r1, r2] = await Promise.all([
      loadAirQuality(city),
      loadAirQuality(city),
    ]);
    assert.equal(
      calls,
      1,
      'concurrent calls for the same city share one fetch',
    );
    assert.deepEqual(r1, r2);
    await loadAirQuality(city);
    assert.equal(
      calls,
      1,
      'a cached result within the TTL is reused, not refetched',
    );
    await loadAirQuality({ id: 'valencia-esp', lat: 39.47, lon: -0.38 });
    assert.equal(calls, 2, 'a different city is fetched separately');
  } finally {
    globalThis.fetch = original;
  }
});
