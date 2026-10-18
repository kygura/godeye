import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  cityIntelProxy,
  parseAdvisories,
  parseVisaCsv,
  isValidPassport,
  parseZoriCsv,
  parseAirResponse,
  isValidLat,
  isValidLon,
} from '../../server/providers/cityIntel.js';

// ---------------------------------------------------------------------------
// Normaliser fixtures
// ---------------------------------------------------------------------------

function advisory(overrides = {}) {
  return {
    Title: 'Germany - Level 2: Exercise Increased Caution',
    Link: 'https://travel.state.gov/content/tsg_aem/us/en/home/international-travel/travel-advisories/destination.deu.html',
    Category: ['GM'],
    Summary: '<p>irrelevant html</p>',
    Updated: '2025-05-12T20:00:00-04:00',
    ...overrides,
  };
}

test('parseAdvisories: slug ISO3 wins, FIPS fallback resolves Kosovo, drops what it cannot map', () => {
  const { byIso3 } = parseAdvisories([
    advisory(),
    advisory({
      Title: 'Kosovo - Level 2: Exercise Increased Caution',
      Link: 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/kosovo-travel-advisory.html',
      Category: ['KV'],
    }),
    // no Category, no ISO3 slug -> unmappable, dropped
    advisory({
      Title: 'Macau - Level 3: Reconsider Travel',
      Link: 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/macau-travel-advisory.html',
      Category: [],
    }),
    // no `Level N` in title -> dropped
    advisory({ Title: 'Somewhere with no level', Category: ['XX'] }),
  ]);
  assert.deepEqual(byIso3.DEU, {
    level: 2,
    title: 'Level 2: Exercise Increased Caution',
    updated: '2025-05-13T00:00:00.000Z',
    url: advisory().Link,
  });
  assert.equal(byIso3.XKX.level, 2);
  assert.equal(Object.keys(byIso3).length, 2);
  assert.doesNotMatch(
    JSON.stringify(byIso3),
    /irrelevant html/,
    'Summary HTML must not ship',
  );
});

test('parseAdvisories: dedupe keeps the highest level, then the most recent, across FIPS-fallback duplicates', () => {
  // Burma "listed twice": both map via the BM FIPS fallback.
  const { byIso3 } = parseAdvisories([
    advisory({
      Title: 'Burma - Level 3: Reconsider Travel',
      Link: 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/burma-travel-advisory-old.html',
      Category: ['BM'],
      Updated: '2020-01-01T00:00:00-04:00',
    }),
    advisory({
      Title: 'Burma - Level 4: Do Not Travel',
      Link: 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/burma-travel-advisory.html',
      Category: ['BM'],
      Updated: '2026-05-07T20:00:00-04:00',
    }),
  ]);
  assert.equal(byIso3.MMR.level, 4);

  // Israel / West Bank / Gaza: three records, one ISO3 (IS fallback), keep the highest level.
  const israel = parseAdvisories([
    advisory({
      Title: 'Israel - Level 3: Reconsider Travel - Level 3: Reconsider Travel',
      Link: 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/israel-west-bank-and-gaza-travel-advisory.html',
      Category: ['IS'],
      Updated: '2026-08-01T00:00:00-04:00',
    }),
    advisory({
      Title: 'Gaza - Level 4: Do Not Travel',
      Link: 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/Gaza.html',
      Category: ['IS'],
      Updated: '2026-08-25T20:00:00-04:00',
    }),
  ]).byIso3;
  assert.equal(israel.ISR.level, 4);
  assert.equal(israel.ISR.title, 'Level 4: Do Not Travel');
});

test('parseAdvisories rejects a non-array payload', () => {
  assert.throws(() => parseAdvisories({}));
});

test('parseAdvisories drops unsafe Link protocols (javascript:/data:), keeps http(s)', () => {
  const record = (link) =>
    advisory({
      Title: 'Greece - Level 2: Exercise Increased Caution',
      Category: ['GR'],
      Link: link,
    });
  assert.equal(
    parseAdvisories([record('javascript:alert(1)')]).byIso3.GRC.url,
    '',
  );
  assert.equal(
    parseAdvisories([record('data:text/html,<script>1</script>')]).byIso3.GRC
      .url,
    '',
  );
  const safe =
    'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/greece-travel-advisory.html';
  assert.equal(parseAdvisories([record(safe)]).byIso3.GRC.url, safe);
});

