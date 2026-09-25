import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm } from '../../travel/geo.js';
import {
  monthsOf,
  spanLabel,
  overlaps,
  firstFreeMonth,
  evenSplit,
  addStay,
  removeStay,
  updateStay,
  stayMetrics,
  rollup,
  HOUSING_SHARE,
} from './plan.js';

// -- monthsOf / spanLabel ----------------------------------------------------

test('monthsOf wraps past December', () => {
  assert.deepEqual(monthsOf({ start: 1, len: 3 }), [1, 2, 3]);
  assert.deepEqual(monthsOf({ start: 11, len: 4 }), [11, 12, 1, 2]);
  assert.deepEqual(monthsOf({ start: 12, len: 1 }), [12]);
});

test('spanLabel formats wrap and single-month stays', () => {
  assert.equal(spanLabel({ start: 11, len: 4 }), 'NOV–FEB · 4 mo');
  assert.equal(spanLabel({ start: 6, len: 1 }), 'JUN · 1 mo');
  assert.equal(spanLabel({ start: 3, len: 2 }), 'MAR–APR · 2 mo');
});

// -- overlaps / firstFreeMonth ------------------------------------------------

test('overlaps finds shared months, including across the December wrap', () => {
  const stays = [{ id: 'a', start: 1, len: 3 }]; // JAN-MAR
  assert.deepEqual(overlaps(stays, { start: 3, len: 2 }), [3]); // MAR-APR
  assert.deepEqual(overlaps(stays, { start: 4, len: 2 }), []); // clear
  const wrapStays = [{ id: 'b', start: 11, len: 4 }]; // NOV-FEB
  assert.deepEqual(overlaps(wrapStays, { start: 1, len: 2 }), [1, 2]);
});

test('overlaps ignores the given id (checking a stay against the others)', () => {
  const stays = [
    { id: 'a', start: 1, len: 3 },
    { id: 'b', start: 4, len: 2 },
  ];
  assert.deepEqual(overlaps(stays, { start: 1, len: 3 }, 'a'), []);
  assert.deepEqual(overlaps(stays, { start: 4, len: 2 }, 'a'), [4, 5]);
});

test('firstFreeMonth finds the first uncovered month, or null when full', () => {
  assert.equal(firstFreeMonth([]), 1);
  assert.equal(firstFreeMonth([{ start: 1, len: 4 }]), 5);
  assert.equal(firstFreeMonth([{ start: 1, len: 12 }]), null);
});

// -- evenSplit -----------------------------------------------------------------

test('evenSplit covers all 12 months, remainder to the earliest stays', () => {
  assert.deepEqual(evenSplit(1), [{ start: 1, len: 12 }]);
  assert.deepEqual(evenSplit(2), [
    { start: 1, len: 6 },
    { start: 7, len: 6 },
  ]);
  assert.deepEqual(evenSplit(3), [
    { start: 1, len: 4 },
    { start: 5, len: 4 },
    { start: 9, len: 4 },
  ]);
  assert.deepEqual(evenSplit(4), [
    { start: 1, len: 3 },
    { start: 4, len: 3 },
    { start: 7, len: 3 },
    { start: 10, len: 3 },
  ]);
  assert.deepEqual(evenSplit(5), [
    { start: 1, len: 3 },
    { start: 4, len: 3 },
    { start: 7, len: 2 },
    { start: 9, len: 2 },
    { start: 11, len: 2 },
  ]);
  assert.deepEqual(evenSplit(6), [
    { start: 1, len: 2 },
    { start: 3, len: 2 },
    { start: 5, len: 2 },
    { start: 7, len: 2 },
    { start: 9, len: 2 },
    { start: 11, len: 2 },
  ]);
  for (const n of [1, 2, 3, 4, 5, 6])
    assert.equal(
      evenSplit(n).reduce((s, x) => s + x.len, 0),
      12,
    );
  assert.throws(() => evenSplit(0), RangeError);
  assert.throws(() => evenSplit(13), RangeError);
});

// -- addStay / removeStay / updateStay ----------------------------------------

