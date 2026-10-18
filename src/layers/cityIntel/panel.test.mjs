import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESET_WEIGHTS,
  clampWeight,
  matchPreset,
  isAllZero,
  rankIndexMap,
  flatRowModels,
  groupedRowModels,
  paginateModels,
  hasMoreModels,
  togglePin,
  applyPinSet,
  nextRovingIndex,
  stepRadioIndex,
  serializePersistedState,
  parsePersistedState,
  loadPersisted,
  savePersisted,
  sanitizeOverrides,
  refineSummaryText,
  createCityIntelPanel,
} from './panel.js';

const scoredCity = (id, overrides = {}) => ({
  id,
  city: { name: id, country: 'Testland', iso3: 'TST', lat: 0, lon: 0 },
  composite: 50,
  eligible: true,
  reason: null,
  coverage: {
    pillarsAvailable: 4,
    cityLevelMetrics: 1,
    text: '4 of 4 pillars',
  },
  pillars: {},
  ...overrides,
});

// -- weights / presets -------------------------------------------------------

test('clampWeight rounds and clamps to the 0-10 slider domain', () => {
  assert.equal(clampWeight(5), 5);
  assert.equal(clampWeight(5.6), 6);
  assert.equal(clampWeight(-3), 0);
  assert.equal(clampWeight(15), 10);
  assert.equal(clampWeight('7'), 7);
  assert.equal(clampWeight(NaN), 0);
  assert.equal(clampWeight(undefined), 0);
});

test('matchPreset recognizes the three named presets and CUSTOM otherwise', () => {
  assert.equal(matchPreset(PRESET_WEIGHTS.BALANCED), 'BALANCED');
  assert.equal(matchPreset(PRESET_WEIGHTS.BUDGET), 'BUDGET');
  assert.equal(matchPreset(PRESET_WEIGHTS.SAFETY), 'SAFETY');
  assert.equal(
    matchPreset({ qol: 5, cost: 5, safety: 5, travel: 6 }),
    'CUSTOM',
  );
});

test('isAllZero is true only when every pillar weight is 0', () => {
  assert.equal(isAllZero({ qol: 0, cost: 0, safety: 0, travel: 0 }), true);
  assert.equal(isAllZero({ qol: 0, cost: 0, safety: 1, travel: 0 }), false);
});

// -- row view models ----------------------------------------------------------

test('rankIndexMap assigns 1-based ranks in array order', () => {
  const map = rankIndexMap([scoredCity('a'), scoredCity('b'), scoredCity('c')]);
  assert.equal(map.get('a'), 1);
  assert.equal(map.get('b'), 2);
  assert.equal(map.get('c'), 3);
});

test('flatRowModels wraps every city at depth 0 with its rank', () => {
  const flat = [scoredCity('a'), scoredCity('b')];
  const models = flatRowModels(flat, rankIndexMap(flat));
  assert.equal(models.length, 2);
  assert.deepEqual(
    models.map((m) => [m.kind, m.depth, m.rank]),
    [
      ['city', 0, 1],
      ['city', 0, 2],
    ],
  );
});

test('groupedRowModels: collapsed group hides its extra cities', () => {
  const lisbon = scoredCity('lisbon');
  const porto = scoredCity('porto');
  const flat = [lisbon, porto];
  const rankMap = rankIndexMap(flat);
  const groups = [
    { iso3: 'PRT', country: 'Portugal', cities: [lisbon, porto] },
  ];
  const collapsed = groupedRowModels(groups, rankMap);
  assert.deepEqual(
    collapsed.map((m) => m.kind),
    ['group'],
  );
  assert.equal(collapsed[0].moreCount, 1);
  assert.equal(collapsed[0].expanded, false);
});