test('visa CSV: numeric max-stay, -1 sentinel and lowercased strings; invalid rows skipped', () => {
  const csv = [
    'Passport,Destination,Requirement',
    'PRT,ALB,90',
    'PRT,AND,visa free',
    'PRT,USA,ETA',
    'PRT,ZZZ,-1',
    'XY,USA,10', // invalid passport (2 chars) -> skipped
  ].join('\n');
  const byPassport = parseVisaCsv(csv);
  assert.deepEqual(byPassport.PRT, {
    ALB: 90,
    AND: 'visa free',
    USA: 'eta',
    ZZZ: -1,
  });
  assert.equal(byPassport.XY, undefined, 'invalid passport row skipped');
  assert.equal(byPassport.ZZZ, undefined, 'unknown passport');
  assert.equal(isValidPassport('PRT'), true);
  assert.equal(isValidPassport('prt'), false);
  assert.equal(isValidPassport('PR'), false);
});

test('ZORI CSV: quoted comma-bearing names, hyphen-split principal, per-metro latest non-empty month', () => {
  const csv = [
    'RegionID,SizeRank,RegionName,RegionType,StateName,2024-01-31,2024-02-29,2024-03-31',
    '102001,0,United States,country,,1000,1010,1020',
    '1,1,"New York, NY",msa,NY,2000,2010,',
    '2,2,"Dallas-Fort Worth, TX",msa,TX,1500,,1550',
  ].join('\n');
  const { latestMonth, metros } = parseZoriCsv(csv);
  assert.equal(latestMonth, '2024-03');
  assert.equal(metros.length, 2, 'country row is skipped');
  const ny = metros.find((m) => m.regionId === '1');
  assert.equal(ny.principal, 'New York');
  assert.equal(ny.zori, 2010);
  assert.equal(
    ny.month,
    '2024-02',
    'March is empty, falls back to the latest filled month',
  );
  const dfw = metros.find((m) => m.regionId === '2');
  assert.equal(dfw.principal, 'Dallas');
  assert.equal(dfw.zori, 1550);
  assert.equal(dfw.month, '2024-03');
});

test('ZORI CSV: columns validated by header name, order-independent; missing header throws', () => {
  const reordered = [
    'StateName,RegionType,RegionName,SizeRank,RegionID,2024-01-31',
    'NY,msa,"New York, NY",1,1,2010',
  ].join('\n');
  const { metros } = parseZoriCsv(reordered);
  assert.equal(metros.length, 1);
  assert.equal(metros[0].regionId, '1');
  assert.equal(metros[0].state, 'NY');
  assert.equal(metros[0].zori, 2010);

  const missingHeader = [
    'RegionID,SizeRank,RegionName,RegionType,2024-01-31', // no StateName
    '1,1,"New York, NY",msa,2010',
  ].join('\n');
  assert.throws(() => parseZoriCsv(missingHeader));
});

test('air quality: parses current reading and units, echoes back the requested (rounded) coordinates', () => {
  const payload = {
    current: { time: '2026-09-24T11:00', pm2_5: 11.5, european_aqi: 40 },
    current_units: { pm2_5: 'μg/m³', european_aqi: 'EAQI' },
  };
  assert.deepEqual(parseAirResponse(payload, 38.72, -9.14), {
    lat: 38.72,
    lon: -9.14,
    time: '2026-09-24T11:00',
    pm25: 11.5,
    europeanAqi: 40,
    units: { pm25: 'μg/m³', europeanAqi: 'EAQI' },
  });
  assert.throws(() => parseAirResponse({}, 0, 0));
});

test('lat/lon validation accepts the full range and rejects out-of-range/non-finite', () => {
  for (const v of [-90, 0, 90]) assert.equal(isValidLat(v), true);
  for (const v of [-180, 0, 180]) assert.equal(isValidLon(v), true);
  for (const v of [90.1, -91, NaN, Infinity])
    assert.equal(isValidLat(v), false);
  for (const v of [180.1, -181, NaN, Infinity])
    assert.equal(isValidLon(v), false);
});

// ---------------------------------------------------------------------------
// Handler (stubbed fetchImpl)
// ---------------------------------------------------------------------------

