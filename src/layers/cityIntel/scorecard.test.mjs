import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPopulation,
  advisoryBadgeText,
  weightChipText,
  pillarCoverageWord,
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
  europeanAqiCategory,
} from './scorecard.js';

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

test('pillarCoverageWord maps the three coverage states', () => {
  assert.equal(pillarCoverageWord('full'), 'FULL');
  assert.equal(pillarCoverageWord('partial'), 'PARTIAL');
  assert.equal(pillarCoverageWord('unavailable'), 'UNAVAILABLE');
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

test('directionTitle: only the known lower-is-better metrics carry the title', () => {
  assert.equal(directionTitle('pm25'), 'Lower raw value is better');
  assert.equal(directionTitle('homicideRate'), 'Lower raw value is better');
  assert.equal(directionTitle('lifeExpectancy'), null);
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
  const monthsOf = ({ start, len }) =>
    Array.from({ length: len }, (_, i) => ((start - 1 + i) % 12) + 1);
  assert.equal(isPlanFull([{ start: 1, len: 6 }], monthsOf), false);
  assert.equal(
    isPlanFull(
      [
        { start: 1, len: 6 },
        { start: 7, len: 6 },
      ],
      monthsOf,
    ),
    true,
  );
  assert.equal(isPlanFull([], monthsOf), false);
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
