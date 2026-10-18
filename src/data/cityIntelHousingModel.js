/**
 * @file City Intel housing model: a small log-linear least-squares fit used
 * by `scripts/build-city-intel.mjs` to estimate monthly housing for cities
 * without an Inside Airbnb median. Pure, no I/O; lives here (not in the
 * script) so node:test can cover it.
 *
 * @module data/cityIntelHousingModel
 */
import { median } from './flowMatch.js';

/** Population floor inside ln(pop): manual/tiny places have pop 0. */
export const MODEL_POP_FLOOR = 1000;
/**
 * Fewest observed cities to fit 4 coefficients: with less, leave-one-out
 * error is noise and one bad median swings the whole pack.
 */
export const MODEL_MIN_ROWS = 20;

/** Solve A x = b (small dense system) by Gaussian elimination with pivoting. */
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error('singular system');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Ordinary least squares: rows of features (with intercept column) -> beta. */
export function ols(X, y) {
  const k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  X.forEach((row, i) => {
    for (let a = 0; a < k; a++) {
      Xty[a] += row[a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += row[a] * row[b];
    }
  });
  return solveLinear(XtX, Xty);
}

export const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);

/**
 * Housing model features for one city: [1, ln(priceLevel), ln(pop), capital].
 * ponytail: 4-term log-linear fit on ~85 Inside Airbnb cities (mostly rich
 * and big); it only knows country price level + size + capital, so beach
 * towns and tech hubs in cheap countries are underestimated. Upgrade path:
 * more observed cities or a city-level rent source.
 */
export const housingFeatures = (priceLevel, pop, capital) => [
  1,
  Math.log(priceLevel),
  Math.log(Math.max(pop, MODEL_POP_FLOOR)),
  capital ? 1 : 0,
];

/**
 * Fit ln(usd) on housingFeatures; report R² and leave-one-out median |%err|.
 * Never throws: too few rows or a singular system (e.g. every observed city
 * in one country) returns `{ error }` so the caller can skip the model.
 * @param {Array<{usd: number, x: number[]}>} observed
 * @param {{minRows?: number}} [options]
 * @returns {{beta: number[], r2: number, looMedianAbsPctError: number}|{error: string}}
 */
export function fitHousingModel(observed, { minRows = MODEL_MIN_ROWS } = {}) {
  if (observed.length < minRows)
    return {
      error: `only ${observed.length} observed cities (need ${minRows})`,
    };
  try {
    const X = observed.map((o) => o.x);
    const y = observed.map((o) => Math.log(o.usd));
    const beta = ols(X, y);
    const mean = y.reduce((a, b) => a + b, 0) / y.length;
    let ssRes = 0;
    let ssTot = 0;
    y.forEach((v, i) => {
      ssRes += (v - dot(beta, X[i])) ** 2;
      ssTot += (v - mean) ** 2;
    });
    const looErrors = observed.map((o, i) => {
      const b = ols(
        X.filter((_, j) => j !== i),
        y.filter((_, j) => j !== i),
      );
      return Math.abs(Math.exp(dot(b, o.x)) / o.usd - 1) * 100;
    });
    return {
      beta,
      r2: 1 - ssRes / ssTot,
      looMedianAbsPctError: median(looErrors),
    };
  } catch (err) {
    return { error: err.message };
  }
}