function install(options = {}) {
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'city-intel-test-'));
  let handler;
  const plugin = cityIntelProxy({ cacheDir, ...options });
  plugin.configureServer({
    middlewares: {
      use(p, callback) {
        assert.equal(p, '/api/city-intel');
        handler = callback;
      },
    },
  });
  const makeRes = () => {
    const res = new EventEmitter();
    res.writeHead = (code, headers) => {
      res.statusCode = code;
      res.headers = headers;
    };
    res.end = (body) => {
      res.body = body;
    };
    return res;
  };
  const request = (url = '/advisories', method = 'GET') => {
    const res = makeRes();
    return handler({ url, method }, res).then(() => res);
  };
  // Like `request`, but returns immediately with the raw `res` (an
  // EventEmitter) alongside the still-pending completion promise, so a test
  // can simulate the client going away mid-flight via `res.emit('close')`.
  const requestRaw = (url = '/advisories', method = 'GET') => {
    const res = makeRes();
    const done = handler({ url, method }, res).then(() => res);
    return { res, done };
  };
  return {
    request,
    requestRaw,
    cleanup: () => rmSync(cacheDir, { recursive: true, force: true }),
  };
}
const body = (res) => JSON.parse(res.body);

const ADVISORY_FIXTURE = [advisory()];
const VISA_CSV = 'Passport,Destination,Requirement\nPRT,ALB,90\n';
const VISA_COMMITS = [
  { commit: { committer: { date: '2025-01-12T00:00:00Z' } } },
];
const ZORI_CSV =
  'RegionID,SizeRank,RegionName,RegionType,StateName,2024-01-31\n1,1,"New York, NY",msa,NY,2010\n';
const AIR_PAYLOAD = {
  current: { time: '2026-09-24T11:00', pm2_5: 11.5, european_aqi: 40 },
  current_units: { pm2_5: 'μg/m³', european_aqi: 'EAQI' },
};

function stubFetch(calls, { fail = false } = {}) {
  return async (url) => {
    calls.push(String(url));
    if (fail) throw new Error('simulated upstream failure');
    if (url.includes('TravelAdvisories'))
      return Response.json(ADVISORY_FIXTURE);
    if (url.includes('api.github.com')) return Response.json(VISA_COMMITS);
    if (url.includes('passport-index-tidy-iso3.csv'))
      return new Response(VISA_CSV);
    if (url.includes('Metro_zori')) return new Response(ZORI_CSV);
    if (url.includes('air-quality-api')) return Response.json(AIR_PAYLOAD);
    throw new Error(`unexpected url ${url}`);
  };
}

test('advisories: cache hit serves 2 requests from 1 upstream call, with correct envelope', async () => {
  const calls = [];
  const { request, cleanup } = install({ fetchImpl: stubFetch(calls) });
  try {
    const first = body(await request('/advisories'));
    assert.equal(first.ok, true);
    assert.equal(first.stale, false);
    assert.equal(first.data.byIso3.DEU.level, 2);
    assert.equal(first.source.name, 'US State Dept Travel Advisories');
    await request('/advisories');
    assert.equal(calls.length, 1);
  } finally {
    cleanup();
  }
});

test('advisories: serves stale data past the TTL once upstream starts failing', async () => {
  let clock = 1_000_000;
  let impl = stubFetch([]);
  const { request, cleanup } = install({
    fetchImpl: (...args) => impl(...args),
    now: () => clock,
  });
  try {
    const first = body(await request('/advisories'));
    assert.equal(first.stale, false);
    clock += 6 * 3600_000 + 1; // past the 6h TTL
    impl = async () => {
      throw new Error('simulated upstream failure');
    };
    const second = body(await request('/advisories'));
    assert.equal(second.stale, true);
    assert.deepEqual(second.data, first.data);
  } finally {
    cleanup();
  }
});

test('502 with a sanitized error when nothing has ever been cached and upstream fails', async () => {
  const { request, cleanup } = install({
    fetchImpl: async () => {
      throw new Error('private upstream detail');
    },
  });
  try {
    const res = await request('/advisories');
    assert.equal(res.statusCode, 502);
    assert.equal(body(res).ok, false);
    assert.equal(body(res).error, 'upstream-unavailable');
    assert.doesNotMatch(res.body, /private upstream detail/);
  } finally {
    cleanup();
  }
});

test('visa: invalid/unknown passport, and a normal lookup carrying the commit year', async () => {
  const calls = [];
  const { request, cleanup } = install({ fetchImpl: stubFetch(calls) });
  try {
    assert.equal((await request('/visa?passport=xx')).statusCode, 400);
    assert.equal(
      body(await request('/visa?passport=xx')).error,
      'invalid-passport',
    );
    assert.equal((await request('/visa?passport=ZZZ')).statusCode, 404);
    const ok = body(await request('/visa?passport=PRT'));
    assert.equal(ok.ok, true);
    assert.equal(ok.data.passport, 'PRT');
    assert.equal(ok.data.year, 2025);
    assert.deepEqual(ok.data.byDest, { ALB: 90 });
  } finally {
    cleanup();
  }
});

