import test from 'node:test';
import assert from 'node:assert/strict';
import { binForScore } from './index.js';
import {
  gapRuns,
  heatmapModel,
  costCopy,
  visaCopy,
  rollupCopy,
  createPlanView,
} from './planView.js';

// ---------------------------------------------------------------------------
// gapRuns
// ---------------------------------------------------------------------------

test('gapRuns: normal runs, wrap through December, empty and full year', () => {
  assert.deepEqual(gapRuns([]), []);
  assert.deepEqual(gapRuns([3, 4, 9, 10]), ['MAR–APR', 'SEP–OCT']);
  assert.deepEqual(gapRuns([12, 1]), ['DEC–JAN']);
  assert.deepEqual(gapRuns([11, 12, 1, 2]), ['NOV–FEB']);
  assert.deepEqual(gapRuns([6]), ['JUN']);
  assert.deepEqual(gapRuns([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), [
    'JAN–DEC',
  ]);
});

// ---------------------------------------------------------------------------
// heatmapModel
// ---------------------------------------------------------------------------

const citiesById = new Map([
  [
    'lisbon-prt',
    {
      id: 'lisbon-prt',
      name: 'Lisbon',
      iso3: 'PRT',
      country: 'Portugal',
      lat: 38.72,
      lon: -9.14,
      airport: { iata: 'LIS' },
    },
  ],
  [
    'valencia-esp',
    {
      id: 'valencia-esp',
      name: 'Valencia',
      iso3: 'ESP',
      country: 'Spain',
      lat: 39.47,
      lon: -0.38,
      airport: { iata: 'VLC' },
    },
  ],
  [
    'nowhere-xxx',
    {
      id: 'nowhere-xxx',
      name: 'Nowhere',
      iso3: 'XXX',
      country: 'Nowhereland',
      lat: 0,
      lon: 0,
      airport: null,
    },
  ],
]);

const seasonality = {
  cities: {
    'lisbon-prt': {
      months: Array.from({ length: 12 }, (_, i) => ({ score: 60 + i })),
    },
    'valencia-esp': {
      months: Array.from({ length: 12 }, (_, i) =>
        i === 5 ? {} : { score: 40 + i },
      ), // June (index 5) deliberately missing a score
    },
    // 'nowhere-xxx' has no seasonality row at all.
  },
};

test('heatmapModel: chosen months, plan-wide gap columns, missing cells', () => {
  const stays = [
    { id: 's1', cityId: 'lisbon-prt', name: 'Lisbon', start: 1, len: 3 }, // JAN-MAR
    { id: 's2', cityId: 'valencia-esp', name: 'Valencia', start: 7, len: 2 }, // JUL-AUG
  ];
  const model = heatmapModel(stays, seasonality, citiesById);

  assert.equal(model.rows.length, 2);
  assert.equal(model.truncated, false);
  assert.deepEqual(model.gapMonths, [4, 5, 6, 9, 10, 11, 12]);

  const lisbonRow = model.rows.find((r) => r.cityId === 'lisbon-prt');
  assert.equal(lisbonRow.name, 'Lisbon');
  assert.equal(lisbonRow.iata, 'LIS');
  // Chosen: Lisbon's own JAN-MAR months.
  assert.equal(lisbonRow.cells[0].chosen, true); // JAN
  assert.equal(lisbonRow.cells[2].chosen, true); // MAR
  assert.equal(lisbonRow.cells[3].chosen, false); // APR, not booked for Lisbon
  // Gap column: April is a plan-wide gap, marked on every row.
  assert.equal(lisbonRow.cells[3].gap, true);
  assert.equal(lisbonRow.cells[0].gap, false);
  // Comfort tint reuses the same 5-bin ramp as the ranking list.
  assert.equal(lisbonRow.cells[0].bin, binForScore(60));
  assert.equal(lisbonRow.cells[0].missing, false);

  const valenciaRow = model.rows.find((r) => r.cityId === 'valencia-esp');
  // June (index 5) has no score in the fixture: hatched/neutral cell.
  const june = valenciaRow.cells[5];
  assert.equal(june.missing, true);
  assert.equal(june.bin, null);
  assert.match(june.title, /no climate data/);

  assert.match(model.ariaLabel, /^Year: /);
  assert.match(model.ariaLabel, /5 of 12 months covered\.$/);
});

test('heatmapModel: a city with no seasonality row is entirely missing/neutral', () => {
  const stays = [
    { id: 's1', cityId: 'nowhere-xxx', name: 'Nowhere', start: 1, len: 12 },
  ];
  const model = heatmapModel(stays, seasonality, citiesById);
  assert.equal(
    model.rows[0].cells.every((c) => c.missing),
    true,
  );
  assert.deepEqual(model.gapMonths, []);
});

test('heatmapModel: caps rows at 6 unique cities and flags truncation', () => {
  const stays = Array.from({ length: 7 }, (_, i) => ({
    id: `s${i}`,
    cityId: `city-${i}`,
    name: `City ${i}`,
    start: (i % 12) + 1,
    len: 1,
  }));
  const model = heatmapModel(stays, { cities: {} }, new Map());
  assert.equal(model.rows.length, 6);
  assert.equal(model.truncated, true);
});

// ---------------------------------------------------------------------------
// costCopy
// ---------------------------------------------------------------------------

test("costCopy: no-home and unavailable pass plan.js's own label through", () => {
  assert.equal(
    costCopy({ basis: 'no-home', label: 'set home to compare costs' }).text,
    'set home to compare costs',
  );
  assert.equal(
    costCopy({
      basis: 'unavailable',
      label: 'cost data unavailable for this country',
    }).text,
    'cost data unavailable for this country',
  );
});

test("costCopy: ratio-only prefixes the ratio onto plan.js's label", () => {
  const copy = costCopy({
    basis: 'ratio-only',
    ratio: 0.62,
    label: 'set monthly spend for a dollar estimate',
  });
  assert.equal(
    copy.text,
    '×0.62 home · set monthly spend for a dollar estimate',
  );
});

test('costCopy: estimate formats the dollar figure and years, rent info never summed in', () => {
  const copy = costCopy({
    basis: 'estimate',
    ratio: 0.62,
    estimateUsd: 1850,
    ratioYears: { stay: 2023, home: 2023 },
    rentInfo: { zori: 2900, month: '2025-08', metro: 'Somewhere' },
  });
  assert.equal(copy.text, '×0.62 home · ≈ $1,850/mo est.');
  assert.doesNotMatch(copy.text, /2,900|2900/);
  assert.doesNotMatch(copy.title, /2,900|2900/);

  const differingYears = costCopy({
    basis: 'estimate',
    ratio: 0.7,
    estimateUsd: 2100,
    ratioYears: { stay: 2024, home: 2022 },
  });
  assert.match(differingYears.title, /World Bank 2024/);
  assert.match(differingYears.title, /home country year 2022/);
});

test('costCopy: override shows "your figure", omitting the ratio prefix with no home set', () => {
  assert.equal(
    costCopy({ basis: 'override', ratio: 0.62, override: 2000 }).text,
    '×0.62 home · $2,000/mo · your figure',
  );
  assert.equal(
    costCopy({ basis: 'override', ratio: null, override: 2000 }).text,
    '$2,000/mo · your figure',
  );
});

// ---------------------------------------------------------------------------
// visaCopy
// ---------------------------------------------------------------------------

test("visaCopy: every status from plan.js's stayVisa", () => {
  assert.equal(
    visaCopy({ status: 'ok', allowanceDays: 90 }),
    'ok · 90 days visa-free',
  );
  assert.equal(
    visaCopy({ status: 'ok', allowanceDays: null }),
    'ok · no visa needed',
  );
  assert.equal(
    visaCopy({ status: 'exceeds', allowanceDays: 90 }),
    'stay exceeds visa-free days (90)',
  );
  assert.equal(visaCopy({ status: 'no-passport' }), 'set your passport');
  assert.equal(
    visaCopy({ status: 'unknown', requirement: 'E-Visa' }),
    'e-visa · days not known',
  );
  assert.equal(
    visaCopy({ status: 'unknown', requirement: null }),
    'no visa data for this destination',
  );
  assert.equal(visaCopy({ status: 'offline' }), 'unavailable (source offline)');
  assert.equal(
    visaCopy({ status: 'schengen', allowanceDays: 90 }),
    'Schengen · 90/180 checked across stays',
  );
});

// ---------------------------------------------------------------------------
// rollupCopy
// ---------------------------------------------------------------------------

test('rollupCopy: partial year (gaps, no dollar figure)', () => {
  const copy = rollupCopy({
    monthsCovered: 7,
    gaps: [4, 5, 9, 10, 11],
    fitMean: 75.4,
    annualCost: {
      usd: null,
      coveredMonths: 7,
      complete: false,
      label: 'partial, 7/12 months',
    },
    comfortMean: 61.2,
    maxAdvisory: 1,
    moves: 1,
    km: 1543,
  });
  assert.equal(copy.monthsCovered, '7/12 · gaps APR–MAY, SEP–NOV');
  assert.equal(copy.fitWeighted, '75');
  assert.equal(copy.annualCost, 'partial, 7/12 months');
  assert.equal(copy.comfortWeighted, '61 · FAIR');
  assert.equal(copy.highestAdvisory, 'L1');
  assert.equal(copy.moves, '1 · 1,543 km · open (loop closes at 12/12)');
});

test('rollupCopy: complete year (no gaps, closed loop, dollar figure)', () => {
  const copy = rollupCopy(
    {
      monthsCovered: 12,
      gaps: [],
      fitMean: 73,
      annualCost: { usd: 27600, coveredMonths: 12, complete: true },
      comfortMean: 70,
      maxAdvisory: 2,
      moves: 2,
      km: 6840,
    },
    { hasOverride: true },
  );
  assert.equal(copy.monthsCovered, '12/12 · no gaps');
  assert.equal(copy.annualCost, '≈ $27,600 / yr est. · includes your figures');
  assert.equal(copy.moves, '2 · 6,840 km · loop closed');
});

test('rollupCopy: zero priced months and a single stay (no moves)', () => {
  const zero = rollupCopy(
    {
      monthsCovered: 4,
      gaps: [5, 6, 7, 8, 9, 10, 11, 12],
      fitMean: null,
      annualCost: { usd: null, coveredMonths: 0, complete: false },
      comfortMean: null,
      maxAdvisory: null,
      moves: 0,
      km: 0,
    },
    { zeroPricedReason: 'set home and monthly spend' },
  );
  assert.equal(zero.annualCost, 'set home and monthly spend');
  assert.equal(zero.fitWeighted, '—');
  assert.equal(zero.comfortWeighted, '—');
  assert.equal(zero.highestAdvisory, '—');
  assert.equal(zero.moves, '0 · 0 km');
});

// ---------------------------------------------------------------------------
// createPlanView: addStay / replacePlan / getSummary against a fake store
// ---------------------------------------------------------------------------

function fakeDoc() {
  class FakeEl {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this._text = '';
      this.className = '';
      this.hidden = false;
      this.disabled = false;
      this.selected = false;
      this.value = '';
      this.type = '';
      this.id = '';
      this.title = '';
      this._attrs = {};
    }
    appendChild(c) {
      this.children.push(c);
      return c;
    }
    append(...cs) {
      for (const c of cs) this.appendChild(c);
    }
    setAttribute(k, v) {
      this._attrs[k] = v;
    }
    getAttribute(k) {
      return this._attrs[k];
    }
    addEventListener() {}
    set textContent(v) {
      this._text = v;
      this.children = [];
    }
    get textContent() {
      return this._text;
    }
  }
  return {
    createElement: (tag) => new FakeEl(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    getElementById: () => null,
  };
}

// A fresh session has no plan trip at all until `ensurePlanTrip()` creates
// one (real tripStore semantics) — starting from `null` here reproduces the
// bug where `persist()` used `getPlanTrip()` and silently dropped the very
// first ADD TO PLAN before PLAN had ever been shown.
function fakeStore(nodes = []) {
  let trip = nodes.length ? { id: 'plan-1', kind: 'plan', nodes } : null;
  const calls = [];
  return {
    get trip() {
      return trip;
    },
    calls,
    getPlanTrip: () => trip,
    ensurePlanTrip: () => (trip ??= { id: 'plan-1', kind: 'plan', nodes: [] }),
    setNodes: (id, next) => {
      calls.push(next);
      trip ??= { id: 'plan-1', kind: 'plan', nodes: [] };
      trip.nodes = [...next].sort((a, b) => a.start - b.start);
      return true;
    },
  };
}

const cities = [
  {
    id: 'lisbon-prt',
    name: 'Lisbon',
    country: 'Portugal',
    iso3: 'PRT',
    lat: 38.72,
    lon: -9.14,
    airport: { iata: 'LIS' },
  },
  {
    id: 'valencia-esp',
    name: 'Valencia',
    country: 'Spain',
    iso3: 'ESP',
    lat: 39.47,
    lon: -0.38,
    airport: { iata: 'VLC' },
  },
];
const citiesByIdFull = new Map(cities.map((c) => [c.id, c]));

function makeView(store, extra = {}) {
  return createPlanView({
    doc: fakeDoc(),
    container: fakeDoc().createElement('div'),
    store,
    pack: {
      cities,
      citiesById: citiesByIdFull,
      countries: {},
      seasonality: { cities: {} },
    },
    getCtx: () => ({ scoredById: new Map() }),
    getPrefs: () => ({}),
    setPrefs: () => {},
    ...extra,
  });
}

test('addStay: defaults to firstFreeMonth and the largest non-overlapping length', () => {
  const store = fakeStore([]);
  const view = makeView(store);
  const result = view.addStay('lisbon-prt');
  assert.equal(result.ok, true);
  assert.equal(result.stay.start, 1);
  assert.equal(result.stay.len, 3);
  assert.equal(result.stay.name, 'Lisbon');
  assert.equal(result.stay.lat, 38.72);
  assert.match(
    result.message,
    /Added Lisbon to plan: JAN–MAR \(3 mo\)\. 3 of 12 months covered\./,
  );
  assert.equal(store.trip.nodes.length, 1);
});

test('addStay: reports "full" when no month is free', () => {
  const store = fakeStore([
    { id: 's1', cityId: 'lisbon-prt', name: 'Lisbon', start: 1, len: 12 },
  ]);
  const view = makeView(store);
  const result = view.addStay('valencia-esp');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'full');
  assert.match(result.message, /Plan is full \(12\/12\)/);
});