test('groupedRowModels: expanded group lists its children at depth 1, keeping true rank', () => {
  const lisbon = scoredCity('lisbon');
  const porto = scoredCity('porto');
  const valencia = scoredCity('valencia');
  // Global order interleaves countries: lisbon(1), valencia(2), porto(3).
  const flat = [lisbon, valencia, porto];
  const rankMap = rankIndexMap(flat);
  const groups = [
    { iso3: 'PRT', country: 'Portugal', cities: [lisbon, porto] },
    { iso3: 'ESP', country: 'Spain', cities: [valencia] },
  ];
  const expanded = groupedRowModels(groups, rankMap, new Set(['PRT']));
  assert.deepEqual(
    expanded.map((m) => [m.kind, m.depth, m.scored.id, m.rank]),
    [
      ['group', 0, 'lisbon', 1],
      ['child', 1, 'porto', 3],
      ['group', 0, 'valencia', 2],
    ],
  );
});

test('paginateModels/hasMoreModels: the page limit counts top-level rows, keeping expanded children', () => {
  const models = [
    { depth: 0, id: 'g1' },
    { depth: 1, id: 'g1-child' },
    { depth: 0, id: 'g2' },
    { depth: 0, id: 'g3' },
  ];
  const page = paginateModels(models, 2);
  assert.deepEqual(
    page.map((m) => m.id),
    ['g1', 'g1-child', 'g2'],
  );
  assert.equal(hasMoreModels(models, 2), true);
  assert.equal(hasMoreModels(models, 3), false);
});

// -- pins ----------------------------------------------------------------

test('togglePin adds, removes, and refuses a 5th pin', () => {
  let pins = [];
  ({ pinned: pins } = togglePin(pins, 'a'));
  ({ pinned: pins } = togglePin(pins, 'b'));
  ({ pinned: pins } = togglePin(pins, 'c'));
  ({ pinned: pins } = togglePin(pins, 'd'));
  assert.deepEqual(pins, ['a', 'b', 'c', 'd']);
  const refusal = togglePin(pins, 'e');
  assert.equal(refusal.refused, true);
  assert.deepEqual(
    refusal.pinned,
    pins,
    'refused pin leaves the set untouched',
  );
  const removed = togglePin(pins, 'b');
  assert.equal(removed.refused, false);
  assert.deepEqual(removed.pinned, ['a', 'c', 'd']);
});

test('applyPinSet caps at max, dedupes, and reports the overflow', () => {
  const { pinned, refused } = applyPinSet(['a', 'b', 'a', 'c', 'd', 'e']);
  assert.deepEqual(pinned, ['a', 'b', 'c', 'd']);
  assert.deepEqual(refused, ['e']);
});

// -- keyboard math -----------------------------------------------------------

test('nextRovingIndex: Arrow/Home/End over a roving-tabindex list', () => {
  assert.equal(nextRovingIndex(0, 'ArrowDown', 3), 1);
  assert.equal(nextRovingIndex(2, 'ArrowDown', 3), 0, 'wraps forward');
  assert.equal(nextRovingIndex(0, 'ArrowUp', 3), 2, 'wraps backward');
  assert.equal(nextRovingIndex(1, 'Home', 3), 0);
  assert.equal(nextRovingIndex(1, 'End', 3), 2);
  assert.equal(nextRovingIndex(1, 'a', 3), 1, 'unrelated keys are a no-op');
  assert.equal(
    nextRovingIndex(0, 'ArrowDown', 0),
    -1,
    'empty list has no focus',
  );
});

test('stepRadioIndex: Left/Right (and Up/Down) step a horizontal radiogroup', () => {
  assert.equal(stepRadioIndex(0, 'ArrowRight', 4), 1);
  assert.equal(stepRadioIndex(3, 'ArrowRight', 4), 0, 'wraps forward');
  assert.equal(stepRadioIndex(0, 'ArrowLeft', 4), 3, 'wraps backward');
  assert.equal(stepRadioIndex(0, 'Enter', 4), 0, 'unrelated keys are a no-op');
});

// -- persistence ----------------------------------------------------------

