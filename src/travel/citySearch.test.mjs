import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCities } from './citySearch.js';

const cities = [
  { id: 'paris-france', name: 'Paris', country: 'France', pop: 9e6, iata: 'CDG', hub: 'large', capital: true },
  { id: 'paris-united-states', name: 'Paris', country: 'United States', pop: 25000 },
  { id: 'lyon-france', name: 'Lyon', country: 'France', pop: 1.5e6, iata: 'LYS', hub: 'medium' },
  { id: 'nice-france', name: 'Nice', country: 'France', pop: 3e5 },
];

test('capital with a large hub outranks a namesake', () => {
  assert.equal(searchCities(cities, 'paris')[0].id, 'paris-france');
  assert.equal(searchCities(cities, 'lys')[0].id, 'lyon-france');
});

test('a country query lists its airport cities first', () => {
  const ids = searchCities(cities, 'fran').map((c) => c.id);
  assert.deepEqual(ids, ['paris-france', 'lyon-france', 'nice-france']);
  assert.deepEqual(searchCities(cities, ''), []);
});