test('addStay validates input and rejects overlaps, reporting conflicting months', () => {
  assert.equal(addStay([], { cityId: null, start: 1, len: 2 }).ok, false);
  assert.equal(addStay([], { cityId: 'a', start: 0, len: 2 }).ok, false);
  assert.equal(addStay([], { cityId: 'a', start: 1, len: 13 }).ok, false);
  assert.equal(
    addStay([], { cityId: null, start: 1, len: 2 }).error,
    'invalid',
  );

  const first = addStay([], { cityId: 'lisbon-prt', start: 1, len: 3 });
  assert.equal(first.ok, true);
  assert.equal(first.stays.length, 1);
  assert.deepEqual(first.months, [1, 2, 3]);
  assert.ok(first.stays[0].id);

  const clash = addStay(first.stays, { cityId: 'tokyo-jpn', start: 3, len: 2 });
  assert.equal(clash.ok, false);
  assert.equal(clash.error, 'overlap');
  assert.deepEqual(clash.months, [3]);
});

test('addStay allows the same city twice and keeps stays ordered by start', () => {
  let stays = [];
  stays = addStay(stays, { cityId: 'lisbon-prt', start: 9, len: 3 }).stays; // SEP-NOV
  stays = addStay(stays, { cityId: 'lisbon-prt', start: 1, len: 2 }).stays; // JAN-FEB, same city again
  assert.equal(stays.length, 2);
  assert.equal(stays[0].start, 1);
  assert.equal(stays[1].start, 9);
  assert.equal(stays[0].cityId, stays[1].cityId);
  assert.notEqual(stays[0].id, stays[1].id);
});

test('removeStay drops by id and reports whether it existed', () => {
  const { stays } = addStay([], { cityId: 'a', start: 1, len: 2 });
  const id = stays[0].id;
  const gone = removeStay(stays, id);
  assert.equal(gone.ok, true);
  assert.deepEqual(gone.stays, []);
  assert.equal(removeStay(stays, 'nope').ok, false);
});

test('updateStay re-validates months, excluding the stay itself from the overlap check', () => {
  let stays = addStay([], { cityId: 'a', start: 1, len: 2 }).stays;
  stays = addStay(stays, { cityId: 'b', start: 6, len: 2 }).stays;
  const aId = stays[0].id;

  assert.equal(updateStay(stays, 'missing', { start: 3 }).error, 'not-found');
  assert.equal(updateStay(stays, aId, { len: 0 }).error, 'invalid');

  // No-op move (same months) must not conflict with itself.
  const same = updateStay(stays, aId, { start: 1, len: 2 });
  assert.equal(same.ok, true);

  // Moving stay a onto stay b's months is still rejected.
  const clash = updateStay(stays, aId, { start: 6, len: 1 });
  assert.equal(clash.ok, false);
  assert.equal(clash.error, 'overlap');
  assert.deepEqual(clash.months, [6]);

  const moved = updateStay(stays, aId, { start: 3, len: 2 });
  assert.equal(moved.ok, true);
  assert.equal(moved.stays[0].id, aId);
  assert.equal(moved.stays[0].start, 3);
  assert.equal(moved.stays[1].id, stays[1].id);
});

// -- stayMetrics fixtures ------------------------------------------------------

const countries = {
  PRT: { metrics: { priceLevel: { v: 0.7, y: 2024 } } },
  USA: { metrics: { priceLevel: { v: 1.0, y: 2023 } } },
  JPN: { metrics: { priceLevel: { v: 0.9, y: 2022 } } },
  XXX: { metrics: {} }, // no priceLevel on record
};

const citiesById = new Map([
  ['lisbon-prt', { id: 'lisbon-prt', iso3: 'PRT', lat: 38.72, lon: -9.14 }],
  ['nyc-usa', { id: 'nyc-usa', iso3: 'USA', lat: 40.75, lon: -73.98 }],
  ['tokyo-jpn', { id: 'tokyo-jpn', iso3: 'JPN', lat: 35.69, lon: 139.69 }],
  ['unknown-xxx', { id: 'unknown-xxx', iso3: 'XXX', lat: 0, lon: 0 }],
]);

const scoredById = new Map([
  [
    'lisbon-prt',
    {
      composite: 72,
      coverage: { text: '4 of 4 pillars · 1 city-level metric' },
      pillars: { safety: { score: 80, coverage: 'full' } },
      city: { iso3: 'PRT' },
    },
  ],
  [
    'nyc-usa',
    {
      composite: 65,
      coverage: { text: '4 of 4 pillars · 1 city-level metric' },
      pillars: { safety: { score: 55, coverage: 'full' } },
      city: { iso3: 'USA' },
    },
  ],
  [
    'tokyo-jpn',
    {
      composite: 80,
      coverage: { text: '4 of 4 pillars · 1 city-level metric' },
      pillars: { safety: { score: 90, coverage: 'full' } },
      city: { iso3: 'JPN' },
    },
  ],
  // 'unknown-xxx' deliberately absent: ineligible/unscored city.
]);

