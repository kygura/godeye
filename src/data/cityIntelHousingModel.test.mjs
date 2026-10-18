import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_MIN_ROWS,
  fitHousingModel,
  housingFeatures,
} from './cityIntelHousingModel.js';

/** Rows generated exactly from ln(usd) = 8 + 1·ln(pl) − 0.05·ln(pop) + 0.1·cap. */
function exactRows(n) {
  return Array.from({ length: n }, (_, i) => {
    const x = housingFeatures(0.3 + (i % 7) * 0.12, 1e5 * (1 + i), i % 3 === 0);
    const lnUsd = 8 * x[0] + 1 * x[1] - 0.05 * x[2] + 0.1 * x[3];
    return { usd: Math.exp(lnUsd), x };
  });
}

test('fitHousingModel recovers exact coefficients with R² 1 and ~0 LOO error', () => {
  const fit = fitHousingModel(exactRows(30));
  assert.equal(fit.error, undefined);
  const expected = [8, 1, -0.05, 0.1];
  fit.beta.forEach((b, i) => assert.ok(Math.abs(b - expected[i]) < 1e-6));
  assert.ok(Math.abs(fit.r2 - 1) < 1e-9);
  assert.ok(fit.looMedianAbsPctError < 1e-6);
});

test('fitHousingModel skips (never throws) on too few rows', () => {
  const fit = fitHousingModel(exactRows(MODEL_MIN_ROWS - 1));
  assert.match(fit.error, /only 19 observed cities \(need 20\)/);
  assert.equal(fitHousingModel([]).error, 'only 0 observed cities (need 20)');
});

test('fitHousingModel skips (never throws) on a singular system', () => {
  // Every observed city in one country: ln(priceLevel) is collinear with the intercept.
  const rows = Array.from({ length: 25 }, (_, i) => ({
    usd: 1000 + i * 10,
    x: housingFeatures(0.5, 1e5 * (1 + i), i % 2 === 0),
  }));
  assert.deepEqual(fitHousingModel(rows), { error: 'singular system' });
});
