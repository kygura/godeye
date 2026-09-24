import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, greatCirclePoints, flightPath, MAX_NONSTOP_KM } from './geo.js';

const LHR = [-0.45, 51.47];
const AKL = [174.79, -37.0];
const LAX = [-118.4, 33.94];
const SIN = [103.99, 1.36];

test('haversine matches a known distance', () => {
  assert.ok(Math.abs(haversineKm(LHR, [2.55, 49.01]) - 348) < 5);
});

test('great circle across the antimeridian never jumps 360°', () => {
  const pts = greatCirclePoints([170, 10], [-170, 12], 16);
  for (let i = 1; i < pts.length; i++)
    assert.ok(Math.abs(pts[i][0] - pts[i - 1][0]) < 180);
});

test('a leg beyond nonstop range routes via the cheapest hub', () => {
  assert.ok(haversineKm(LHR, AKL) > MAX_NONSTOP_KM);
  const hubs = [{ coord: LAX, label: 'LAX' }, { coord: SIN, label: 'SIN' }];
  const p = flightPath(LHR, AKL, hubs);
  assert.equal(p.segments.length, 2);
  assert.ok(['LAX', 'SIN'].includes(p.via));
  assert.equal(flightPath(LHR, LAX, hubs).segments.length, 1);
});
