import test from 'node:test';
import assert from 'node:assert/strict';
import {
  comfortScore,
  comfortBin,
  bestWindow,
  isMonthInWindow,
  formatBestSpan,
} from './seasonality.js';

test('comfort score: band is 100, rain penalises, clamps', () => {
  assert.equal(comfortScore(22, 10), 100);
  assert.equal(comfortScore(22, 250), 65);
  assert.equal(comfortScore(-20, 0), 0);
  assert.equal(comfortBin(100), 5);
  assert.equal(comfortBin(0), 0);
});

test('best window wraps over the year seam', () => {
  const s = [90, 92, 70, 40, 20, 10, 10, 20, 40, 70, 88, 91];
  const w = bestWindow(s.map((score) => ({ score })));
  assert.deepEqual(w, {
    startMonth: 10,
    endMonth: 1,
    peakMonth: 1,
    isWrap: true,
  });
  assert.ok(isMonthInWindow(w, 0));
  assert.ok(!isMonthInWindow(w, 5));
  assert.equal(formatBestSpan(w), 'NOV–FEB');
  assert.equal(bestWindow(null), null);
});
