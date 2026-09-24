import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessCyclones,
  assessFires,
  assessHelp,
  assessSeismic,
  assessWeather,
  distanceKm,
  formatAge,
  helpPointQuery,
  matchFlight,
  overallRisk,
  parseTravelParams,
  toHelpPoint,
  travelUrl,
  withinRadius,
} from './briefing.js';
import { sanitizeOverpassBody } from '../../server/providers/overpass/query.js';

const LISBON = { lat: 38.7223, lon: -9.1393 };
const TOKYO = { lat: 35.6762, lon: 139.6503 };
// One degree of latitude is ~111 km.
const north = (km) => ({ lat: LISBON.lat + km / 111.2, lon: LISBON.lon });
const quake = (mag, km) => ({ mag, ...north(km), time: 0, place: 'x' });

test('distance filtering keeps rows inside the radius, nearest first', () => {
  assert.ok(Math.abs(distanceKm(LISBON, north(100)) - 100) < 1);
  const rows = withinRadius([north(250), north(20), north(400)], LISBON, 300);
  assert.deepEqual(
    rows.map((r) => Math.round(r.distanceKm)),
    [20, 250],
  );
});

test('seismic rules escalate by magnitude and distance', () => {
  assert.equal(assessSeismic([], LISBON).status, 'low');
  assert.equal(assessSeismic([quake(3, 900)], LISBON).status, 'low');
  assert.equal(assessSeismic([quake(3, 250)], LISBON).status, 'moderate');
  assert.equal(assessSeismic([quake(4.6, 200)], LISBON).status, 'moderate');
  assert.equal(assessSeismic([quake(4.6, 120)], LISBON).status, 'elevated');
  assert.equal(assessSeismic([quake(6.1, 290)], LISBON).status, 'high');
});

test('cyclones are unavailable outside NHC basins and escalate by nearest approach', () => {
  assert.equal(assessCyclones({ storms: [] }, TOKYO).status, 'unavailable');
  assert.match(assessCyclones({ storms: [] }, TOKYO).summary, /Atlantic/);
  assert.equal(assessCyclones({ unavailable: true, storms: [] }, LISBON).status, 'unavailable');
  const storm = (km, extra = {}) => ({
    name: 'Fay',
    position: { latitude: north(km).lat, longitude: LISBON.lon },
    forecastPoints: [],
    cone: null,
    ...extra,
  });
  assert.equal(assessCyclones({ storms: [storm(900)] }, LISBON).status, 'low');
  assert.equal(assessCyclones({ storms: [storm(450)] }, LISBON).status, 'elevated');
  assert.equal(assessCyclones({ storms: [storm(200)] }, LISBON).status, 'high');
  const forecastNear = storm(900, {
    forecastPoints: [{ position: { latitude: north(250).lat, longitude: LISBON.lon } }],
  });
  assert.equal(assessCyclones({ storms: [forecastNear] }, LISBON).status, 'high');
  const box = (d) => [
    [LISBON.lon - d, LISBON.lat - d],
    [LISBON.lon + d, LISBON.lat - d],
    [LISBON.lon + d, LISBON.lat + d],
    [LISBON.lon - d, LISBON.lat + d],
    [LISBON.lon - d, LISBON.lat - d],
  ];
  const coneOver = storm(2000, { cone: { type: 'Polygon', coordinates: [box(20)] } });
  assert.equal(assessCyclones({ storms: [coneOver] }, LISBON).items[0].distanceKm, 0);
});

test('weather rules flag severe codes, strong wind and low visibility', () => {
  assert.equal(assessWeather(null).status, 'unavailable');
  const calm = { weatherCode: 0, windKph: 10, visibilityM: 20000, temperatureC: 21.6 };
  assert.equal(assessWeather(calm).status, 'low');
  assert.equal(assessWeather(calm).summary, 'Clear · 22°C · wind 10 km/h');
  assert.equal(assessWeather({ ...calm, windKph: 45 }).status, 'moderate');
  assert.equal(assessWeather({ ...calm, visibilityM: 400 }).status, 'moderate');
  assert.equal(assessWeather({ ...calm, windKph: 70 }).status, 'elevated');
  assert.equal(assessWeather({ ...calm, weatherCode: 95 }).status, 'elevated');
});

test('fire rules use 10 km and 50 km bands and report a missing key', () => {
  assert.equal(assessFires({ keyRequired: true }, LISBON).status, 'unavailable');
  assert.equal(assessFires({ fires: [north(80)] }, LISBON).status, 'low');
  assert.equal(assessFires({ fires: [north(30)] }, LISBON).status, 'elevated');
  assert.equal(assessFires({ fires: [north(30), north(5)] }, LISBON).status, 'high');
});

