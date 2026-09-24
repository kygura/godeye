import * as Cesium from 'cesium';
import {
  flightPath,
  estimateFlightHours,
  haversineKm,
} from '../../travel/geo.js';

/** Connecting hubs for legs beyond nonstop range. */
export const FLIGHT_HUBS = Object.freeze([
  { label: 'LAX', coord: [-118.41, 33.94] },
  { label: 'JFK', coord: [-73.78, 40.64] },
  { label: 'LHR', coord: [-0.45, 51.47] },
  { label: 'IST', coord: [28.75, 41.28] },
  { label: 'DXB', coord: [55.36, 25.25] },
  { label: 'DOH', coord: [51.61, 25.27] },
  { label: 'SIN', coord: [103.99, 1.36] },
  { label: 'HKG', coord: [113.91, 22.31] },
  { label: 'NRT', coord: [140.39, 35.77] },
  { label: 'JNB', coord: [28.24, -26.14] },
  { label: 'SYD', coord: [151.18, -33.95] },
]);

/** Pure: legs of a trip with distance, estimate and drawn segments. */
export function tripLegs(trip, hubs = FLIGHT_HUBS) {
  const nodes = trip?.nodes || [];
  const legs = [];
  for (let i = 1; i < nodes.length; i++) {
    const a = [nodes[i - 1].lng, nodes[i - 1].lat];
    const b = [nodes[i].lng, nodes[i].lat];
    const path = flightPath(a, b, hubs);
    legs.push({
      from: nodes[i - 1],
      to: nodes[i],
      ...path,
      hours: estimateFlightHours(path.distanceKm),
    });
  }
  return legs;
}

/** Pure row chips for the Trips row. */
export function tripsRowControls({ trip, flying }) {
  const nodes = trip?.nodes?.length || 0;
  return {
    chips: [
      {
        id: 'fly',
        label: flying ? 'FLYING' : 'FLY',
        disabled: nodes < 2,
        busy: flying,
        active: flying,
        state: flying ? 'loading' : 'idle',
        title:
          nodes < 2
            ? 'Add two or more stops first'
            : 'Fly the camera along the trip',
        params: { fly: true },
      },
      {
        id: 'clear',
        label: 'CLEAR',
        disabled: nodes === 0,
        state: 'idle',
        title: 'Remove every stop from the active trip',
        params: { clear: true },
      },
    ],
    legend: trip ? [{ label: trip.name, color: trip.color, count: nodes }] : [],
  };
}

/**
 * Draw the active trip as great-circle legs and stop pins. Reads the trip
 * store; the store owns persistence, this layer only mirrors it.
 * @param {{store: object, camera?: object}} deps
 */
export function createTripsLayer({ store, camera = null } = {}) {
  if (typeof store?.subscribe !== 'function')
    throw new TypeError('Trips require a trip store');
  let _viewer = null;
  let _dataSource = null;
  let _enabled = false;
  let _unsubscribe = null;
  let _listener = null;
  let _seams = null;
  let _flying = false;

  const repaintRow = () => _listener?.();

  function redraw() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    const trip = store.getActiveTrip();
    if (!trip) return;
    const color = Cesium.Color.fromCssColorString(trip.color || '#f59e0b');
    for (const leg of tripLegs(trip)) {
      for (const seg of leg.segments) {
        _dataSource.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(seg.flat()),
            width: 2.5,
            material: new Cesium.PolylineDashMaterialProperty({
              color,
              dashLength: 12,
            }),
            clampToGround: true,
          },
        });
      }
    }
    trip.nodes.forEach((n, i) => {
      _dataSource.entities.add({
        id: `trips:${trip.id}:${i}`,
        position: Cesium.Cartesian3.fromDegrees(n.lng, n.lat),
        point: {
          pixelSize: 9,
          color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `${i + 1} ${n.iata || n.name}`,
          font: '12px JetBrains Mono, monospace',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });
    repaintRow();
  }

  function fly() {
    const trip = store.getActiveTrip();
    if (!camera?.flyRoute || !_viewer || !trip || trip.nodes.length < 2)
      return false;
    camera.initCameraVerbs?.(_viewer);
    const path = tripLegs(trip)
      .flatMap((leg) => leg.segments.flat())
      .map(([lon, lat]) => ({ lon, lat, height: 0 }));
    const result = camera.flyRoute(
      [{ type: 'route', label: trip.name, path }],
      { speed: 'fast' },
      _seams?.floorFn || null,
      _seams?.runNavigation || null,
      _seams?.warmFn || null,
    );
    if (result?.ok !== true) {
      _seams?.showToast?.(result?.error || 'Could not fly the trip');
      return false;
    }
    _flying = true;
    repaintRow();
    const done = () => {
      _flying = false;
      repaintRow();
    };
    setTimeout(done, Math.max(1000, (result.durationS || 0) * 1000));
    return true;
  }

  return {
    id: 'trips',
    name: 'Trips',
    icon: '🧳',
    source: 'Local',
    updateInterval: 0,

    init(viewer) {
      if (_viewer) throw new Error('Trips layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('trips');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _unsubscribe = store.subscribe(() => redraw());
      redraw();
    },
    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
    },
    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
    },
    async update() {
      return false;
    },
    destroy(viewer = _viewer) {
      _unsubscribe?.();
      _unsubscribe = null;
      if (_dataSource && viewer) viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
      _viewer = null;
      _enabled = false;
      _listener = null;
      _seams = null;
    },
    getStats() {
      const trip = store.getActiveTrip();
      const legs = trip ? tripLegs(trip) : [];
      const km = Math.round(legs.reduce((s, l) => s + l.distanceKm, 0));
      return {
        count: trip?.nodes.length || 0,
        enabled: _enabled,
        distanceKm: km,
        detail: trip
          ? `${trip.name} · ${km.toLocaleString()} km`
          : 'No active trip',
      };
    },
    getRowControls() {
      return tripsRowControls({ trip: store.getActiveTrip(), flying: _flying });
    },
    setRowControlsListener(listener) {
      _listener = typeof listener === 'function' ? listener : null;
    },
    setParams(params = {}) {
      if (params.fly) fly();
      if (params.clear) {
        const trip = store.getActiveTrip();
        if (trip) store.removeTrip(trip.id);
      }
    },
    getParams() {
      return {};
    },
    attachShellServices(services) {
      _seams = services || null;
    },
    /** Straight-line preview length, for the panel readout. */
    distanceKm: (a, b) => haversineKm(a, b),
  };
}
