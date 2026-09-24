import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCities } from './citySearch.js';

const cities = [
  {
    id: 'paris-france',
    name: 'Paris',
    country: 'France',
    pop: 9e6,
    airport: { iata: 'CDG', type: 'large', km: 25 },
    capital: true,
  },
  {
    id: 'paris-united-states',
    name: 'Paris',
    country: 'United States',
    pop: 25000,
    airport: null,
  },
  {
    id: 'lyon-france',
    name: 'Lyon',
    country: 'France',
    pop: 1.5e6,
    airport: { iata: 'LYS', type: 'medium', km: 12 },
  },
  {
    id: 'nice-france',
    name: 'Nice',
    country: 'France',
    pop: 3e5,
    airport: null,
  },
];

test('capital with a large airport outranks a namesake', () => {
  assert.equal(searchCities(cities, 'paris')[0].id, 'paris-france');
  assert.equal(searchCities(cities, 'lys')[0].id, 'lyon-france');
});

test('a country query lists its airport cities first', () => {
  const ids = searchCities(cities, 'fran').map((c) => c.id);
  assert.deepEqual(ids, ['paris-france', 'lyon-france', 'nice-france']);
  assert.deepEqual(searchCities(cities, ''), []);
});
