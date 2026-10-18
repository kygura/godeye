import test from 'node:test';
import assert from 'node:assert/strict';
import { TRIP_COLORS, nextTripColor } from './tripColors.js';

test('first color is free by default, then falls back to least-used by index', () => {
  assert.equal(nextTripColor([]), TRIP_COLORS[0]);
  assert.equal(nextTripColor([TRIP_COLORS[0]]), TRIP_COLORS[1]);
  const all = [...TRIP_COLORS];
  assert.equal(
    nextTripColor(all),
    TRIP_COLORS[all.length % TRIP_COLORS.length],
  );
});