test('serializePersistedState/parsePersistedState round-trip', () => {
  const state = {
    weights: { qol: 3, cost: 8, safety: 5, travel: 3 },
    preset: 'BUDGET',
    passport: 'PRT',
    filters: {
      continent: 'Europe',
      minPop: 500000,
      hideAdvisoryLevelAtLeast: 3,
      includeIneligible: true,
    },
    pins: ['lisbon-prt', 'valencia-esp'],
    view: 'flat',
    // DESIGN §11.1 scaffolding + the layout-compaction `<details>` open state
    // (planner decision, T6b — not in DESIGN's persisted-key list).
    mode: 'plan',
    homeCityId: 'lisbon-prt',
    monthlySpendUsd: 3000,
    overrides: { 'stay-1': 2100 },
    refineOpen: true,
  };
  const parsed = parsePersistedState(serializePersistedState(state));
  assert.deepEqual(parsed, state);
});

test('parsePersistedState falls back to defaults on garbage input', () => {
  for (const raw of [undefined, null, '', 'not json', '42', '"string"', '{}']) {
    const parsed = parsePersistedState(raw);
    assert.equal(parsed.preset, 'BALANCED');
    assert.deepEqual(parsed.weights, PRESET_WEIGHTS.BALANCED);
    assert.equal(parsed.passport, null);
    assert.deepEqual(parsed.pins, []);
    assert.equal(parsed.view, 'grouped');
    assert.equal(parsed.mode, 'rank');
    assert.equal(parsed.homeCityId, null);
    assert.equal(parsed.monthlySpendUsd, null);
    assert.deepEqual(parsed.overrides, {});
    assert.equal(parsed.refineOpen, false);
  }
});

test('sanitizeOverrides drops non-string keys and non-finite values', () => {
  assert.deepEqual(sanitizeOverrides({ 'stay-1': 2100, 'stay-2': NaN }), {
    'stay-1': 2100,
  });
  assert.deepEqual(sanitizeOverrides(null), {});
  assert.deepEqual(sanitizeOverrides('nope'), {});
});

test('refineSummaryText: short active-state text, or "none"', () => {
  assert.equal(
    refineSummaryText({
      passport: 'PRT',
      filters: { continent: 'Europe', minPop: 0, hideAdvisoryLevelAtLeast: 3 },
    }),
    'PRT · Europe · hide L3–4',
  );
  assert.equal(
    refineSummaryText({
      passport: null,
      filters: { continent: null, minPop: 0, hideAdvisoryLevelAtLeast: null },
    }),
    'none',
  );
});

test('parsePersistedState clamps weights and re-derives the preset from them', () => {
  const raw = JSON.stringify({
    weights: { qol: 99, cost: -5, safety: 5, travel: 5 },
  });
  const parsed = parsePersistedState(raw);
  assert.deepEqual(parsed.weights, { qol: 10, cost: 0, safety: 5, travel: 5 });
  assert.equal(parsed.preset, 'CUSTOM');
});

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = value;
    },
    _store: store,
  };
}

test('loadPersisted/savePersisted round-trip through a Storage-like object', () => {
  const storage = fakeStorage();
  savePersisted(storage, {
    weights: PRESET_WEIGHTS.SAFETY,
    preset: 'SAFETY',
    passport: 'URY',
    filters: {
      continent: null,
      minPop: 0,
      hideAdvisoryLevelAtLeast: null,
      includeIneligible: false,
    },
    pins: ['montevideo-ury'],
    view: 'grouped',
  });
  const loaded = loadPersisted(storage);
  assert.equal(loaded.preset, 'SAFETY');
  assert.equal(loaded.passport, 'URY');
  assert.deepEqual(loaded.pins, ['montevideo-ury']);
});

