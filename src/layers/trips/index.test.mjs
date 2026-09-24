import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tripLegs,
  tripsRowControls,
  nodeLabelText,
  createTripsLayer,
} from './index.js';

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

test('a full-year plan trip closes the loop; a partial one does not', () => {
  const full = {
    kind: 'plan',
    nodes: [
      { name: 'Lisbon', lat: 38.72, lng: -9.14, start: 1, len: 6 },
      { name: 'Valencia', lat: 39.47, lng: -0.38, start: 7, len: 6 },
    ],
  };
  const legs = tripLegs(full);
  assert.equal(legs.length, 2);
  assert.equal(legs[1].from.name, 'Valencia');
  assert.equal(legs[1].to.name, 'Lisbon');

  const partial = {
    kind: 'plan',
    nodes: [
      { name: 'Lisbon', lat: 38.72, lng: -9.14, start: 1, len: 4 },
      { name: 'Valencia', lat: 39.47, lng: -0.38, start: 7, len: 3 },
    ],
  };
  assert.equal(tripLegs(partial).length, 1);

  // An ordinary trip never gets the closing leg, even at len sum 12.
  const ordinary = {
    nodes: [
      { name: 'A', lat: 0, lng: 0, len: 6 },
      { name: 'B', lat: 1, lng: 1, len: 6 },
    ],
  };
  assert.equal(tripLegs(ordinary).length, 1);
});

test('nodeLabelText: plan trips show the stay span, ordinary trips a running index', () => {
  const stay = { start: 11, len: 4, iata: 'LIS', name: 'Lisbon' };
  assert.equal(nodeLabelText({ kind: 'plan' }, stay, 0), 'NOV–FEB LIS');
  assert.equal(
    nodeLabelText({ kind: 'plan' }, { start: 6, len: 1, name: 'Valencia' }, 2),
    'JUN Valencia',
  );
  assert.equal(nodeLabelText({}, { name: 'Lisbon' }, 0), '1 Lisbon');
});

test('CLEAR empties a plan trip via clearTrip, but removes an ordinary trip', () => {
  const calls = [];
  const fakeStore = (trip) => ({
    subscribe: () => () => {},
    getActiveTrip: () => trip,
    clearTrip: (id) => calls.push(['clear', id]),
    removeTrip: (id) => calls.push(['remove', id]),
  });

  createTripsLayer({ store: fakeStore({ id: 't1', kind: 'plan' }) }).setParams({
    clear: true,
  });
  assert.deepEqual(calls, [['clear', 't1']]);

  calls.length = 0;
  createTripsLayer({ store: fakeStore({ id: 't2' }) }).setParams({
    clear: true,
  });
  assert.deepEqual(calls, [['remove', 't2']]);

  calls.length = 0;
  createTripsLayer({ store: fakeStore(null) }).setParams({ clear: true });
  assert.deepEqual(calls, []);
});
