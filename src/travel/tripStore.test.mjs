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
