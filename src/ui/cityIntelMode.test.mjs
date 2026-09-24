import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createCityIntelMode, MODE_LAYER_IDS } from './cityIntelMode.js';
import { GLOBE_VIEW } from '../locations.js';

class Element extends EventTarget {
  constructor() {
    super();
    this.attrs = new Map();
    this.hidden = false;
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => this.classes.add(n)),
      remove: (...names) => names.forEach((n) => this.classes.delete(n)),
      contains: (name) => this.classes.has(name),
      toggle: (name, force) => {
        const next = force === undefined ? !this.classes.has(name) : force;
        if (next) this.classes.add(name);
        else this.classes.delete(name);
        return next;
      },
    };
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  getAttribute(name) {
    return this.attrs.get(name);
  }
  click() {
    this.dispatchEvent(new Event('click'));
  }
}

function fixture({ withDom = true, cameraHeightM = 10_000_000 } = {}) {
  const els = {
    body: new Element(),
    toggle: new Element(),
    exitBtn: new Element(),
    panel: new Element(),
    globalContext: new Element(),
    cctv: new Element(),
    scene: new Element(),
  };
  els.panel.classes.add('collapsed');
  const byId = {
    'city-intel-toggle': els.toggle,
    'city-intel-exit': els.exitBtn,
    'city-intel-panel': els.panel,
    'global-context-panel': els.globalContext,
    'cctv-panel': els.cctv,
    'scene-panel': els.scene,
  };
  const doc = withDom
    ? { body: els.body, getElementById: (id) => byId[id] || null }
    : { body: null, getElementById: () => null };

  const calls = { getEnabledLayerIds: 0, restore: [] };
  let enabled = new Set(['flights', 'vessels']);
  const cameraCalls = { cancelFlight: 0, flyTo: [] };
  const camera = {
    positionCartographic: {
      longitude: Cesium.Math.toRadians(-97.7431),
      latitude: Cesium.Math.toRadians(30.2672),
      height: cameraHeightM,
    },
    cancelFlight: () => cameraCalls.cancelFlight++,
    flyTo: (options) => cameraCalls.flyTo.push(options),
  };
  const dataManager = {
    viewer: { camera },
    getEnabledLayerIds: () => {
      calls.getEnabledLayerIds++;
      return new Set(enabled);
    },
    restoreEnabledLayerIds: (ids, options) => {
      calls.restore.push({ ids: [...ids], options });
      enabled = new Set(ids);
      return Promise.resolve({});
    },
  };

  const toasts = [];
  const panelCalls = { ready: 0 };
  const panel = {
    ready: () => {
      panelCalls.ready++;
      return Promise.resolve();
    },
  };
  const mode = createCityIntelMode({
    dataManager,
    panel,
    showToast: (message) => toasts.push(message),
    doc,
  });
  return { mode, els, calls, toasts, dataManager, panelCalls, cameraCalls };
}

test('createCityIntelMode degrades to a no-op without the required DOM', async () => {
  const { mode, calls, toasts } = fixture({ withDom: false });
  await assert.doesNotReject(() => mode.enter());
  assert.equal(mode.isActive(), false);
  assert.doesNotThrow(() => mode.exit());
  assert.equal(calls.getEnabledLayerIds, 0);
  assert.deepEqual(toasts, []);
});