test('loadPersisted/savePersisted never throw when storage is unavailable', () => {
  assert.doesNotThrow(() => savePersisted(null, { weights: {}, filters: {} }));
  const loaded = loadPersisted(null);
  assert.equal(loaded.preset, 'BALANCED');
  const throwingStorage = {
    getItem() {
      throw new Error('quota');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  assert.doesNotThrow(() => savePersisted(throwingStorage, { weights: {} }));
  assert.equal(loadPersisted(throwingStorage).preset, 'BALANCED');
});

// -- DOM factory guard clause -------------------------------------------------

test('createCityIntelPanel degrades to an inert API without a layer or a DOM root', () => {
  const panel = createCityIntelPanel({ layer: null, doc: null });
  assert.deepEqual(panel.getTopRanked(5), []);
  assert.equal(panel.getScored('anything'), null);
  assert.deepEqual(panel.setPins(['a', 'b']), { pinned: [], refused: [] });
  assert.doesNotThrow(() => panel.select('x'));
  assert.doesNotThrow(() => panel.openCompare());
  assert.doesNotThrow(() => panel.markVoice('panel'));
  assert.doesNotThrow(() => panel.onModeExit());
  // voice/cityIntelActions.js's plan_lifestyle checks `!cityIntel.plan` before
  // touching it; this must be explicitly null, not merely absent/undefined.
  assert.equal(panel.plan, null);
});

test('switching to PLAN activates the plan trip and remembers/restores the prior active trip', () => {
  const fakeDoc = {
    getElementById: (id) =>
      id === 'city-intel-panel' ? { dataset: {} } : null,
  };
  const calls = [];
  const store = {
    getActiveTrip: () => ({ id: 'trip-old' }),
    setActive: (id) => calls.push(id),
    getState: () => ({ trips: [{ id: 'trip-old' }, { id: 'plan-1' }] }),
  };
  const fakePlanView = {
    show() {},
    hide() {},
    render() {},
    addStay: () => ({ ok: false }),
    getStays: () => [],
    getSummary: () => ({ stays: [], rollup: null }),
    replacePlan: () => ({ ok: true, stays: [] }),
    markVoice: () => {},
    get planTripId() {
      return 'plan-1';
    },
  };
  const panel = createCityIntelPanel({
    layer: {},
    doc: fakeDoc,
    store,
    planView: fakePlanView,
  });
  panel.setPrefs({ mode: 'plan' });
  assert.deepEqual(calls, ['plan-1']);
  panel.setPrefs({ mode: 'rank' });
  assert.deepEqual(calls, ['plan-1', 'trip-old']);
});

test('leaving PLAN calls setActive(null) when the remembered previous trip no longer exists', () => {
  const fakeDoc = {
    getElementById: (id) =>
      id === 'city-intel-panel' ? { dataset: {} } : null,
  };
  const calls = [];
  let trips = [{ id: 'trip-old' }, { id: 'plan-1' }];
  const store = {
    getActiveTrip: () => ({ id: 'trip-old' }),
    setActive: (id) => calls.push(id),
    getState: () => ({ trips }),
  };
  const fakePlanView = {
    show() {},
    hide() {},
    render() {},
    addStay: () => ({ ok: false }),
    getStays: () => [],
    getSummary: () => ({ stays: [], rollup: null }),
    replacePlan: () => ({ ok: true, stays: [] }),
    markVoice: () => {},
    get planTripId() {
      return 'plan-1';
    },
  };
  const panel = createCityIntelPanel({
    layer: {},
    doc: fakeDoc,
    store,
    planView: fakePlanView,
  });
  panel.setPrefs({ mode: 'plan' });
  assert.deepEqual(calls, ['plan-1']);
  // The remembered trip is removed while still in PLAN mode (e.g. deleted).
  trips = [{ id: 'plan-1' }];
  panel.setPrefs({ mode: 'rank' });
  assert.deepEqual(calls, ['plan-1', null]);
});

test("api.plan matches the plan_lifestyle voice contract and markVoice('plan') forwards to planView", () => {
  const fakeDoc = {
    getElementById: (id) => (id === 'city-intel-panel' ? {} : null),
  };
  const store = {
    getActiveTrip: () => null,
    setActive() {},
    getState: () => ({ trips: [] }),
  };
  const markVoiceCalls = [];
  const summary = { stays: [{ id: 's1' }], rollup: { monthsCovered: 3 } };
  const fakePlanView = {
    show() {},
    hide() {},
    render() {},
    addStay: () => ({ ok: false }),
    getStays: () => ['a', 'b'],
    getSummary: () => summary,
    replacePlan: (list) => ({ ok: true, stays: list }),
    markVoice: () => markVoiceCalls.push('voiced'),
    planTripId: 'plan-1',
  };
  const panel = createCityIntelPanel({
    layer: {},
    doc: fakeDoc,
    store,
    planView: fakePlanView,
  });
  assert.equal(typeof panel.plan.ready, 'function');
  assert.deepEqual(panel.plan.getStays(), ['a', 'b']);
  assert.equal(panel.plan.getSummary(), summary);
  assert.deepEqual(panel.plan.replaceStays([{ cityId: 'x' }]), {
    ok: true,
    stays: [{ cityId: 'x' }],
  });
  panel.markVoice('plan');
  assert.deepEqual(markVoiceCalls, ['voiced']);
});

test('createCityIntelPanel degrades to an inert API when the panel root is missing from the DOM', () => {
  const fakeDoc = { getElementById: () => null };
  const panel = createCityIntelPanel({ layer: {}, doc: fakeDoc });
  assert.deepEqual(panel.getTopRanked(5), []);
});

// -- Loop-2 fixes -------------------------------------------------------------

function fakePlanView(overrides = {}) {
  return {
    show() {},
    hide() {},
    render() {},
    addStay: () => ({ ok: false }),
    getStays: () => [],
    getSummary: () => ({ stays: [], rollup: null }),
    replacePlan: () => ({ ok: true, stays: [] }),
    markVoice: () => {},
    planTripId: null,
    ...overrides,
  };
}

test('setPrefs re-renders planView when home/spend/overrides change, not for unrelated prefs', () => {
  const fakeDoc = {
    getElementById: (id) =>
      id === 'city-intel-panel' ? { dataset: {} } : null,
  };
  const renders = [];
  const store = {
    getActiveTrip: () => null,
    setActive() {},
    getState: () => ({ trips: [] }),
  };
  const planView = fakePlanView({ render: () => renders.push('r') });
  const panel = createCityIntelPanel({
    layer: {},
    doc: fakeDoc,
    store,
    planView,
  });
  panel.setPrefs({ homeCityId: 'lisbon-prt' });
  panel.setPrefs({ monthlySpendUsd: 2000 });
  panel.setPrefs({ overrides: { s1: 100 } });
  assert.equal(renders.length, 3);
  panel.setPrefs({ mode: 'rank' }); // already rank, and touches no plan profile field
  assert.equal(renders.length, 3, 'unrelated prefs do not re-render PLAN');
});

test('onModeExit (called by cityIntelMode.js on ATLAS exit) restores the trip active before PLAN', () => {
  const fakeDoc = {
    getElementById: (id) =>
      id === 'city-intel-panel' ? { dataset: {} } : null,
  };
  const calls = [];
  const store = {
    getActiveTrip: () => ({ id: 'trip-old' }),
    setActive: (id) => calls.push(id),
    getState: () => ({ trips: [{ id: 'trip-old' }, { id: 'plan-1' }] }),
  };
  const planView = fakePlanView({ planTripId: 'plan-1' });
  const panel = createCityIntelPanel({
    layer: {},
    doc: fakeDoc,
    store,
    planView,
  });
  panel.setPrefs({ mode: 'plan' });
  assert.deepEqual(calls, ['plan-1']);
  panel.onModeExit();
  assert.deepEqual(calls, ['plan-1', 'trip-old']);
  // Idempotent: nothing left to restore on a second call.
  panel.onModeExit();
  assert.deepEqual(calls, ['plan-1', 'trip-old']);
});

function fakeIndexWithTop3() {
  const scored = [
    {
      id: 'lisbon-prt',
      city: { name: 'Lisbon', country: 'Portugal' },
      composite: 90,
      eligible: true,
      reason: null,
      coverage: { text: '4 of 4 pillars' },
    },
    {
      id: 'valencia-esp',
      city: { name: 'Valencia', country: 'Spain' },
      composite: 80,
      eligible: true,
      reason: null,
      coverage: { text: '4 of 4 pillars' },
    },
    {
      id: 'montevideo-ury',
      city: { name: 'Montevideo', country: 'Uruguay' },
      composite: 70,
      eligible: true,
      reason: null,
      coverage: { text: '4 of 4 pillars' },
    },
  ];
  return {
    score: () => scored,
    rank: (list) => ({ rows: list }),
  };
}

test('markVoice(panel) announces the current top 3 in #ci-status (drift fix)', async () => {
  const fakeIndex = fakeIndexWithTop3();
  const els = {
    'city-intel-panel': { dataset: {} },
    'ci-status': { textContent: '' },
    'ci-voice-chip': { hidden: true },
  };
  const fakeDoc = { getElementById: (id) => els[id] ?? null };
  const fakeLayer = {
    whenReady: () => Promise.resolve(),
    getIndex: () => fakeIndex,
    setScores() {},
    setPinned() {},
    setSelected() {},
    onPick() {},
  };
  const panel = createCityIntelPanel({
    layer: fakeLayer,
    doc: fakeDoc,
    storage: null,
  });
  await panel.ready();
  panel.markVoice('panel');
  assert.equal(
    els['ci-status'].textContent,
    'Ranking updated by voice: 1 Lisbon, 2 Valencia, 3 Montevideo.',
  );
});

class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.className = '';
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this._attrs = {};
    this._listeners = {};
  }
  append(...cs) {
    this.children.push(...cs);
  }
  appendChild(c) {
    this.children.push(c);
    return c;
  }
  replaceChildren(...cs) {
    this.children = cs;
  }
  setAttribute(k, v) {
    this._attrs[k] = v;
  }
  getAttribute(k) {
    return this._attrs[k];
  }
  addEventListener(type, fn) {
    (this._listeners[type] ??= []).push(fn);
  }
  removeEventListener() {}
  click() {
    for (const fn of this._listeners.click || []) fn({ stopPropagation() {} });
  }
  querySelectorAll() {
    return [];
  }
}