const seasonality = {
  cities: {
    'lisbon-prt': {
      months: Array.from({ length: 12 }, (_, i) => ({ score: 60 + i })),
    },
    'tokyo-jpn': { months: Array.from({ length: 12 }, () => ({ score: 50 })) },
    // 'nyc-usa' deliberately absent: no seasonality row.
  },
};

const advisories = {
  byIso3: { PRT: { level: 1 }, USA: { level: 2 }, JPN: { level: 1 } },
};
const visaSet = { byDest: { PRT: -1, USA: 45, JPN: 'visa required' } };
const rentByCity = new Map([
  [
    'nyc-usa',
    { zori: 2900, month: '2025-08', metro: 'New York-Newark-Jersey City' },
  ],
]);

const baseCtx = (extra = {}) => ({
  scoredById,
  countries,
  seasonality,
  advisories,
  visa: visaSet,
  rentByCity,
  citiesById,
  profile: { homeCityId: 'nyc-usa', monthlySpendUsd: 3000 },
  overrides: {},
  ...extra,
});

// -- stayMetrics: fit / safety --------------------------------------------------

test('stayMetrics reads fit and safety from the scored index, null/unavailable when unscored', () => {
  const known = stayMetrics(
    { id: 's1', cityId: 'lisbon-prt', start: 1, len: 2 },
    baseCtx(),
  );
  assert.deepEqual(known.fit, {
    score: 72,
    coverageText: '4 of 4 pillars · 1 city-level metric',
  });
  assert.deepEqual(known.safety, { score: 80, coverage: 'full' });

  const unscored = stayMetrics(
    { id: 's2', cityId: 'unknown-xxx', start: 1, len: 2 },
    baseCtx(),
  );
  assert.equal(unscored.fit, null);
  assert.deepEqual(unscored.safety, { score: null, coverage: 'unavailable' });
  assert.deepEqual(unscored.advisory, { level: null });
});

// -- stayMetrics: cost ----------------------------------------------------------

test('cost: ratio and estimate against the home country price level', () => {
  const m = stayMetrics(
    { id: 's1', cityId: 'lisbon-prt', start: 1, len: 2 },
    baseCtx(),
  );
  assert.equal(m.cost.basis, 'estimate');
  assert.equal(m.cost.ratio, 0.7);
  assert.deepEqual(m.cost.ratioYears, { stay: 2024, home: 2023 });
  assert.equal(m.cost.estimateUsd, 2100); // 3000 * 0.7, already a multiple of 10
  assert.equal(
    m.cost.label,
    'estimate from country price levels, consumption basket; expat costs often differ',
  );
});

test('cost: blends in the stay/home city housing ratio when both cities have housing', () => {
  const withHousing = new Map(citiesById);
  withHousing.set('lisbon-prt', {
    ...citiesById.get('lisbon-prt'),
    housing: { usd: 3000, src: 'insideairbnb', n: 600, rule: 'min28' },
  });
  withHousing.set('nyc-usa', {
    ...citiesById.get('nyc-usa'),
    housing: { usd: 6000, src: 'insideairbnb', n: 9000, rule: 'min28' },
  });
  const m = stayMetrics(
    { id: 's1', cityId: 'lisbon-prt', start: 1, len: 2 },
    baseCtx({ citiesById: withHousing }),
  );
  assert.equal(HOUSING_SHARE, 0.35);
  assert.equal(m.cost.basis, 'estimate', 'same result kind as before');
  assert.equal(m.cost.housingShare, 0.35);
  // 0.65 × 0.7 (country) + 0.35 × 3000/6000 (housing) = 0.63
  assert.ok(Math.abs(m.cost.ratio - 0.63) < 1e-9);
  assert.equal(m.cost.estimateUsd, 1890);

  // Home city without housing: country ratio alone.
  const homeless = new Map(withHousing);
  homeless.set('nyc-usa', citiesById.get('nyc-usa'));
  const plain = stayMetrics(
    { id: 's1', cityId: 'lisbon-prt', start: 1, len: 2 },
    baseCtx({ citiesById: homeless }),
  );
  assert.equal(plain.cost.housingShare, 0);
  assert.equal(plain.cost.ratio, 0.7);
});