test('rent: parses ZORI and air: validates coordinates and rounds to 2dp', async () => {
  const calls = [];
  const { request, cleanup } = install({ fetchImpl: stubFetch(calls) });
  try {
    const rent = body(await request('/rent'));
    assert.equal(rent.data.metros[0].name, 'New York, NY');
    assert.equal((await request('/air?lat=999&lon=0')).statusCode, 400);
    const air = body(await request('/air?lat=38.7201&lon=-9.1449'));
    assert.equal(air.data.lat, 38.72);
    assert.equal(air.data.lon, -9.14);
  } finally {
    cleanup();
  }
});

test('method and route rejection: POST is 405, unknown sub-route is 404', async () => {
  const { request, cleanup } = install({ fetchImpl: stubFetch([]) });
  try {
    const posted = await request('/advisories', 'POST');
    assert.equal(posted.statusCode, 405);
    assert.equal(body(posted).error, 'method-not-allowed');
    assert.equal((await request('/nope')).statusCode, 404);
  } finally {
    cleanup();
  }
});

test('single-flight: a disconnecting client does not abort the shared refresh for a concurrent rider', async () => {
  const calls = [];
  let resolveAdvisories;
  const gate = new Promise((resolve) => {
    resolveAdvisories = resolve;
  });
  const fetchImpl = async (url) => {
    calls.push(String(url));
    await gate;
    return Response.json(ADVISORY_FIXTURE);
  };
  // No disk cache, so both requests reach the single-flight check on the
  // same tick instead of racing on a real fs read.
  const { requestRaw, cleanup } = install({ fetchImpl, cacheDir: null });
  try {
    const first = requestRaw('/advisories');
    const second = requestRaw('/advisories');
    // Let both requests reach the shared inflight/race point before either
    // upstream call or client disconnect happens.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1, 'single-flight: one upstream call started');

    first.res.emit('close'); // first client goes away mid-refresh
    resolveAdvisories(); // shared upstream call now completes

    const secondRes = body(await second.done);
    assert.equal(secondRes.ok, true);
    assert.equal(secondRes.data.byIso3.DEU.level, 2);
    assert.equal(
      calls.length,
      1,
      "first client's disconnect must not trigger a second upstream call",
    );
  } finally {
    cleanup();
  }
});

test('failure cooldown: stops hammering upstream after a failed refresh, doubles on repeats, resets on success', async () => {
  let clock = 1_000_000;
  const calls = [];
  let impl = stubFetch(calls);
  const { request, cleanup } = install({
    fetchImpl: (...args) => impl(...args),
    now: () => clock,
  });
  try {
    const first = body(await request('/advisories'));
    assert.equal(first.stale, false);
    assert.equal(calls.length, 1);

    // TTL elapses, upstream starts failing.
    clock += 6 * 3600_000 + 1;
    impl = async (url) => {
      calls.push(String(url));
      throw new Error('simulated upstream failure');
    };
    const failed1 = body(await request('/advisories'));
    assert.equal(failed1.stale, true);
    assert.equal(calls.length, 2, 'first failed refresh attempt');

    // Still within the 60s base cooldown: no new upstream call at all.
    clock += 30_000;
    const cooling = body(await request('/advisories'));
    assert.equal(cooling.stale, true);
    assert.equal(calls.length, 2, 'cooldown skips upstream entirely');

    // Past 60s: retries, fails again, cooldown doubles to ~120s.
    clock += 31_000;
    const failed2 = body(await request('/advisories'));
    assert.equal(failed2.stale, true);
    assert.equal(calls.length, 3);

    // 61s after the second failure: still within the doubled cooldown.
    clock += 61_000;
    const stillCooling = body(await request('/advisories'));
    assert.equal(stillCooling.stale, true);
    assert.equal(calls.length, 3, 'doubled cooldown still active');

    // Past 120s: retries and this time succeeds -> cooldown resets.
    clock += 60_000;
    impl = stubFetch(calls);
    const recovered = body(await request('/advisories'));
    assert.equal(recovered.stale, false);
    assert.equal(calls.length, 4);
  } finally {
    cleanup();
  }
});