test('overpass elements map to help points and group by kind', () => {
  assert.deepEqual(
    toHelpPoint({ type: 'way', id: 7, center: { lat: 1, lon: 2 }, tags: { amenity: 'hospital', name: 'São José' } }),
    { id: 'way/7', kind: 'medical', name: 'São José', phone: null, emergency: false, lat: 1, lon: 2 },
  );
  assert.equal(toHelpPoint({ id: 1, lat: 1, lon: 2, tags: { office: 'diplomatic' } }).kind, 'embassy');
  assert.equal(toHelpPoint({ id: 1, lat: 1, lon: 2, tags: { office: 'diplomatic' } }).name, 'Embassy');
  assert.equal(toHelpPoint({ id: 1, lat: 1, lon: 2, tags: { amenity: 'bar' } }), null);
  assert.equal(toHelpPoint({ id: 1, tags: { amenity: 'police' } }), null);

  const near = north(2);
  const help = assessHelp(
    [
      { type: 'node', id: 1, ...near, tags: { amenity: 'hospital' } },
      { type: 'node', id: 1, ...near, tags: { amenity: 'hospital' } },
      { type: 'node', id: 2, ...north(1), tags: { amenity: 'embassy' } },
      { type: 'node', id: 3, ...north(40), tags: { amenity: 'police' } },
    ],
    LISBON,
  );
  assert.equal(help.status, 'info');
  assert.equal(help.summary, '1 hospital, 1 embassy within 10 km');
  assert.equal(help.groups.find((g) => g.id === 'police').points.length, 0);
  assert.equal(assessHelp({ rateLimited: true }, LISBON).status, 'unavailable');
  assert.equal(assessHelp(null, LISBON).status, 'unavailable');
});

test('help query stays inside the proxy bounds', () => {
  const query = helpPointQuery(LISBON);
  assert.match(query, /\[timeout:25\]/);
  assert.equal([...query.matchAll(/around:10000,38\.72230,-9\.13930/g)].length, 2);
  assert.match(query, /out center;/);
  assert.equal(sanitizeOverpassBody(`data=${encodeURIComponent(query)}`).ok, true);
});

test('overall risk is the worst rated section and names the driver', () => {
  const overall = overallRisk({
    seismic: { status: 'moderate', reason: '2 quakes' },
    weather: { status: 'low' },
    fires: { status: 'unavailable' },
    cyclones: { status: 'unavailable' },
    help: { status: 'info' },
  });
  assert.equal(overall.status, 'moderate');
  assert.deepEqual(overall.drivers, [{ id: 'seismic', label: 'Seismic', reason: '2 quakes' }]);
  assert.deepEqual(overall.notChecked, ['Cyclones', 'Fires']);
  assert.equal(overallRisk({ fires: { status: 'unavailable' } }).status, 'unavailable');
  assert.equal(overallRisk({ weather: { status: 'loading' } }).status, 'unavailable');
});

test('flight lookup matches callsigns exactly after normalisation', () => {
  const records = [{ callsign: 'TP13501 ' }, { callsign: 'TP1350  ' }];
  assert.equal(matchFlight(records, ' tp 1350'), records[1]);
  assert.equal(matchFlight(records, 'TP135'), null);
  assert.equal(matchFlight(records, ''), null);
});

test('travel URL params parse and rewrite without touching the hash', () => {
  assert.deepEqual(parseTravelParams('?mode=travel&dest=%20Lisbon%20'), { active: true, dest: 'Lisbon' });
  assert.deepEqual(parseTravelParams('?dest=Lisbon'), { active: false, dest: 'Lisbon' });
  assert.deepEqual(parseTravelParams(''), { active: false, dest: null });
  const href = 'http://x.test/?keep=1#style=normal';
  assert.equal(travelUrl(href, { active: true, dest: 'São Paulo' }), '/?keep=1&mode=travel&dest=S%C3%A3o+Paulo#style=normal');
  assert.equal(
    travelUrl('http://x.test/?keep=1&mode=travel&dest=Lisbon#h', { active: false }),
    '/?keep=1#h',
  );
});

test('freshness labels', () => {
  assert.equal(formatAge(10_000), 'just now');
  assert.equal(formatAge(125_000), '2m ago');
  assert.equal(formatAge(3 * 3_600_000), '3h ago');
});
