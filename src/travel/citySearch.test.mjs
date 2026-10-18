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
  {
    id: 'medellin-colombia',
    name: 'Medellín',
    country: 'Colombia',
    pop: 2.5e6,
    airport: { iata: 'MDE', type: 'medium', km: 30 },
  },
  {
    id: 'malaga-spain',
    name: 'Málaga',
    country: 'Spain',
    pop: 5.7e5,
    airport: { iata: 'AGP', type: 'medium', km: 8 },
  },
  {
    id: 'saopaulo-brazil',
    name: 'São Paulo',
    country: 'Brazil',
    pop: 12e6,
    airport: { iata: 'GRU', type: 'large', km: 24 },
    capital: true,
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

test('diacritic- and case-folded queries still find their accented cities', () => {
  assert.equal(searchCities(cities, 'Medellin')[0].id, 'medellin-colombia');
  assert.equal(searchCities(cities, 'MEDELLIN')[0].id, 'medellin-colombia');
  assert.equal(searchCities(cities, 'Malaga')[0].id, 'malaga-spain');
  assert.equal(searchCities(cities, 'Sao Paulo')[0].id, 'saopaulo-brazil');
  // Accented query still finds the accented city (identity case).
  assert.equal(searchCities(cities, 'São Paulo')[0].id, 'saopaulo-brazil');
});