test('cost: manual override replaces the estimate and is labelled "your figure"', () => {
  const ctx = baseCtx({ overrides: { s1: 1500 } });
  const m = stayMetrics(
    { id: 's1', cityId: 'lisbon-prt', start: 1, len: 2 },
    ctx,
  );
  assert.equal(m.cost.basis, 'override');
  assert.equal(m.cost.override, 1500);
  assert.equal(m.cost.estimateUsd, null);
  assert.equal(m.cost.label, 'your figure');
});

test('cost: no home set shows "set home to compare costs"', () => {
  const ctx = baseCtx({ profile: {} });
  const m = stayMetrics(
    { id: 's1', cityId: 'lisbon-prt', start: 1, len: 2 },
    ctx,
  );
  assert.equal(m.cost.basis, 'no-home');
  assert.equal(m.cost.ratio, null);
  assert.equal(m.cost.label, 'set home to compare costs');
});

test('cost: ratio-only once home is set but no monthly spend is given', () => {
  const ctx = baseCtx({ profile: { homeCityId: 'nyc-usa' } });
  const m = stayMetrics(
    { id: 's1', cityId: 'lisbon-prt', start: 1, len: 2 },
    ctx,
  );
  assert.equal(m.cost.basis, 'ratio-only');
  assert.equal(m.cost.ratio, 0.7);
  assert.equal(m.cost.estimateUsd, null);
});

test('cost: unavailable when the country has no price level on record', () => {
  const m = stayMetrics(
    { id: 's1', cityId: 'unknown-xxx', start: 1, len: 2 },
    baseCtx(),
  );
  assert.equal(m.cost.basis, 'unavailable');
  assert.equal(m.cost.ratio, null);
  assert.equal(m.cost.estimateUsd, null);
});

test('cost: US rent is an info line only, never folded into the estimate', () => {
  const m = stayMetrics(
    { id: 's1', cityId: 'nyc-usa', start: 1, len: 2 },
    baseCtx(),
  );
  assert.deepEqual(m.cost.rentInfo, {
    zori: 2900,
    month: '2025-08',
    metro: 'New York-Newark-Jersey City',
  });
  // Estimate is home-vs-home (ratio 1); rent's $2900 must not appear in it.
  assert.equal(m.cost.estimateUsd, 3000);
  const nonUs = stayMetrics(
    { id: 's2', cityId: 'lisbon-prt', start: 1, len: 2 },
    baseCtx(),
  );
  assert.equal(nonUs.cost.rentInfo, null);
});

// -- stayMetrics: comfort ---------------------------------------------------------

test('comfort: mean over wrapped months, unavailable without a seasonality row', () => {
  const wrapped = stayMetrics(
    { id: 's1', cityId: 'lisbon-prt', start: 11, len: 4 },
    baseCtx(),
  );
  // months 11,12,1,2 -> scores 70,71,60,61
  assert.equal(wrapped.comfort.mean, 65.5);
  assert.equal(wrapped.comfort.status, 'ok');
  assert.equal(wrapped.comfort.months.length, 4);

  const missing = stayMetrics(
    { id: 's2', cityId: 'nyc-usa', start: 1, len: 3 },
    baseCtx(),
  );
  assert.equal(missing.comfort.mean, null);
  assert.equal(missing.comfort.status, 'unavailable');
  assert.deepEqual(
    missing.comfort.months.map((x) => x.score),
    [null, null, null],
  );
});

// -- stayMetrics: visa ------------------------------------------------------------

test('visa: own country, numeric allowance ok/exceeds, category unknown, no-passport, offline', () => {
  const ctx = baseCtx();
  const ownCountry = stayMetrics(
    { id: 's1', cityId: 'lisbon-prt', start: 1, len: 3 },
    ctx,
  );
  assert.deepEqual(ownCountry.visa, {
    status: 'ok',
    allowanceDays: null,
    stayDays: 90,
    requirement: null,
  });

  const withinAllowance = stayMetrics(
    { id: 's2', cityId: 'nyc-usa', start: 1, len: 1 },
    ctx,
  );
  assert.deepEqual(withinAllowance.visa, {
    status: 'ok',
    allowanceDays: 45,
    stayDays: 30,
    requirement: null,
  });

  const exceeds = stayMetrics(
    { id: 's3', cityId: 'nyc-usa', start: 1, len: 2 },
    ctx,
  );
  assert.deepEqual(exceeds.visa, {
    status: 'exceeds',
    allowanceDays: 45,
    stayDays: 60,
    requirement: null,
  });

  const unknownCategory = stayMetrics(
    { id: 's4', cityId: 'tokyo-jpn', start: 1, len: 1 },
    ctx,
  );
  assert.deepEqual(unknownCategory.visa, {
    status: 'unknown',
    allowanceDays: null,
    stayDays: 30,
    requirement: 'visa required',
  });

  const noEntry = stayMetrics(
    { id: 's5', cityId: 'unknown-xxx', start: 1, len: 1 },
    ctx,
  );
  assert.equal(noEntry.visa.status, 'unknown');

  const noPassport = stayMetrics(
    { id: 's6', cityId: 'lisbon-prt', start: 1, len: 1 },
    baseCtx({ visa: undefined }),
  );
  assert.equal(noPassport.visa.status, 'no-passport');

  const offline = stayMetrics(
    { id: 's7', cityId: 'lisbon-prt', start: 1, len: 1 },
    baseCtx({ visa: { offline: true } }),
  );
  assert.equal(offline.visa.status, 'offline');
});