function fakeScoredCity(id, name, country, composite) {
  const emptyPillar = { score: composite, coverage: 'full', metrics: [] };
  return {
    id,
    city: { id, name, country, iso3: 'PRT', lat: 0, lon: 0, pop: 1 },
    composite,
    eligible: true,
    reason: null,
    coverage: {
      pillarsAvailable: 4,
      cityLevelMetrics: 1,
      text: '4 of 4 pillars',
    },
    pillars: {
      qol: emptyPillar,
      cost: emptyPillar,
      safety: emptyPillar,
      travel: emptyPillar,
    },
  };
}

test('ADD TO PLAN from the compare column activates the plan trip when nothing is active (DESIGN §11.6)', async () => {
  const cities = [
    fakeScoredCity('lisbon-prt', 'Lisbon', 'Portugal', 90),
    fakeScoredCity('valencia-esp', 'Valencia', 'Spain', 80),
  ];
  const fakeIndex = { score: () => cities, rank: (list) => ({ rows: list }) };
  const els = {
    'city-intel-panel': { dataset: {} },
    'city-intel-compare': new FakeEl('div'),
  };
  const fakeDoc = {
    getElementById: (id) => els[id] ?? null,
    createElement: (tag) => new FakeEl(tag),
    addEventListener() {},
    removeEventListener() {},
    activeElement: null,
  };
  const fakeLayer = {
    whenReady: () => Promise.resolve(),
    getIndex: () => fakeIndex,
    setScores() {},
    setPinned() {},
    setSelected() {},
    onPick() {},
  };
  const activateCalls = [];
  const store = {
    getActiveTrip: () => null,
    getPlanTrip: () => ({ id: 'plan-1' }),
    setActive: (id) => activateCalls.push(id),
    getState: () => ({ trips: [] }),
  };
  const toasts = [];
  const addStayCalls = [];
  const planView = fakePlanView({
    addStay: (id) => {
      addStayCalls.push(id);
      return { ok: true, message: `Added ${id} to plan: JAN (1 mo).` };
    },
  });
  const panel = createCityIntelPanel({
    layer: fakeLayer,
    doc: fakeDoc,
    storage: null,
    store,
    planView,
    showToast: (m) => toasts.push(m),
  });
  await panel.ready();
  panel.setPins(['lisbon-prt', 'valencia-esp']);
  panel.openCompare();

  const compareRoot = els['city-intel-compare'].children[0];
  const table = compareRoot.children[1];
  const headRow = table.children[1].children[0];
  const [, thLisbon] = headRow.children;
  const addPlanBtn = thLisbon.children[2];
  assert.equal(addPlanBtn.textContent, '+ PLAN');
  addPlanBtn.click();

  assert.deepEqual(addStayCalls, ['lisbon-prt']);
  assert.deepEqual(
    activateCalls,
    ['plan-1'],
    'nothing was active, so the plan trip is made active',
  );
  assert.deepEqual(toasts, ['Added lisbon-prt to plan: JAN (1 mo).']);
});