test('replacePlan: rejects invalid input and overlaps, applies a valid plan in one setNodes call', () => {
  const store = fakeStore([]);
  const view = makeView(store);

  const invalid = view.replacePlan([{ cityId: null, start: 1, len: 3 }]);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, 'invalid');
  assert.equal(store.calls.length, 0);

  const overlap = view.replacePlan([
    { cityId: 'lisbon-prt', start: 1, len: 6 },
    { cityId: 'valencia-esp', start: 3, len: 4 },
  ]);
  assert.equal(overlap.ok, false);
  assert.equal(overlap.error, 'overlap');
  assert.equal(store.calls.length, 0);

  const ok = view.replacePlan([
    { cityId: 'lisbon-prt', start: 1, len: 6 },
    { cityId: 'valencia-esp', start: 7, len: 6 },
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.stays.length, 2);
  assert.equal(ok.stays[1].lat, 39.47);
  assert.equal(
    store.calls.length,
    1,
    'exactly one setNodes commit for the whole plan',
  );
});

test('getSummary: returns the documented per-stay and rollup shape', () => {
  const store = fakeStore([
    {
      id: 's1',
      cityId: 'lisbon-prt',
      name: 'Lisbon',
      lat: 38.72,
      lng: -9.14,
      start: 1,
      len: 6,
    },
    {
      id: 's2',
      cityId: 'valencia-esp',
      name: 'Valencia',
      lat: 39.47,
      lng: -0.38,
      start: 7,
      len: 6,
    },
  ]);
  const view = makeView(store);
  const summary = view.getSummary();
  assert.equal(summary.stays.length, 2);
  const [first] = summary.stays;
  assert.deepEqual(
    Object.keys(first).sort(),
    ['cityId', 'country', 'id', 'metrics', 'name', 'span'].sort(),
  );
  assert.equal(first.name, 'Lisbon');
  assert.equal(first.country, 'Portugal');
  assert.equal(first.span, 'JAN–JUN · 6 mo');
  assert.ok(summary.rollup);
  assert.equal(summary.rollup.monthsCovered, 12);
});