test('enter(): snapshots enabled layers, targets city-intel+trips, and shows the choreography', async () => {
  const { mode, els, calls, toasts } = fixture();
  await mode.enter();

  assert.equal(mode.isActive(), true);
  assert.equal(calls.getEnabledLayerIds, 1);
  assert.equal(calls.restore.length, 1);
  assert.deepEqual(calls.restore[0].ids, [...MODE_LAYER_IDS]);
  assert.equal(calls.restore[0].options.origin, 'user');

  assert.equal(els.body.classList.contains('city-intel-mode'), true);
  assert.equal(
    els.panel.classList.contains('collapsed'),
    false,
    'panel expands',
  );
  assert.equal(els.globalContext.classList.contains('collapsed'), true);
  assert.equal(els.cctv.classList.contains('collapsed'), true);
  assert.equal(els.scene.classList.contains('collapsed'), true);
  assert.equal(els.toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(els.exitBtn.hidden, false);
  assert.deepEqual(toasts, ['ATLAS on. Other layers paused until you exit.']);
});

test('enter(): only kicks off panel.ready() once the layer is actually enabled', async () => {
  // The layer's own pack load is lazy (DataManager only calls its init() on
  // first enable), so panel.ready() must be sequenced AFTER
  // restoreEnabledLayerIds resolves, never fired proactively beforehand.
  const { mode, calls, panelCalls } = fixture();
  await mode.enter();
  assert.equal(panelCalls.ready, 1);
  assert.equal(
    calls.restore.length,
    1,
    'restore already happened by the time ready() is called',
  );
});

test('enter() while already active is a no-op (no double snapshot)', async () => {
  const { mode, calls } = fixture();
  await mode.enter();
  await mode.enter();
  assert.equal(calls.getEnabledLayerIds, 1);
  assert.equal(calls.restore.length, 1);
});

test('exit(): restores the pre-entry snapshot exactly and reverses the choreography', async () => {
  const { mode, els, calls, toasts } = fixture();
  await mode.enter();
  await mode.exit();

  assert.equal(mode.isActive(), false);
  assert.equal(calls.restore.length, 2);
  assert.deepEqual(calls.restore[1].ids.sort(), ['flights', 'vessels'].sort());
  assert.equal(calls.restore[1].options.origin, 'user');

  assert.equal(els.body.classList.contains('city-intel-mode'), false);
  assert.equal(
    els.panel.classList.contains('collapsed'),
    true,
    'panel collapses again',
  );
  assert.equal(els.toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(els.exitBtn.hidden, true);
  assert.deepEqual(toasts, [
    'ATLAS on. Other layers paused until you exit.',
    'ATLAS off. Layers restored.',
  ]);
});

test('exit() when not active is a no-op', () => {
  const { mode, calls, toasts } = fixture();
  mode.exit();
  assert.equal(calls.restore.length, 0);
  assert.deepEqual(toasts, []);
});

test('enter(): flies out to a global view when the camera starts low (F2)', async () => {
  const { mode, cameraCalls } = fixture({ cameraHeightM: 500_000 });
  await mode.enter();

  assert.equal(cameraCalls.cancelFlight, 1);
  assert.equal(cameraCalls.flyTo.length, 1);
  const dest = cameraCalls.flyTo[0].destination;
  const carto = Cesium.Cartographic.fromCartesian(dest);
  assert.ok(
    Math.abs(carto.height - GLOBE_VIEW.heightM) < 1,
    'flies to the shared global-view height',
  );
  assert.ok(
    Math.abs(Cesium.Math.toDegrees(carto.longitude) - -97.7431) < 0.01,
    'keeps the current sub-camera longitude centred',
  );
  assert.ok(
    Math.abs(Cesium.Math.toDegrees(carto.latitude) - 30.2672) < 0.01,
    'keeps the current sub-camera latitude centred',
  );
});

test('enter(): does not fly when the camera is already high (no fly if already high)', async () => {
  const { mode, cameraCalls } = fixture({ cameraHeightM: 5_000_000 });
  await mode.enter();
  assert.equal(cameraCalls.flyTo.length, 0);
  assert.equal(cameraCalls.cancelFlight, 0);
});

test('enter(): height exactly at the 3,000 km threshold does not fly', async () => {
  const { mode, cameraCalls } = fixture({ cameraHeightM: 3_000_000 });
  await mode.enter();
  assert.equal(cameraCalls.flyTo.length, 0);
});

test('exit(): never moves the camera', async () => {
  const { mode, cameraCalls } = fixture({ cameraHeightM: 500_000 });
  await mode.enter();
  cameraCalls.flyTo.length = 0;
  cameraCalls.cancelFlight = 0;
  await mode.exit();
  assert.equal(cameraCalls.flyTo.length, 0);
  assert.equal(cameraCalls.cancelFlight, 0);
});

test('enter(): a failed layer restore rolls back DOM/layers and rejects; a retry then succeeds', async () => {
  const { mode, els, calls, toasts, dataManager } = fixture();
  const realRestore = dataManager.restoreEnabledLayerIds;
  let failNext = true;
  dataManager.restoreEnabledLayerIds = (ids, options) => {
    if (failNext) {
      failNext = false;
      return Promise.reject(new Error('layer restore failed'));
    }
    return realRestore(ids, options);
  };

  await assert.rejects(() => mode.enter(), /layer restore failed/);
  assert.equal(mode.isActive(), false, 'rolled back to inactive');
  assert.equal(els.body.classList.contains('city-intel-mode'), false);
  assert.equal(els.panel.classList.contains('collapsed'), true);
  assert.equal(els.toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(els.exitBtn.hidden, true);
  assert.deepEqual(toasts, [
    'ATLAS on. Other layers paused until you exit.',
    'ATLAS could not start. Layers restored.',
  ]);
  // The rollback itself did a real restore back to the pre-enter snapshot.
  assert.equal(calls.restore.length, 1);
  assert.deepEqual(calls.restore[0].ids.sort(), ['flights', 'vessels'].sort());

  // Retry: active isn't stuck, so entering again just works.
  await mode.enter();
  assert.equal(mode.isActive(), true);
  assert.equal(calls.restore.length, 2);
  assert.deepEqual(calls.restore[1].ids, [...MODE_LAYER_IDS]);
});

test('exit() during a pending enter() supersedes it: no fly-out, layers land back at the original snapshot', async () => {
  const { mode, dataManager, cameraCalls } = fixture({
    cameraHeightM: 500_000, // low enough that enter() would fly out if not superseded
  });

  const enterPromise = mode.enter(); // runs synchronously up to its first await
  await mode.exit(); // supersedes it and restores the original layers itself
  await enterPromise; // let the superseded continuation observe the epoch bump

  assert.equal(mode.isActive(), false);
  assert.equal(
    cameraCalls.flyTo.length,
    0,
    'the superseded enter() must never fly the camera out',
  );
  assert.deepEqual(
    [...dataManager.getEnabledLayerIds()].sort(),
    ['flights', 'vessels'].sort(),
  );
});

test('exit(): a failed layer restore logs a warning and shows an honest toast, not the success one', async () => {
  const { mode, toasts, dataManager } = fixture();
  await mode.enter();
  dataManager.restoreEnabledLayerIds = () =>
    Promise.reject(new Error('restore boom'));

  const warnCalls = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnCalls.push(args);
  try {
    await mode.exit();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(mode.isActive(), false);
  assert.equal(warnCalls.length, 1);
  assert.equal(
    toasts.at(-1),
    'ATLAS off, but layers may not have fully restored.',
  );
});

test('the toggle pill and the panel EXIT button drive enter/exit', async () => {
  const { mode, els } = fixture();
  els.toggle.click();
  // enter() is async (awaits restoreEnabledLayerIds); give it a tick.
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(mode.isActive(), true);

  els.exitBtn.click();
  assert.equal(mode.isActive(), false);

  els.toggle.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(mode.isActive(), true, 'toggle click also re-enters');
});