test('PLAN drops the top-20 ranking labels and never double-labels a plan stay (DESIGN §11.1)', async () => {
  const cities = [
    fakeScoredCity('lisbon-prt', 'Lisbon', 'Portugal', 90),
    fakeScoredCity('valencia-esp', 'Valencia', 'Spain', 80),
  ];
  const fakeIndex = { score: () => cities, rank: (list) => ({ rows: list }) };
  const setScoresCalls = [];
  const fakeLayer = {
    whenReady: () => Promise.resolve(),
    getIndex: () => fakeIndex,
    setScores: (scored, opts) => setScoresCalls.push(opts),
    setPinned() {},
    setSelected() {},
    onPick() {},
  };
  const els = {
    'city-intel-panel': { dataset: {} },
    'ci-list': new FakeEl('div'),
  };
  const fakeDoc = {
    getElementById: (id) => els[id] ?? null,
    createElement: (tag) => new FakeEl(tag),
  };
  const store = {
    getActiveTrip: () => null,
    setActive() {},
    getState: () => ({ trips: [] }),
  };
  const planView = fakePlanView({
    getStays: () => [{ id: 's1', cityId: 'lisbon-prt', start: 1, len: 1 }],
    planTripId: 'plan-1',
  });
  const panel = createCityIntelPanel({
    layer: fakeLayer,
    doc: fakeDoc,
    storage: null,
    store,
    planView,
  });
  await panel.ready();
  panel.setPins(['lisbon-prt', 'valencia-esp']);

  const rankLabels = setScoresCalls.at(-1).labelIds;
  assert.ok(rankLabels.has('lisbon-prt'), 'RANK: pinned cities are labelled');
  assert.ok(rankLabels.has('valencia-esp'));

  panel.setPrefs({ mode: 'plan' });
  const planLabels = setScoresCalls.at(-1).labelIds;
  assert.equal(
    planLabels.has('lisbon-prt'),
    false,
    'lisbon is a plan stay: the trips label wins',
  );
  assert.ok(
    planLabels.has('valencia-esp'),
    'pinned but not a plan stay: still labelled',
  );
});