test('show/render/markVoice do not throw for an empty plan or a full single-stay plan', () => {
  const empty = makeView(fakeStore([]));
  empty.show();
  empty.markVoice('I split the year evenly: 6/6 months.');

  const full = fakeStore([
    {
      id: 's1',
      cityId: 'lisbon-prt',
      name: 'Lisbon',
      lat: 38.72,
      lng: -9.14,
      start: 1,
      len: 12,
    },
  ]);
  const view = makeView(full);
  view.show();
  assert.equal(view.planTripId, 'plan-1');
  view.render();
});

test('markVoice: toasts the replaced-plan copy and keeps the chip visible across a re-render inside its 4s window', () => {
  const toasts = [];
  const container = fakeDoc().createElement('div');
  const view = createPlanView({
    doc: fakeDoc(),
    container,
    store: fakeStore([
      { id: 's1', cityId: 'lisbon-prt', name: 'Lisbon', start: 1, len: 6 },
      { id: 's2', cityId: 'valencia-esp', name: 'Valencia', start: 7, len: 6 },
    ]),
    pack: {
      cities,
      citiesById: citiesByIdFull,
      countries: {},
      seasonality: { cities: {} },
    },
    getCtx: () => ({ scoredById: new Map() }),
    getPrefs: () => ({}),
    setPrefs: () => {},
    showToast: (m) => toasts.push(m),
  });
  view.show();
  view.markVoice();
  assert.deepEqual(toasts, ['Plan replaced by voice (2 stays)']);
  // A re-render mid-window (e.g. editing a stay) rebuilds the chip node from
  // scratch; it must still start visible, not hidden, until the window ends.
  view.render();
  const chip = container.children.at(-1).children[0];
  assert.equal(chip.hidden, false);
});

test('rollupCopy: Schengen 90/180 row only when the rule applies', () => {
  const base = {
    monthsCovered: 4,
    gaps: [5, 6, 7, 8, 9, 10, 11, 12],
    fitMean: null,
    annualCost: { usd: null, coveredMonths: 0, complete: false },
    comfortMean: null,
    maxAdvisory: null,
    moves: 1,
    km: 900,
  };
  assert.equal(rollupCopy(base).schengen, null);
  const sch = {
    applies: true,
    limit: 90,
    exceeds: true,
    maxDaysIn180: 120,
    windowStartDay: 300,
  };
  assert.equal(
    rollupCopy({ ...base, schengen: sch }).schengen,
    'exceeds · 120/90 days in 180 from NOV',
  );
  assert.equal(
    rollupCopy({
      ...base,
      schengen: { ...sch, exceeds: false, maxDaysIn180: 90 },
    }).schengen,
    'ok · 90/90 days in 180',
  );
});