// -- rollup -------------------------------------------------------------------

function metricsFor(stays, ctx) {
  const map = new Map();
  for (const stay of stays) map.set(stay.id, stayMetrics(stay, ctx));
  return map;
}

test('rollup: partial year has gaps, no loop closing, and a partial cost label', () => {
  const stays = [
    { id: 's1', cityId: 'lisbon-prt', start: 1, len: 4 }, // JAN-APR
    { id: 's2', cityId: 'tokyo-jpn', start: 7, len: 3 }, // JUL-SEP
  ];
  const ctx = baseCtx();
  const metrics = metricsFor(stays, ctx);
  const r = rollup(stays, metrics, citiesById);

  assert.equal(r.monthsCovered, 7);
  assert.deepEqual(r.gaps, [5, 6, 10, 11, 12]);
  assert.equal(r.moves, 1); // no closing leg: year is not fully covered
  const expectedKm = Math.round(haversineKm([-9.14, 38.72], [139.69, 35.69]));
  assert.equal(r.km, expectedKm);

  // fitMean: (72*4 + 80*3) / 7
  assert.ok(Math.abs(r.fitMean - 528 / 7) < 1e-9);
  // comfortMean: lisbon JAN-APR = 60,61,62,63 (mean 61.5); tokyo JUL-SEP = 50,50,50
  assert.ok(Math.abs(r.comfortMean - (61.5 * 4 + 50 * 3) / 7) < 1e-9);

  assert.equal(r.annualCost.complete, false);
  assert.equal(r.annualCost.usd, null);
  assert.equal(r.annualCost.coveredMonths, 7);
  assert.equal(r.annualCost.label, 'partial, 7/12 months');

  assert.equal(r.maxAdvisory, 1);
});

test('rollup: a full 12/12 year closes the loop and reports a complete annual cost', () => {
  const stays = [
    { id: 's1', cityId: 'nyc-usa', start: 1, len: 6 },
    { id: 's2', cityId: 'lisbon-prt', start: 7, len: 6 },
  ];
  const ctx = baseCtx(); // home = nyc-usa, spend = 3000
  const metrics = metricsFor(stays, ctx);
  const r = rollup(stays, metrics, citiesById);

  assert.equal(r.monthsCovered, 12);
  assert.deepEqual(r.gaps, []);
  assert.equal(r.moves, 2); // outbound leg + closing leg back to the first stay

  const leg = haversineKm([-73.98, 40.75], [-9.14, 38.72]);
  assert.equal(r.km, Math.round(leg * 2));

  assert.equal(r.annualCost.complete, true);
  assert.equal(r.annualCost.coveredMonths, 12);
  // nyc-usa: ratio 1 -> 3000/mo * 6; lisbon: ratio 0.7 -> 2100/mo * 6
  assert.equal(r.annualCost.usd, 3000 * 6 + 2100 * 6);
  assert.equal(r.annualCost.label, undefined);
});

test('rollup: 12/12 months covered but one stay has an unavailable cost basis -> partial annual cost', () => {
  const stays = [
    { id: 's1', cityId: 'unknown-xxx', start: 1, len: 5 }, // JAN-MAY, no price level on record
    { id: 's2', cityId: 'lisbon-prt', start: 6, len: 7 }, // JUN-DEC
  ];
  const ctx = baseCtx();
  const metrics = metricsFor(stays, ctx);
  assert.equal(metrics.get('s1').cost.basis, 'unavailable');
  const r = rollup(stays, metrics, citiesById);

  assert.equal(r.monthsCovered, 12);
  assert.deepEqual(r.gaps, []);
  assert.equal(r.annualCost.complete, false);
  assert.equal(r.annualCost.usd, null);
  assert.equal(r.annualCost.coveredMonths, 7);
  assert.equal(r.annualCost.label, 'partial, 7/12 months');
});

