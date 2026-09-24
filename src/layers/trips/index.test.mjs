import test from 'node:test';
import assert from 'node:assert/strict';
import { tripLegs, tripsRowControls } from './index.js';

const trip = {
  name: 'T',
  color: '#fff',
  nodes: [
    { name: 'London', lat: 51.47, lng: -0.45 },
    { name: 'Auckland', lat: -37, lng: 174.79 },
  ],
};

test('a London-Auckland leg is hub-routed and FLY needs two stops', () => {
  const [leg] = tripLegs(trip);
  assert.equal(leg.segments.length, 2);
  assert.ok(leg.via);
  assert.ok(leg.hours > 20);
  assert.equal(
    tripsRowControls({ trip: { nodes: [trip.nodes[0]] } }).chips[0].disabled,
    true,
  );
  assert.equal(
    tripsRowControls({ trip, flying: false }).chips[0].disabled,
    false,
  );
  assert.equal(tripsRowControls({ trip: null }).chips[1].disabled, true);
});
