import * as Cesium from 'cesium';
import { loadCityIntelPack } from './source.js';
import { createCityIntelIndex } from './scoring.js';
import {
  registerPickOwner,
  unregisterPickOwner,
} from '../../data/pickRegistry.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import { horizonOccluder } from '../../data/iconOrientation.js';

/** Standalone default weights (docs/cockpit/DESIGN.md §2). */
const BALANCED_WEIGHTS = Object.freeze({
  qol: 5,
  cost: 5,
  safety: 5,
  travel: 5,
});
/** DESIGN §7: every eligible city gets a label once the camera is this close. */
const CLOSE_CAMERA_HEIGHT_M = 1_500_000;
/** DESIGN §7: label count for the standalone default ranking. */
const TOP_LABEL_COUNT = 20;
/**
 * Close-camera label cap: the first eligible ids in the order given (rank
 * order standalone, pack/population order from the panel).
 * ponytail: global cut, not per-viewport; zoomed into a region outside the
 * first 400 some points go unlabelled. Filter by the visible hemisphere first
 * if that matters (~12k cities would otherwise mean ~12k Cesium labels).
 */
const CLOSE_LABEL_CAP = 400;

/** DESIGN §7 score-ramp hex literals, used until the CSS tokens are styled. */
const FALLBACK_RAMP = Object.freeze({
  score: Object.freeze(['#8a226a', '#bc3754', '#e45a31', '#f98e09', '#f6d746']),
  neutral: '#8a8f98',
});

/**
 * Map a composite score (0-100) to a DESIGN §7 ramp bin (0-4), or null when
 * the score is unavailable.
 * @param {number|null|undefined} score
 * @returns {0|1|2|3|4|null}
 */
export function binForScore(score) {
  if (!Number.isFinite(score)) return null;
  const clamped = Math.min(100, Math.max(0, score));
  return /** @type {0|1|2|3|4} */ (Math.min(4, Math.floor(clamped / 20)));
}

/** CSS colour for a score bin (DESIGN §7 ramp), or the neutral token when unscored. */
export function scoreColor(bin) {
  return bin == null ? 'var(--ci-neutral)' : `var(--ci-score-${bin})`;
}

/**
 * Marker visual state per DESIGN §7. Pure — no Cesium types in or out, so it
 * is testable without a Cesium runtime. Priority when combined:
 * selected > pinned > hovered.
 * @param {{eligible?: boolean, filtered?: boolean, hovered?: boolean, selected?: boolean, pinned?: boolean, bin?: number|null}} [flags]
 * @param {{score: string[], neutral: string}} [colors] Defaults to the §7 hex literals.
 * @returns {{pixelSize: number, color: string, outlineColor: string, outlineWidth: number}}
 */
export function markerStyle(
  {
    eligible = false,
    filtered = false,
    hovered = false,
    selected = false,
    pinned = false,
    bin = null,
  } = {},
  colors = FALLBACK_RAMP,
) {
  const filled = eligible && !filtered;
  const base = filled
    ? {
        pixelSize: 8,
        color: colors.score[bin ?? 0] ?? colors.neutral,
        outlineColor: '#000000',
        outlineWidth: 1.5,
      }
    : {
        pixelSize: 6,
        color: 'transparent',
        outlineColor: colors.neutral,
        outlineWidth: 1.5,
      };
  if (selected)
    return { ...base, pixelSize: 12, outlineColor: '#ffffff', outlineWidth: 3 };
  if (pinned) return { ...base, outlineColor: '#ffffff', outlineWidth: 2 };
  if (hovered) return { ...base, outlineColor: '#ffffff', outlineWidth: 2 };
  return base;
}

/**
 * Which cities get a globe label (DESIGN §7): the caller's current top
 * ranking, every pinned or selected city, and — once the camera is close —
 * the first CLOSE_LABEL_CAP eligible ids, in the order given. Pure.
 * @param {{topRankedIds?: Iterable<string>, pinnedIds?: Iterable<string>, selectedId?: string|null, eligibleIds?: Iterable<string>, cameraHeightM?: number}} [options]
 * @returns {Set<string>}
 */
export function selectLabelIds({
  topRankedIds = [],
  pinnedIds = [],
  selectedId = null,
  eligibleIds = [],
  cameraHeightM = Infinity,
} = {}) {
  const ids = new Set(topRankedIds);
  for (const id of pinnedIds) ids.add(id);
  if (selectedId != null) ids.add(selectedId);
  if (cameraHeightM < CLOSE_CAMERA_HEIGHT_M) {
    let added = 0;
    for (const id of eligibleIds) {
      if (added++ >= CLOSE_LABEL_CAP) break;
      ids.add(id);
    }
  }
  return ids;
}

