import test from 'node:test';
import assert from 'node:assert/strict';
import { createTripStore, STORAGE_KEY } from './tripStore.js';

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), map: m };
};
const tokyo = { cityId: 'tokyo-japan', name: 'Tokyo', lat: 35.7, lng: 139.7, iata: 'HND' };
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
