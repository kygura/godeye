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

test('addNode creates a trip, persists, and reloads from storage', () => {
  const storage = fakeStorage();
  const a = createTripStore({ storage });
  let seen = 0;
  a.subscribe(() => seen++);
  a.addNode(tokyo);
  a.addNode(lima);
  assert.equal(a.getActiveTrip().nodes.length, 2);
  assert.ok(seen >= 2);
  const b = createTripStore({ storage });
  assert.equal(b.getActiveTrip().nodes[1].name, 'Lima');
  assert.ok(storage.map.has(STORAGE_KEY));
});

test('reorder, remove, shortlist and corrupt storage', () => {
  const storage = fakeStorage();
  storage.setItem(STORAGE_KEY, '{not json');
  const s = createTripStore({ storage });
  assert.deepEqual(s.getState().trips, []);
  s.addNode(tokyo);
  s.addNode(lima);
  assert.ok(s.reorder(1, 0));
  assert.equal(s.getActiveTrip().nodes[0].name, 'Lima');
  assert.ok(s.removeNodeAt(0));
  assert.ok(!s.removeNodeAt(5));
  assert.equal(s.toggleShortlist('lima-peru'), true);
  assert.equal(s.toggleShortlist('lima-peru'), false);
  const id = s.getActiveTrip().id;
  assert.ok(s.removeTrip(id));
  assert.equal(s.getActiveTrip(), null);
  assert.equal(createTripStore({ storage: null }).getState().trips.length, 0);
});

test('clearTrip empties nodes without deleting the trip', () => {
  const s = createTripStore({ storage: fakeStorage() });
  s.addNode(tokyo);
  s.addNode(lima);
  const id = s.getActiveTrip().id;
  assert.ok(s.clearTrip());
  assert.equal(s.getActiveTrip().id, id);
  assert.deepEqual(s.getActiveTrip().nodes, []);
  assert.equal(s.clearTrip(), false);
  assert.equal(s.clearTrip('does-not-exist'), false);
});

test('addNode, reorder and removeNodeAt preserve unknown node fields', () => {
  const s = createTripStore({ storage: fakeStorage() });
  s.addNode({ ...tokyo, id: 'stay-1', start: 6, len: 2 });
  s.addNode({ ...lima, id: 'stay-2', start: 1, len: 3 });
  const [a, b] = s.getActiveTrip().nodes;
  assert.equal(a.id, 'stay-1');
  assert.equal(a.start, 6);
  assert.equal(a.len, 2);
  assert.equal(b.id, 'stay-2');
  s.reorder(0, 1);
  assert.equal(s.getActiveTrip().nodes[1].id, 'stay-1');
  assert.equal(s.getActiveTrip().nodes[1].len, 2);
  s.removeNodeAt(0);
  assert.equal(s.getActiveTrip().nodes.length, 1);
  assert.equal(s.getActiveTrip().nodes[0].id, 'stay-1');
  assert.equal(s.getActiveTrip().nodes[0].start, 6);
});

test('ensurePlanTrip creates the plan trip once, without stealing activeTripId, and is idempotent', () => {
  const s = createTripStore({ storage: fakeStorage() });
  s.addNode(tokyo); // an ordinary trip, becomes active
  const ordinaryId = s.getActiveTrip().id;
  assert.equal(s.getPlanTrip(), null);
  const plan = s.ensurePlanTrip();
  assert.equal(plan.kind, 'plan');
  assert.equal(plan.name, 'Lifestyle plan');
  assert.equal(plan.nodes.length, 0);
  assert.equal(
    s.getActiveTrip().id,
    ordinaryId,
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

  const ordinary = s.createTrip();
  assert.ok(s.setNodes(ordinary.id, [tokyo, lima]));
  assert.deepEqual(
    s.getActiveTrip().nodes.map((n) => n.name),
    ['Tokyo', 'Lima'],
  );
  assert.equal(s.setNodes('does-not-exist', []), false);
});

test('load sanitizes malformed shapes: bad trips and bad nodes are dropped, no throw', () => {
  const storage = fakeStorage();
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      activeTripId: 'trip-1',
      shortlist: [],
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
  assert.equal(s.getState().trips.length, 2);
  const trip1 = s.getState().trips.find((t) => t.id === 'trip-1');
  assert.equal(trip1.extra, 'kept');
  assert.deepEqual(trip1.nodes, []);
  const trip2 = s.getState().trips.find((t) => t.id === 'trip-2');
  assert.equal(trip2.nodes.length, 2);
  assert.equal(trip2.nodes[0].name, 'Tokyo');
  assert.equal(trip2.nodes[1].id, 'stay-x');

  // Downstream mutators must not throw against the sanitized shape.
  assert.doesNotThrow(() => s.addNode(lima, 'trip-1'));
  assert.doesNotThrow(() => s.reorder(0, 1, 'trip-2'));
  assert.doesNotThrow(() => s.removeNodeAt(0, 'trip-2'));
  assert.doesNotThrow(() => s.setNodes('trip-1', [tokyo]));
});

test('plan trip nodes are kept ordered by start regardless of insertion order', () => {
  const s = createTripStore({ storage: fakeStorage() });
  const plan = s.ensurePlanTrip();
  s.addNode({ ...tokyo, id: 'stay-nov', start: 11, len: 4 }, plan.id);
  s.addNode({ ...lima, id: 'stay-jan', start: 1, len: 3 }, plan.id);
  s.addNode({ ...tokyo, id: 'stay-jun', start: 6, len: 2 }, plan.id);
  assert.deepEqual(
    s.getPlanTrip().nodes.map((n) => n.id),
    ['stay-jan', 'stay-jun', 'stay-nov'],
  );
});