/** Read the §7 ramp tokens once; falls back to the hex literals when unstyled. */
function readRampColors() {
  if (typeof document === 'undefined') return FALLBACK_RAMP;
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) =>
    style.getPropertyValue(name)?.trim() || fallback;
  return {
    score: FALLBACK_RAMP.score.map((fallback, i) =>
      read(`--ci-score-${i}`, fallback),
    ),
    neutral: read('--ci-neutral', FALLBACK_RAMP.neutral),
  };
}

/**
 * City Intel globe layer: one point + optional label per pack city (the
 * whole pack, drawn as `PointPrimitiveCollection`/`LabelCollection`, never
 * Entities). Standalone (row toggled without the ATLAS mode) it scores the
 * pack itself with Balanced weights; `setScores` lets the panel take over.
 */
export function createCityIntelLayer() {
  let _viewer = null;
  let _points = null;
  let _labels = null;
  let _enabled = false;
  let _cities = [];
  let _index = null;
  let _ramp = FALLBACK_RAMP;
  const _colorCache = new Map();
  let _pointsById = new Map();
  let _labelsById = new Map();
  let _scoredById = new Map();
  let _rankedIds = new Set();
  let _filteredOutIds = new Set();
  let _panelLabelIds = new Set();
  let _selectedId = null;
  let _pinnedIds = new Set();
  let _hoveredId = null;
  let _onPick = null;
  let _clickHandler = null;
  let _cameraChangedHandler = null;
  let _cameraHeightM = Infinity;
  let _ready = null;
  let _loadError = null;

  function toColor(hex) {
    if (hex === 'transparent') return Cesium.Color.TRANSPARENT;
    if (hex === '#000000') return Cesium.Color.BLACK;
    if (hex === '#ffffff') return Cesium.Color.WHITE;
    let color = _colorCache.get(hex);
    if (!color) {
      color = Cesium.Color.fromCssColorString(hex) || Cesium.Color.GRAY;
      _colorCache.set(hex, color);
    }
    return color;
  }

  function cityFlags(city) {
    return {
      eligible: _rankedIds.has(city.id),
      filtered: _filteredOutIds.has(city.id),
      hovered: _hoveredId === city.id,
      selected: _selectedId === city.id,
      pinned: _pinnedIds.has(city.id),
      bin: binForScore(_scoredById.get(city.id)?.composite ?? null),
    };
  }

  function labelIdSet() {
    return selectLabelIds({
      topRankedIds: _panelLabelIds,
      pinnedIds: _pinnedIds,
      selectedId: _selectedId,
      eligibleIds: _rankedIds,
      cameraHeightM: _cameraHeightM,
    });
  }

  /**
   * DESIGN §7 asks for `disableDepthTestDistance: Infinity` so a marker is
   * never buried by nearby terrain/3D tiles — but that alone also draws
   * every far-side city straight through the globe (bug: hundreds of world
   * markers visible from street level). Same split GEV already uses for
   * flights/radio/CCTV/localAdsb (`horizonOccluder`,
   * `src/data/iconOrientation.js`): keep the depth-test bypass for close-up
   * legibility, hide anything beyond the horizon by hand via `.show`.
   * @returns {?Cesium.EllipsoidalOccluder}
   */
  function currentOccluder() {
    return _viewer?.camera?.positionWC ? horizonOccluder(_viewer.camera) : null;
  }

  function restyleCity(city, labelIds, occluder) {
    const point = _pointsById.get(city.id);
    if (!point) return;
    const style = markerStyle(cityFlags(city), _ramp);
    point.pixelSize = style.pixelSize;
    point.color = toColor(style.color);
    point.outlineColor = toColor(style.outlineColor);
    point.outlineWidth = style.outlineWidth;
    point.show = !occluder || occluder.isPointVisible(point.position);

    const shouldLabel = labelIds.has(city.id);
    const label = _labelsById.get(city.id);
    if (shouldLabel && !label) {
      // Cesium measures the label's font via a scratch canvas, which needs a
      // DOM (there is none in node:test); degrade to "no label" rather than
      // taking the whole layer down over one missing text glyph.
      try {
        _labelsById.set(
          city.id,
          _labels.add({
            id: city.id,
            position: point.position,
            text: city.name,
            font: '11px JetBrains Mono, monospace',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -14),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            show: point.show,
          }),
        );
      } catch {
        /* no DOM available to measure the label; skip it */
      }
    } else if (!shouldLabel && label) {
      _labels.remove(label);
      _labelsById.delete(city.id);
    } else if (label) {
      label.show = point.show;
    }
  }

  function restyleAll() {
    if (!_points) return;
    const labelIds = labelIdSet();
    const occluder = currentOccluder();
    for (const city of _cities) restyleCity(city, labelIds, occluder);
  }

  function restyleOne(cityId) {
    if (!_points || !cityId) return;
    const city = _pointsById.has(cityId)
      ? _cities.find((c) => c.id === cityId)
      : null;
    if (city) restyleCity(city, labelIdSet(), currentOccluder());
  }

  /** Cheap per-tick pass: only the horizon show/hide, no style recompute. */
  function updateHorizonVisibility() {
    if (!_points) return;
    const occluder = currentOccluder();
    if (!occluder) return;
    for (const city of _cities) {
      const point = _pointsById.get(city.id);
      if (!point) continue;
      const visible = occluder.isPointVisible(point.position);
      point.show = visible;
      const label = _labelsById.get(city.id);
      if (label) label.show = visible;
    }
  }

  function buildPoints() {
    for (const city of _cities) {
      const point = _points.add({
        id: city.id,
        position: Cesium.Cartesian3.fromDegrees(city.lon, city.lat),
        pixelSize: 6,
        color: Cesium.Color.TRANSPARENT,
        outlineColor: toColor(_ramp.neutral),
        outlineWidth: 1.5,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      _pointsById.set(city.id, point);
    }
  }

  /** Standalone scoring: Balanced weights, no passport, no filters (DESIGN §1). */
  function scoreDefault() {
    const scored = _index.score(BALANCED_WEIGHTS, {});
    _scoredById = new Map(scored.map((s) => [s.id, s]));
    const { rows } = _index.rank(scored, { groupByCountry: false });
    _rankedIds = new Set(rows.map((s) => s.id));
    _filteredOutIds = new Set();
    _panelLabelIds = new Set(rows.slice(0, TOP_LABEL_COUNT).map((s) => s.id));
  }

  function pickedCityId(position) {
    if (!_viewer || !isPointerFree()) return null;
    const picked = _viewer.scene.pick(position);
    if (!picked) return null;
    if (typeof picked.id === 'string' && _pointsById.has(picked.id))
      return picked.id;
    const primitiveId = picked.primitive?.id;
    if (typeof primitiveId === 'string' && _pointsById.has(primitiveId))
      return primitiveId;
    return null;
  }

  /**
   * A dedicated (layer-owned) click/hover handler, matching how the other
   * point layers (e.g. bikeshare) coordinate through the shared pick-ownership
   * registry rather than a single global dispatcher. Guarded: a DOM-less host
   * (unit tests) degrades to no pick handling instead of throwing.
   */
  function installHandlers(viewer) {
    if (_clickHandler) return;
    try {
      _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    } catch (error) {
      console.warn(
        '[Data:CityIntel] Pick handler unavailable:',
        error?.message || error,
      );
      _clickHandler = null;
      return;
    }
    _clickHandler.setInputAction((click) => {
      const id = pickedCityId(click.position);
      if (id) _onPick?.(id);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    _clickHandler.setInputAction((movement) => {
      const id = pickedCityId(movement.endPosition);
      if (id === _hoveredId) return;
      const previous = _hoveredId;
      _hoveredId = id;
      restyleOne(previous);
      restyleOne(id);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    registerPickOwner('city-intel', (pickedId) => _pointsById.has(pickedId));
  }

  function removeHandlers() {
    _clickHandler?.destroy();
    _clickHandler = null;
    unregisterPickOwner('city-intel');
  }

  function onCameraChanged() {
    const height = _viewer?.camera?.positionCartographic?.height;
    const wasClose = _cameraHeightM < CLOSE_CAMERA_HEIGHT_M;
    _cameraHeightM = Number.isFinite(height) ? height : Infinity;
    if (wasClose !== _cameraHeightM < CLOSE_CAMERA_HEIGHT_M) restyleAll();
    else updateHorizonVisibility();
  }

  return {
    id: 'city-intel',
    name: 'City Intel',
    icon: '🏙️',
    source: 'Local',
    updateInterval: 0,

    init(viewer) {
      if (_viewer) throw new Error('City Intel layer is already initialized');
      _viewer = viewer;
      _ramp = readRampColors();
      _points = new Cesium.PointPrimitiveCollection({
        blendOption: Cesium.BlendOption.TRANSLUCENT,
      });
      _labels = new Cesium.LabelCollection();
      viewer.scene.primitives.add(_points);
      viewer.scene.primitives.add(_labels);
      _points.show = false;
      _labels.show = false;
      _loadError = null;
      _ready = loadCityIntelPack()
        .then((pack) => {
          if (!_points) return false; // destroyed while loading
          _cities = pack.cities;
          _index = createCityIntelIndex({
            cities: pack.cities,
            countries: pack.countries,
            seasonality: pack.seasonality,
          });
          buildPoints();
          scoreDefault();
          if (_enabled) restyleAll();
          return true;
        })
        .catch((error) => {
          _loadError = error?.message || 'City Intel pack unavailable';
          console.warn('[Data:CityIntel] Pack load failed:', _loadError);
          return false;
        });
      console.log('[Data:CityIntel] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_points) _points.show = true;
      if (_labels) _labels.show = true;
      installHandlers(viewer);
      if (!_cameraChangedHandler) {
        _cameraChangedHandler = () => onCameraChanged();
        viewer.camera.changed.addEventListener(_cameraChangedHandler);
      }
      onCameraChanged();
      if (_cities.length) restyleAll();
    },

    disable(viewer = _viewer) {
      _enabled = false;
      if (_points) _points.show = false;
      if (_labels) _labels.show = false;
      removeHandlers();
      if (_cameraChangedHandler && viewer) {
        viewer.camera.changed.removeEventListener(_cameraChangedHandler);
        _cameraChangedHandler = null;
      }
      _hoveredId = null;
    },

    async update() {
      // No periodic refresh: the DataManager's enable() flow calls update()
      // once immediately after enabling and treats a `false` return as a
      // failed transition (src/data/lifecycle.js), which made this layer
      // un-enableable from City Intel mode / the DATA LAYERS row alike.
      // `true` reports the (trivial) update as having succeeded.
      return true;
    },

    destroy(viewer = _viewer) {
      removeHandlers();
      if (_cameraChangedHandler && viewer) {
        viewer.camera.changed.removeEventListener(_cameraChangedHandler);
      }
      _cameraChangedHandler = null;
      if (_points && viewer) viewer.scene.primitives.remove(_points);
      if (_labels && viewer) viewer.scene.primitives.remove(_labels);
      _points = null;
      _labels = null;
      _pointsById = new Map();
      _labelsById = new Map();
      _cities = [];
      _index = null;
      _scoredById = new Map();
      _rankedIds = new Set();
      _filteredOutIds = new Set();
      _panelLabelIds = new Set();
      _selectedId = null;
      _pinnedIds = new Set();
      _hoveredId = null;
      _enabled = false;
      _viewer = null;
      _ready = null;
    },

    getStats() {
      return {
        count: _cities.length,
        eligible: _rankedIds.size,
        error: _loadError,
      };
    },

    // --- Public API for the panel (docs/cockpit/SPEC.md §4) ---

    /** Resolves once the pack has loaded (or definitively failed). Never rejects. */
    whenReady() {
      return _ready ? _ready.then(() => undefined) : Promise.resolve();
    },

    /** The scoring index over the loaded pack, or null before `whenReady()`. */
    getIndex() {
      return _index;
    },

    /**
     * Take over rendering with the panel's own weights/passport/filters.
     * @param {import('./scoring.js').ScoredCity[]} scored
     * @param {{rankedIds?: Iterable<string>, filteredOutIds?: Iterable<string>, labelIds?: Iterable<string>}} [options]
     */
    setScores(scored, { rankedIds, filteredOutIds, labelIds } = {}) {
      _scoredById = new Map((scored || []).map((s) => [s.id, s]));
      _rankedIds = new Set(rankedIds || []);
      _filteredOutIds = new Set(filteredOutIds || []);
      _panelLabelIds = new Set(labelIds || []);
      if (_enabled) restyleAll();
    },

    setSelected(id = null) {
      const next = id ?? null;
      if (_selectedId === next) return;
      _selectedId = next;
      if (_enabled) restyleAll();
    },

    setPinned(ids = []) {
      _pinnedIds = new Set(ids);
      if (_enabled) restyleAll();
    },

    onPick(cb) {
      _onPick = typeof cb === 'function' ? cb : null;
    },
  };
}
