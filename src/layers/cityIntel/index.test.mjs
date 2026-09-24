import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCityIntelLayer,
  binForScore,
  markerStyle,
  selectLabelIds,
} from './index.js';

const RAMP = {
  score: ['s0', 's1', 's2', 's3', 's4'],
  neutral: 'n0',
};

test('binForScore maps 0-100 to the five DESIGN §7 bins', () => {
  assert.equal(binForScore(null), null);
  assert.equal(binForScore(undefined), null);
  assert.equal(binForScore(NaN), null);
  assert.equal(binForScore(0), 0);
  assert.equal(binForScore(19.9), 0);
  assert.equal(binForScore(20), 1);
  assert.equal(binForScore(39.9), 1);
  assert.equal(binForScore(40), 2);
  assert.equal(binForScore(59.9), 2);
  assert.equal(binForScore(60), 3);
  assert.equal(binForScore(79.9), 3);
  assert.equal(binForScore(80), 4);
  assert.equal(binForScore(100), 4);
  assert.equal(binForScore(150), 4, 'clamps above range');
  assert.equal(binForScore(-10), 0, 'clamps below range');
});

test('markerStyle: eligible cities render filled in their bin colour', () => {
  const style = markerStyle({ eligible: true, bin: 3 }, RAMP);
  assert.deepEqual(style, {
    pixelSize: 8,
    color: 's3',
    outlineColor: '#000000',
    outlineWidth: 1.5,
  });
});

test('markerStyle: ineligible and filtered cities render as a hollow neutral ring', () => {
  assert.deepEqual(markerStyle({ eligible: false }, RAMP), {
    pixelSize: 6,
    color: 'transparent',
    outlineColor: 'n0',
    outlineWidth: 1.5,
  });
  assert.deepEqual(
    markerStyle({ eligible: true, filtered: true, bin: 2 }, RAMP),
    {
      pixelSize: 6,
      color: 'transparent',
      outlineColor: 'n0',
      outlineWidth: 1.5,
    },
  );
});

test('markerStyle: selected beats pinned and hovered', () => {
  const selected = markerStyle(
    { eligible: true, bin: 1, selected: true, pinned: true, hovered: true },
    RAMP,
  );
  assert.deepEqual(selected, {
    pixelSize: 12,
    color: 's1',
    outlineColor: '#ffffff',
    outlineWidth: 3,
  });
});

test('markerStyle: pinned and hovered both draw a 2px white outline without resizing', () => {
  const pinned = markerStyle({ eligible: true, bin: 0, pinned: true }, RAMP);
  assert.deepEqual(pinned, {
    pixelSize: 8,
    color: 's0',
    outlineColor: '#ffffff',
    outlineWidth: 2,
  });
  const hovered = markerStyle({ eligible: false, hovered: true }, RAMP);
  assert.deepEqual(hovered, {
    pixelSize: 6,
    color: 'transparent',
    outlineColor: '#ffffff',
    outlineWidth: 2,
  });
});

test('markerStyle: a null bin falls back to the first ramp colour', () => {
  assert.equal(markerStyle({ eligible: true, bin: null }, RAMP).color, 's0');
});

test('selectLabelIds unions the top ranking, pins and the selection', () => {
  const ids = selectLabelIds({
    topRankedIds: ['a', 'b'],
    pinnedIds: ['c'],
    selectedId: 'd',
    eligibleIds: ['a', 'b', 'c', 'd', 'e'],
    cameraHeightM: 5_000_000,
  });
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c', 'd']);
});

test('selectLabelIds adds every eligible city once the camera is close', () => {
  const far = selectLabelIds({
    eligibleIds: ['a', 'b'],
    cameraHeightM: 2_000_000,
  });
  assert.equal(far.size, 0);
  const close = selectLabelIds({
    eligibleIds: ['a', 'b'],
    cameraHeightM: 1_000_000,
  });
  assert.deepEqual([...close].sort(), ['a', 'b']);
});

// ---------------------------------------------------------------------------
// Layer-contract smoke test (no real Cesium/WebGL scene or DOM canvas).
// ---------------------------------------------------------------------------

function fakeViewer() {
  const primitives = new Set();
  const cameraListeners = new Set();
  return {
    scene: {
      primitives: {
        add: (p) => {
          primitives.add(p);
          return p;
        },
        remove: (p) => primitives.delete(p),
      },
      pick: () => null,
      canvas: undefined, // no DOM here: the layer must degrade, not throw
    },
    camera: {
      changed: {
        addEventListener: (fn) => cameraListeners.add(fn),
        removeEventListener: (fn) => cameraListeners.delete(fn),
      },
      positionCartographic: { height: 10_000_000 },
    },
    _primitives: primitives,
    _cameraListeners: cameraListeners,
  };
}

test('layer contract: init/enable/disable/update/destroy/getStats', async () => {
  const viewer = fakeViewer();
  const layer = createCityIntelLayer();

  assert.equal(layer.id, 'city-intel');
  assert.deepEqual(layer.getStats(), { count: 0, eligible: 0, error: null });

  layer.init(viewer);
  assert.equal(
    viewer._primitives.size,
    2,
    'points and labels collections are added',
  );
  await layer.whenReady();

  const stats = layer.getStats();
  assert.equal(stats.count, 2480, 'the full bundled city roster loads');
  assert.ok(stats.eligible > 0, 'the standalone Balanced-weights scoring ran');
  assert.ok(
    layer.getIndex(),
    'getIndex() exposes the scoring index once ready',
  );
  assert.equal(
    await layer.update(),
    true,
    'a `false` return would fail the DataManager enable() flow (src/data/lifecycle.js)',
  );

  // Standalone toggling (row alone, no panel): scores without throwing, no
  // handlers wired since the fake viewer has no canvas/document.
  layer.enable(viewer);
  assert.equal(viewer._cameraListeners.size, 1);

  layer.setSelected('tokyo-jpn');
  layer.setPinned(['tokyo-jpn']);
  layer.setScores(
    layer.getIndex().score({ qol: 10, cost: 0, safety: 0, travel: 0 }),
  );
  assert.equal(
    layer.getStats().eligible,
    0,
    'setScores without rankedIds clears eligibility',
  );

  let picked = null;
  layer.onPick((id) => (picked = id));
  assert.equal(picked, null, 'no pick fires without a real pointer event');

  layer.disable(viewer);
  assert.equal(viewer._cameraListeners.size, 0);

  layer.destroy(viewer);
  assert.equal(viewer._primitives.size, 0, 'both collections are removed');
  assert.deepEqual(layer.getStats(), { count: 0, eligible: 0, error: null });
});

test('two layer instances own independent state', async () => {
  const a = createCityIntelLayer();
  const b = createCityIntelLayer();
  const viewerA = fakeViewer();
  a.init(viewerA);
  b.init(fakeViewer());
  await Promise.all([a.whenReady(), b.whenReady()]);
  a.enable(viewerA);
  a.setPinned(['tokyo-jpn']);
  assert.notEqual(a.getIndex(), null);
  assert.notEqual(b.getIndex(), null);
  assert.equal(a.getStats().count, b.getStats().count);
  a.destroy(viewerA);
  b.destroy();
});
