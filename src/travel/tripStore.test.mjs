import test from 'node:test';
import assert from 'node:assert/strict';
import { createTripStore, STORAGE_KEY } from './tripStore.js';

const fakeStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, v),
    map: m,
  };
};
const tokyo = {
  cityId: 'tokyo-japan',
  name: 'Tokyo',
  lat: 35.7,
  lng: 139.7,
  iata: 'HND',
};
const lima = { cityId: 'lima-peru', name: 'Lima', lat: -12, lng: -77 };

test('ensurePlanTrip + setNodes persists, and reloads from storage', () => {
  const storage = fakeStorage();
  const a = createTripStore({ storage });
  let seen = 0;
  a.subscribe(() => seen++);
  const plan = a.ensurePlanTrip();
  a.setNodes(plan.id, [tokyo, lima]);
  assert.equal(a.getPlanTrip().nodes.length, 2);
  assert.ok(seen >= 2);
  const b = createTripStore({ storage });
  assert.equal(b.getPlanTrip().nodes[1].name, 'Lima');
  assert.ok(storage.map.has(STORAGE_KEY));
});

test('corrupt storage recovers empty; removeTrip clears the active id; null storage is safe', () => {
  const storage = fakeStorage();
  storage.setItem(STORAGE_KEY, '{not json');
  const s = createTripStore({ storage });
  assert.deepEqual(s.getState().trips, []);
  const plan = s.ensurePlanTrip();
  s.setActive(plan.id);
  assert.ok(s.removeTrip(plan.id));
  assert.equal(s.getActiveTrip(), null);
  assert.equal(createTripStore({ storage: null }).getState().trips.length, 0);
});

test('clearTrip empties nodes without deleting the trip', () => {
  const s = createTripStore({ storage: fakeStorage() });
  const plan = s.ensurePlanTrip();
  s.setNodes(plan.id, [tokyo, lima]);
  assert.ok(s.clearTrip(plan.id));
  assert.equal(s.getPlanTrip().id, plan.id);
  assert.deepEqual(s.getPlanTrip().nodes, []);
  assert.equal(s.clearTrip(plan.id), false);
  assert.equal(s.clearTrip('does-not-exist'), false);
});

test('ensurePlanTrip creates the plan trip once, without activating it, and is idempotent', () => {
  const s = createTripStore({ storage: fakeStorage() });
  assert.equal(s.getPlanTrip(), null);
  const plan = s.ensurePlanTrip();
  assert.equal(plan.kind, 'plan');
  assert.equal(plan.name, 'Lifestyle plan');
  assert.equal(plan.nodes.length, 0);
  assert.equal(
    s.getActiveTrip(),
    null,
    'ensurePlanTrip must not change the active trip',
  );
  assert.equal(
    s.ensurePlanTrip(),
    plan,
    'idempotent: same trip on a second call',
  );
  assert.equal(s.getPlanTrip(), plan);
});

test('setNodes replaces a trip nodes in one commit, sorting plan trips by start', () => {
  const storage = fakeStorage();
  const s = createTripStore({ storage });
  const plan = s.ensurePlanTrip();
  let seen = 0;
  s.subscribe(() => seen++);
  const ok = s.setNodes(plan.id, [
    { id: 'b', cityId: 'lima-peru', start: 6, len: 2, extra: 'x' },
    { id: 'a', cityId: 'tokyo-japan', start: 1, len: 3 },
  ]);
  assert.equal(ok, true);
  assert.equal(seen, 1);
  assert.deepEqual(
    s.getPlanTrip().nodes.map((n) => n.id),
    ['a', 'b'],
  );
  assert.equal(s.getPlanTrip().nodes[1].extra, 'x');
  assert.equal(s.setNodes('does-not-exist', []), false);
});

test('setNodes on a non-plan trip keeps insertion order (no start-based sort)', () => {
  const storage = fakeStorage();
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      activeTripId: null,
      trips: [{ id: 'trip-1', name: 'Ordinary', nodes: [] }],
    }),
  );
  const s = createTripStore({ storage });
  assert.ok(s.setNodes('trip-1', [tokyo, lima]));
  assert.deepEqual(
    s.getState().trips[0].nodes.map((n) => n.name),
    ['Tokyo', 'Lima'],
  );
});

test('load sanitizes malformed shapes: bad trips/nodes and the retired shortlist field are dropped, no throw', () => {
  const storage = fakeStorage();
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      activeTripId: 'trip-1',
      shortlist: ['some-city'],
      trips: [
        null,
        'not-a-trip',
        { id: 42, name: 'numeric id', nodes: [] },
        {
          id: 'trip-1',
          name: 'Mixed bag',
          extra: 'kept',
          nodes: 'not-an-array',
        },
        {
          id: 'trip-2',
          name: 'Mixed nodes',
          nodes: [
            tokyo,
            null,
            { name: 'no coords' },
            { name: 'bad coords', lat: 'x', lng: 1 },
            { ...lima, id: 'stay-x', start: 2 },
          ],
        },
      ],
    }),
  );
  const s = createTripStore({ storage });
  assert.equal(
    s.getState().shortlist,
    undefined,
    'retired shortlist field is dropped silently',
  );
  assert.equal(s.getState().trips.length, 2);
  const trip1 = s.getState().trips.find((t) => t.id === 'trip-1');
  assert.equal(trip1.extra, 'kept');
  assert.deepEqual(trip1.nodes, []);
  const trip2 = s.getState().trips.find((t) => t.id === 'trip-2');
  assert.equal(trip2.nodes.length, 2);
  assert.equal(trip2.nodes[0].name, 'Tokyo');
  assert.equal(trip2.nodes[1].id, 'stay-x');

  // Downstream mutator must not throw against the sanitized shape.
  assert.doesNotThrow(() => s.setNodes('trip-1', [tokyo]));
});

test('plan trip nodes are kept ordered by start regardless of insertion order', () => {
  const s = createTripStore({ storage: fakeStorage() });
  const plan = s.ensurePlanTrip();
  s.setNodes(plan.id, [
    { ...tokyo, id: 'stay-nov', start: 11, len: 4 },
    { ...lima, id: 'stay-jan', start: 1, len: 3 },
    { ...tokyo, id: 'stay-jun', start: 6, len: 2 },
  ]);
  assert.deepEqual(
    s.getPlanTrip().nodes.map((n) => n.id),
    ['stay-jan', 'stay-jun', 'stay-nov'],
  );
});