test('rollup: a single stay never closes a loop, even covering all 12 months', () => {
  const stays = [{ id: 's1', cityId: 'lisbon-prt', start: 1, len: 12 }];
  const ctx = baseCtx();
  const metrics = metricsFor(stays, ctx);
  const r = rollup(stays, metrics, citiesById);
  assert.equal(r.monthsCovered, 12);
  assert.equal(r.moves, 0);
  assert.equal(r.km, 0);
});

// -- Schengen 90/180 -------------------------------------------------------------

const schengenCities = new Map([
  ...citiesById,
  ['paris-fra', { id: 'paris-fra', iso3: 'FRA', lat: 48.86, lon: 2.35 }],
  ['berlin-deu', { id: 'berlin-deu', iso3: 'DEU', lat: 52.52, lon: 13.4 }],
]);
const usPassport = {
  passport: 'USA',
  byDest: { USA: -1, FRA: 90, DEU: 90, PRT: 90, JPN: 'visa required' },
};

function schengenFor(stays, visa = usPassport) {
  const ctx = baseCtx({ citiesById: schengenCities, visa });
  return rollup(stays, metricsFor(stays, ctx), schengenCities).schengen;
}

test('schengen: two consecutive 2-month stays each pass alone but exceed 90/180 together', () => {
  const stays = [
    { id: 's1', cityId: 'paris-fra', start: 3, len: 2 }, // MAR-APR
    { id: 's2', cityId: 'berlin-deu', start: 5, len: 2 }, // MAY-JUN
  ];
  const ctx = baseCtx({ citiesById: schengenCities, visa: usPassport });
  // Per stay the combined rule is the authority: no flat 'exceeds' flag.
  assert.equal(stayMetrics(stays[0], ctx).visa.status, 'schengen');
  assert.deepEqual(schengenFor(stays), {
    applies: true,
    maxDaysIn180: 120,
    limit: 90,
    exceeds: true,
    windowStartDay: 60, // MAR 1
  });
});

test('schengen: stays split by a 3-month non-Schengen gap stay within 90/180', () => {
  const s = schengenFor([
    { id: 's1', cityId: 'paris-fra', start: 1, len: 2 }, // JAN-FEB
    { id: 's2', cityId: 'tokyo-jpn', start: 3, len: 3 }, // MAR-MAY
    { id: 's3', cityId: 'berlin-deu', start: 6, len: 2 }, // JUN-JUL
  ]);
  assert.equal(s.applies, true);
  assert.equal(s.maxDaysIn180, 90);
  assert.equal(s.exceeds, false);
});

test('schengen: the rolling window wraps December into January', () => {
  const s = schengenFor([
    { id: 's1', cityId: 'berlin-deu', start: 1, len: 2 }, // JAN-FEB
    { id: 's2', cityId: 'paris-fra', start: 11, len: 2 }, // NOV-DEC
  ]);
  assert.equal(s.maxDaysIn180, 120);
  assert.equal(s.exceeds, true);
  assert.equal(s.windowStartDay, 300); // NOV 1
});

test('schengen: exempt passport, no passport and non-Schengen-only plans do not apply', () => {
  const stays = [
    { id: 's1', cityId: 'paris-fra', start: 1, len: 6 },
    { id: 's2', cityId: 'berlin-deu', start: 7, len: 6 },
  ];
  const exempt = { passport: 'PRT', byDest: { FRA: 90, DEU: 'visa free' } };
  const ctx = baseCtx({ citiesById: schengenCities, visa: exempt });
  assert.equal(stayMetrics(stays[0], ctx).visa.status, 'ok');
  assert.equal(stayMetrics(stays[1], ctx).visa.status, 'ok');
  assert.equal(schengenFor(stays, exempt).applies, false);
  assert.equal(schengenFor(stays, null).applies, false); // no passport set

  const none = schengenFor([
    { id: 's1', cityId: 'tokyo-jpn', start: 1, len: 6 },
    { id: 's2', cityId: 'nyc-usa', start: 7, len: 6 },
  ]);
  assert.deepEqual(none, {
    applies: false,
    maxDaysIn180: 0,
    limit: 90,
    exceeds: false,
    windowStartDay: null,
  });
});
